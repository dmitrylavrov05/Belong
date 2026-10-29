"""
RocketBig Telegram bot: воронка регистрации, автонапоминания, постбэки, статистика, рассылки.
Стадии пользователя: new -> age_ok -> clicked -> registered -> promo -> deposited  (minor — не прошёл 18+)
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import aiosqlite
from aiohttp import web
from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, FSInputFile, InlineKeyboardButton, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder
from dotenv import load_dotenv

from texts import DRIP, T

load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "").replace(" ", "").split(",") if x}
BONUS_URLS = {
    "ru": os.getenv("BONUS_URL_RU") or os.getenv("BONUS_URL") or "https://r1wapac.com/?p=mhge",
    "pt": os.getenv("BONUS_URL_PT") or "https://r1wclcs.com/?p=7hra",
}
PROMO_CODE = os.getenv("PROMO_CODE", "BIGROCKET")
SUB_PARAM = os.getenv("SUB_PARAM", "sub1")             # параметр ссылки, куда кладём Telegram ID (для постбэков)
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")   # http://IP_сервера:8080 — включает учёт кликов через редирект
POSTBACK_SECRET = os.getenv("POSTBACK_SECRET", "")
WEB_PORT = int(os.getenv("WEB_PORT", "8080"))
DRIP_ENABLED = os.getenv("DRIP_ENABLED", "1") == "1"
MIN_GAP_H = float(os.getenv("DRIP_MIN_GAP_HOURS", "20"))   # не чаще одного автосообщения за N часов
TZ_OFFSET = {"ru": 3, "pt": -3}                             # часовой пояс аудитории для «тихих часов»
SEND_FROM, SEND_TO = 10, 22                                 # автосообщения только с 10:00 до 22:00 по их времени

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / os.getenv("DB_FILE", "bot.db")
LOGO_PATH = BASE_DIR / "logo.png"
STAGES = ["new", "age_ok", "clicked", "registered", "promo", "deposited"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rocketbig")


def now_dt() -> datetime:
    return datetime.now(timezone.utc)


def now() -> str:
    return now_dt().isoformat(timespec="seconds")


def tx(lang: str, key: str) -> str:
    return T.get(lang or "ru", T["ru"])[key].format(promo=PROMO_CODE)

# ---------------------------------------------------------------- database
COLUMNS = {
    "username": "TEXT", "first_name": "TEXT", "lang": "TEXT", "joined_at": "TEXT",
    "active": "INTEGER DEFAULT 1", "stage": "TEXT", "stage_at": "TEXT",
    "drip_step": "INTEGER DEFAULT 0", "last_drip_at": "TEXT", "unsub": "INTEGER DEFAULT 0",
    "reg_at": "TEXT", "dep_at": "TEXT", "dep_source": "TEXT",
}


async def db_init():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY)")
        cur = await db.execute("PRAGMA table_info(users)")
        have = {r[1] for r in await cur.fetchall()}
        for col, typ in COLUMNS.items():
            if col not in have:
                await db.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")
        await db.execute("CREATE TABLE IF NOT EXISTS clicks (user_id INTEGER, at TEXT)")
        await db.execute("CREATE TABLE IF NOT EXISTS events (user_id INTEGER, event TEXT, source TEXT, at TEXT)")
        # миграция пользователей старой версии бота
        await db.execute("UPDATE users SET stage='age_ok', stage_at=? WHERE stage IS NULL AND lang IS NOT NULL", (now(),))
        await db.execute("UPDATE users SET stage='new', stage_at=? WHERE stage IS NULL", (now(),))
        await db.commit()


async def upsert_user(obj):
    u = obj.from_user
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO users (user_id, username, first_name, joined_at, active, stage, stage_at, drip_step, unsub)
               VALUES (?, ?, ?, ?, 1, 'new', ?, 0, 0)
               ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,
                   first_name=excluded.first_name, active=1""",
            (u.id, u.username, u.first_name, now(), now()),
        )
        await db.commit()


async def get_user(uid: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM users WHERE user_id=?", (uid,))
        r = await cur.fetchone()
        return dict(r) if r else None


async def set_fields(uid: int, **kw):
    if not kw:
        return
    cols = ", ".join(f"{k}=?" for k in kw)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE users SET {cols} WHERE user_id=?", (*kw.values(), uid))
        await db.commit()


async def advance(uid: int, stage: str, source: str = "bot") -> bool:
    """Двигает пользователя вперёд по воронке (назад — никогда). True, если стадия изменилась."""
    u = await get_user(uid)
    if not u:
        return False
    cur = u.get("stage") or "new"
    if cur == "minor":
        return False
    if STAGES.index(stage) <= STAGES.index(cur):
        return False
    extra = {}
    if stage in ("registered", "promo", "deposited") and not u.get("reg_at"):
        extra["reg_at"] = now()
    if stage == "deposited":
        extra.update(dep_at=now(), dep_source=source)
    await set_fields(uid, stage=stage, stage_at=now(), drip_step=0, **extra)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO events VALUES (?, ?, ?, ?)", (uid, stage, source, now()))
        await db.commit()
    return True


async def log_click(uid: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO clicks VALUES (?, ?)", (uid, now()))
        await db.commit()
    await advance(uid, "clicked", "click")

# ---------------------------------------------------------------- links & keyboards
def ref_link(uid: int, lang: str) -> str:
    """Реферальная ссылка с Telegram ID в sub-параметре."""
    p = urlparse(BONUS_URLS.get(lang, BONUS_URLS["ru"]))
    q = dict(parse_qsl(p.query))
    q[SUB_PARAM] = str(uid)
    return urlunparse(p._replace(query=urlencode(q)))


def user_link(uid: int, lang: str) -> str:
    """С PUBLIC_URL — через свой редирект (считаем клики). Без него — сразу на 1win."""
    return f"{PUBLIC_URL}/go/{uid}/{lang}" if PUBLIC_URL else ref_link(uid, lang)


def btn(text, data=None, url=None):
    return InlineKeyboardButton(text=text, url=url) if url else InlineKeyboardButton(text=text, callback_data=data)


def kb(rows):
    b = InlineKeyboardBuilder()
    for r in rows:
        b.row(*r)
    return b.as_markup()


def kb_lang():
    return kb([[btn("🇷🇺 Русский", "lang:ru"), btn("🇧🇷 Português", "lang:pt")]])


def kb_age(lang):
    return kb([[btn(tx(lang, "age_yes"), "age:yes"), btn(tx(lang, "age_no"), "age:no")]])


def kb_step(uid, lang, step):
    link = user_link(uid, lang)
    if step == 1:
        return kb([[btn(tx(lang, "btn_reg"), url=link)], [btn(tx(lang, "btn_reg_done"), "done:reg")]])
    if step == 2:
        return kb([[btn(tx(lang, "btn_promo_done"), "done:promo")]])
    return kb([[btn(tx(lang, "btn_deposit"), url=link)], [btn(tx(lang, "btn_dep_done"), "done:dep")]])


def kb_drip(uid, lang, action):
    rows = []
    if action == "reg":
        rows += [[btn(tx(lang, "btn_reg"), url=user_link(uid, lang))], [btn(tx(lang, "btn_reg_done"), "done:reg")]]
    elif action == "dep":
        rows += [[btn(tx(lang, "btn_deposit"), url=user_link(uid, lang))], [btn(tx(lang, "btn_dep_done"), "done:dep")]]
    rows.append([btn(tx(lang, "btn_stop"), "stop")])
    return kb(rows)

# ---------------------------------------------------------------- admin (подключается первым)
admin = Router()
admin.message.filter(F.from_user.id.in_(ADMIN_IDS))
admin.callback_query.filter(F.from_user.id.in_(ADMIN_IDS))
pending: dict[int, tuple[str, int | None, str | None]] = {}


async def scalar(db, sql, *a):
    return (await (await db.execute(sql, a)).fetchone())[0]


async def build_stats() -> str:
    today = now_dt().date().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        total = await scalar(db, "SELECT COUNT(*) FROM users")
        new_today = await scalar(db, "SELECT COUNT(*) FROM users WHERE joined_at LIKE ?", today + "%")
        blocked = await scalar(db, "SELECT COUNT(*) FROM users WHERE active=0")
        unsub = await scalar(db, "SELECT COUNT(*) FROM users WHERE unsub=1 AND stage!='minor'")
        minors = await scalar(db, "SELECT COUNT(*) FROM users WHERE stage='minor'")
        lines = []
        for lang, flag in (("ru", "🇷🇺"), ("pt", "🇧🇷")):
            row = []
            for st in STAGES[1:]:
                later = STAGES[STAGES.index(st):]
                row.append(await scalar(db, f"SELECT COUNT(*) FROM users WHERE lang=? AND stage IN ({','.join('?' * len(later))})", lang, *later))
            age_ok, clicked, reg, promo, dep = row
            conv = f"{dep / age_ok * 100:.1f}%" if age_ok else "—"
            lines.append(f"{flag} 18+: {age_ok} → клик: {clicked} → рег: {reg} → промо: {promo} → деп: <b>{dep}</b> ({conv})")
        dep_pb = await scalar(db, "SELECT COUNT(*) FROM users WHERE stage='deposited' AND dep_source='postback'")
        dep_today = await scalar(db, "SELECT COUNT(*) FROM users WHERE dep_at LIKE ?", today + "%")
        clicks = await scalar(db, "SELECT COUNT(*) FROM clicks")
    return (
        "📊 <b>Статистика</b>\n\n"
        f"👥 Всего: <b>{total}</b> • новых сегодня: {new_today}\n"
        f"🚫 Заблокировали: {blocked} • 🔕 отписались от напоминаний: {unsub} • до 18: {minors}\n\n"
        "<b>Воронка</b> (дошли до этапа или дальше):\n" + "\n".join(lines) + "\n\n"
        f"💳 Депозитов сегодня: {dep_today} • подтверждено постбэком: {dep_pb}\n"
        f"🔗 Кликов через редирект: {clicks}"
    )


@admin.message(Command("stats"))
async def on_stats(message: Message):
    await message.answer(await build_stats())


@admin.message(Command("broadcast"))
async def on_broadcast(message: Message):
    parts = message.text.split(maxsplit=2)
    target, text = "all", None
    seg = parts[1].lower() if len(parts) > 1 else ""
    if seg in ("ru", "pt", "nodep", "dep"):
        target = seg
        text = parts[2] if len(parts) > 2 else None
    elif len(parts) > 1:
        text = message.text.split(maxsplit=1)[1]
    if message.reply_to_message:
        pending[message.from_user.id] = (target, message.reply_to_message.message_id, None)
        preview = "сообщение, на которое ты ответил"
    elif text:
        pending[message.from_user.id] = (target, None, text)
        preview = f"текст:\n\n{text}"
    else:
        return await message.answer(
            "Как сделать рассылку:\n"
            "• <code>/broadcast текст</code> — всем\n"
            "• <code>/broadcast ru текст</code> или <code>pt</code> — по языку\n"
            "• <code>/broadcast nodep текст</code> — тем, кто ещё не пополнил\n"
            "• <code>/broadcast dep текст</code> — тем, кто уже пополнил\n"
            "• или ответь <code>/broadcast [сегмент]</code> на любое сообщение (фото/видео/кнопки)"
        )
    who = {"all": "всем", "ru": "RU", "pt": "PT", "nodep": "не пополнившим", "dep": "пополнившим"}[target]
    await message.answer(f"Отправить ({who}) {preview}", parse_mode=None,
                         reply_markup=kb([[btn("✅ Отправить", "bc:yes"), btn("❌ Отмена", "bc:no")]]))


@admin.callback_query(F.data.startswith("bc:"))
async def on_broadcast_confirm(cb: CallbackQuery, bot: Bot):
    job = pending.pop(cb.from_user.id, None)
    await cb.answer()
    if cb.data == "bc:no" or not job:
        return await cb.message.edit_text("Рассылка отменена.")
    target, msg_id, text = job
    where = {"all": "", "ru": " AND lang='ru'", "pt": " AND lang='pt'",
             "nodep": " AND stage IN ('age_ok','clicked','registered','promo')", "dep": " AND stage='deposited'"}[target]
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT user_id FROM users WHERE active=1 AND stage NOT IN ('minor','new')" + where)
        ids = [r[0] for r in await cur.fetchall()]
    await cb.message.edit_text(f"⏳ Рассылка запущена: {len(ids)} получателей…")
    ok = fail = 0
    for uid in ids:
        if await safe_send(bot, uid, text=text, copy_from=(cb.from_user.id, msg_id) if msg_id else None):
            ok += 1
        else:
            fail += 1
        await asyncio.sleep(0.05)
    await cb.message.answer(f"✅ Готово. Доставлено: {ok}, не доставлено: {fail}")


@admin.message(Command("admin"))
async def on_admin_help(message: Message):
    await message.answer(
        "🛠 <b>Команды админа</b>\n"
        "/stats — статистика и воронка\n"
        "/broadcast — рассылка (сегменты: ru, pt, nodep, dep)\n"
        "/dep &lt;telegram_id&gt; — вручную отметить депозит пользователя\n"
        "/reset — пройти воронку с начала (для теста), /reset &lt;id&gt; — сбросить пользователя"
    )


@admin.message(Command("reset"))
async def on_reset(message: Message):
    """/reset — начать воронку заново самому (для теста); /reset 123 — сбросить пользователя."""
    parts = message.text.split()
    uid = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else message.from_user.id
    if not await get_user(uid):
        return await message.answer("Пользователь не найден")
    await set_fields(uid, stage="new", stage_at=now(), drip_step=0, last_drip_at=None, unsub=0,
                     reg_at=None, dep_at=None, dep_source=None, lang=None)
    await message.answer(f"🔄 Сброшено для {uid}. Отправь /start, чтобы пройти воронку с начала." if uid == message.from_user.id
                         else f"🔄 Пользователь {uid} сброшен на начало воронки.")


@admin.message(Command("dep"))
async def on_manual_dep(message: Message, bot: Bot):
    parts = message.text.split()
    if len(parts) < 2 or not parts[1].isdigit():
        return await message.answer("Формат: /dep 123456789")
    uid = int(parts[1])
    if await advance(uid, "deposited", "manual"):
        u = await get_user(uid)
        await safe_send(bot, uid, text=tx(u.get("lang") or "ru", "deposited"))
        await message.answer("✅ Отмечено")
    else:
        await message.answer("Пользователь не найден или уже отмечен")

# ---------------------------------------------------------------- user flow
router = Router()


async def show_current_step(message: Message, u: dict):
    """Возвращает пользователя на тот шаг, где он остановился."""
    lang, uid, st = u.get("lang") or "ru", u["user_id"], u.get("stage") or "new"
    if st in ("age_ok", "clicked"):
        await message.answer(tx(lang, "step1"), reply_markup=kb_step(uid, lang, 1))
    elif st == "registered":
        await message.answer(tx(lang, "step2"), reply_markup=kb_step(uid, lang, 2))
    elif st == "promo":
        await message.answer(tx(lang, "step3"), reply_markup=kb_step(uid, lang, 3))
    elif st == "deposited":
        await message.answer(tx(lang, "deposited"))


@router.message(CommandStart())
async def on_start(message: Message):
    await upsert_user(message)
    u = await get_user(message.from_user.id)
    if u.get("stage") != "minor":
        await set_fields(message.from_user.id, unsub=0)
    if u.get("lang") and u.get("stage") not in ("new", "minor"):
        return await show_current_step(message, u)
    await message.answer(tx("ru", "choose"), reply_markup=kb_lang())


@router.message(Command("lang"))
async def on_lang_cmd(message: Message):
    await upsert_user(message)
    await message.answer(tx("ru", "choose"), reply_markup=kb_lang())


@router.message(Command("stop"))
async def on_stop_cmd(message: Message):
    u = await get_user(message.from_user.id) or {}
    await set_fields(message.from_user.id, unsub=1)
    await message.answer(tx(u.get("lang") or "ru", "stopped"))


@router.callback_query(F.data.startswith("lang:"))
async def on_lang(cb: CallbackQuery):
    lang = cb.data.split(":", 1)[1]
    if lang not in T:
        return await cb.answer()
    await upsert_user(cb)
    await set_fields(cb.from_user.id, lang=lang)
    u = await get_user(cb.from_user.id)
    try:
        await cb.message.delete()
    except TelegramBadRequest:
        pass
    if u.get("stage") == "minor":
        await cb.message.answer(tx(lang, "age_denied"))
    elif u.get("stage") == "new":
        await cb.message.answer(tx(lang, "age_q"), reply_markup=kb_age(lang))
    else:
        await show_current_step(cb.message, u)
    await cb.answer()


@router.callback_query(F.data.startswith("age:"))
async def on_age(cb: CallbackQuery):
    u = await get_user(cb.from_user.id) or {}
    lang = u.get("lang") or "ru"
    try:
        await cb.message.delete()
    except TelegramBadRequest:
        pass
    if u.get("stage") not in (None, "new"):
        if u.get("stage") == "minor":
            await cb.message.answer(tx(lang, "age_denied"))
        return await cb.answer()
    if cb.data == "age:no":
        await set_fields(cb.from_user.id, stage="minor", stage_at=now(), unsub=1)
        await cb.message.answer(tx(lang, "age_denied"))
        return await cb.answer()
    await advance(cb.from_user.id, "age_ok")
    markup = kb([[btn(tx(lang, "btn_start_steps"), "go:1")]])
    if LOGO_PATH.exists():
        await cb.message.answer_photo(FSInputFile(LOGO_PATH), caption=tx(lang, "welcome"), reply_markup=markup)
    else:
        await cb.message.answer(tx(lang, "welcome"), reply_markup=markup)
    await cb.answer()


@router.callback_query(F.data == "go:1")
async def on_go1(cb: CallbackQuery):
    u = await get_user(cb.from_user.id) or {}
    lang = u.get("lang") or "ru"
    await cb.message.answer(tx(lang, "step1"), reply_markup=kb_step(cb.from_user.id, lang, 1))
    await cb.answer()


@router.callback_query(F.data.startswith("done:"))
async def on_done(cb: CallbackQuery):
    uid = cb.from_user.id
    u = await get_user(uid) or {}
    if u.get("stage") in (None, "new", "minor"):
        return await cb.answer()
    lang = u.get("lang") or "ru"
    what = cb.data.split(":", 1)[1]
    if what == "reg":
        await advance(uid, "registered", "self")
        await cb.message.answer(tx(lang, "step2"), reply_markup=kb_step(uid, lang, 2))
    elif what == "promo":
        await advance(uid, "promo", "self")
        await cb.message.answer(tx(lang, "step3"), reply_markup=kb_step(uid, lang, 3))
    elif what == "dep":
        await advance(uid, "deposited", "self")
        await cb.message.answer(tx(lang, "deposited"))
    await cb.answer()


@router.callback_query(F.data == "stop")
async def on_stop(cb: CallbackQuery):
    u = await get_user(cb.from_user.id) or {}
    await set_fields(cb.from_user.id, unsub=1)
    await cb.message.answer(tx(u.get("lang") or "ru", "stopped"))
    await cb.answer()


@router.message(F.text & ~F.text.startswith("/"))
async def on_any_text(message: Message):
    """Любой текст от пользователя — пересылаем админам как вопрос в поддержку."""
    if message.from_user.id in ADMIN_IDS:
        return
    u = await get_user(message.from_user.id) or {}
    await message.answer(tx(u.get("lang") or "ru", "support"))
    for a in ADMIN_IDS:
        try:
            await message.forward(a)
        except Exception:
            pass

# ---------------------------------------------------------------- sending helper
async def safe_send(bot: Bot, uid: int, text=None, markup=None, copy_from=None) -> bool:
    for _ in range(3):
        try:
            if copy_from:
                await bot.copy_message(uid, copy_from[0], copy_from[1])
            else:
                await bot.send_message(uid, text, reply_markup=markup)
            return True
        except TelegramRetryAfter as e:
            await asyncio.sleep(e.retry_after + 1)
        except (TelegramForbiddenError, TelegramBadRequest):
            await set_fields(uid, active=0)
            return False
    return False

# ---------------------------------------------------------------- auto-messages
def in_send_window(lang: str, at: datetime) -> bool:
    local_h = (at + timedelta(hours=TZ_OFFSET.get(lang or "ru", 3))).hour
    return SEND_FROM <= local_h < SEND_TO


def due_drip(u: dict, at: datetime):
    """(ключ_текста, кнопка), если пользователю пора отправить автосообщение, иначе None."""
    if u.get("unsub") or not u.get("active") or not u.get("lang"):
        return None
    steps = DRIP.get(u.get("stage") or "")
    step = u.get("drip_step") or 0
    if not steps or step >= len(steps):
        return None
    delay_h, key, action = steps[step]
    stage_at = datetime.fromisoformat(u.get("stage_at") or u.get("joined_at"))
    if at - stage_at < timedelta(hours=delay_h):
        return None
    if u.get("last_drip_at") and at - datetime.fromisoformat(u["last_drip_at"]) < timedelta(hours=MIN_GAP_H):
        return None
    if not in_send_window(u["lang"], at):
        return None
    return key, action


async def drip_tick(bot: Bot, at: datetime | None = None) -> int:
    at = at or now_dt()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM users WHERE active=1 AND unsub=0 AND stage IN (%s)" % ",".join("?" * len(DRIP)), tuple(DRIP))
        users = [dict(r) for r in await cur.fetchall()]
    sent = 0
    for u in users:
        d = due_drip(u, at)
        if not d:
            continue
        key, action = d
        ok = await safe_send(bot, u["user_id"], text=tx(u["lang"], key), markup=kb_drip(u["user_id"], u["lang"], action))
        await set_fields(u["user_id"], drip_step=(u.get("drip_step") or 0) + 1, last_drip_at=at.isoformat(timespec="seconds"))
        sent += ok
        await asyncio.sleep(0.05)
    return sent


async def drip_loop(bot: Bot):
    while True:
        try:
            n = await drip_tick(bot)
            if n:
                log.info("auto-messages sent: %s", n)
        except Exception:
            log.exception("drip error")
        await asyncio.sleep(300)

# ---------------------------------------------------------------- web: click redirect + postback
def make_web(bot: Bot) -> web.Application:
    app = web.Application()

    async def go(request: web.Request):
        try:
            uid = int(request.match_info["uid"])
        except ValueError:
            raise web.HTTPNotFound()
        lang = request.match_info.get("lang", "ru")
        if await get_user(uid):
            await log_click(uid)
        raise web.HTTPFound(ref_link(uid, lang if lang in BONUS_URLS else "ru"))

    async def postback(request: web.Request):
        q = request.query
        if not POSTBACK_SECRET or q.get("secret") != POSTBACK_SECRET:
            return web.Response(status=403, text="forbidden")
        uid_raw = q.get("user") or q.get(SUB_PARAM) or ""
        event = (q.get("event") or "").lower()
        if not uid_raw.isdigit():
            return web.Response(status=400, text="bad user")
        uid = int(uid_raw)
        if event in ("reg", "registration"):
            await advance(uid, "registered", "postback")
        elif event in ("ftd", "dep", "deposit", "first_deposit"):
            if await advance(uid, "deposited", "postback"):
                u = await get_user(uid)
                await safe_send(bot, uid, text=tx(u.get("lang") or "ru", "deposited"))
        else:
            return web.Response(status=400, text="bad event")
        return web.Response(text="ok")

    async def health(_):
        return web.Response(text="ok")

    app.router.add_get("/go/{uid}/{lang}", go)
    app.router.add_get("/postback", postback)
    app.router.add_get("/health", health)
    return app

# ---------------------------------------------------------------- run
async def main():
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN не задан. Заполни файл .env")
    await db_init()
    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(admin)
    dp.include_router(router)
    runner = None
    if PUBLIC_URL or POSTBACK_SECRET:
        runner = web.AppRunner(make_web(bot))
        await runner.setup()
        await web.TCPSite(runner, "0.0.0.0", WEB_PORT).start()
        log.info("web server on :%s (clicks=%s, postback=%s)", WEB_PORT, bool(PUBLIC_URL), bool(POSTBACK_SECRET))
    if DRIP_ENABLED:
        asyncio.create_task(drip_loop(bot))
    log.info("Bot started. Admins: %s", ADMIN_IDS or "не заданы")
    try:
        await dp.start_polling(bot)
    finally:
        if runner:
            await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
