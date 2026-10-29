"""
RocketBig Telegram bot
- /start  -> language choice (RU / PT) -> welcome with bonus, promo code and button
- /lang   -> change language
- Admin:  /stats, /broadcast (reply to any message or /broadcast <text>)
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramForbiddenError, TelegramBadRequest, TelegramRetryAfter
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, FSInputFile, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder
from dotenv import load_dotenv

load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "").replace(" ", "").split(",") if x}
BONUS_URL = os.getenv("BONUS_URL", "https://1win.com")
PROMO_CODE = os.getenv("PROMO_CODE", "ROCKETBIG")
BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / os.getenv("DB_FILE", "bot.db")
LOGO_PATH = BASE_DIR / "logo.png"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rocketbig")

# ---------------------------------------------------------------- texts
T = {
    "ru": {
        "choose": "🌍 Выбери язык / Escolha o idioma:",
        "welcome": (
            "🚀 <b>Добро пожаловать в ROCKET BIG!</b>\n\n"
            "🎁 Бонус <b>+500%</b> на первый депозит на сайте <b>1win</b>\n\n"
            "🔑 Промокод: <code>{promo}</code>\n"
            "<i>(нажми на код, чтобы скопировать)</i>\n\n"
            "1️⃣ Нажми «Забрать бонус»\n"
            "2️⃣ Зарегистрируйся и введи промокод\n"
            "3️⃣ Сделай первый депозит — бонус начислится автоматически\n\n"
            "🔞 Только 18+. Играй ответственно — азартные игры связаны с риском потери денег."
        ),
        "btn_bonus": "🎁 Забрать бонус",
        "btn_lang": "🌍 Сменить язык",
        "go": "👇 Переходи по кнопке и не забудь промокод <code>{promo}</code>",
        "btn_go": "🚀 Перейти на 1win",
    },
    "pt": {
        "choose": "🌍 Escolha o idioma / Выбери язык:",
        "welcome": (
            "🚀 <b>Bem-vindo ao ROCKET BIG!</b>\n\n"
            "🎁 Bônus de <b>+500%</b> no primeiro depósito no site <b>1win</b>\n\n"
            "🔑 Código promocional: <code>{promo}</code>\n"
            "<i>(toque no código para copiar)</i>\n\n"
            "1️⃣ Toque em «Pegar bônus»\n"
            "2️⃣ Cadastre-se e insira o código\n"
            "3️⃣ Faça o primeiro depósito — o bônus é creditado automaticamente\n\n"
            "🔞 Apenas para maiores de 18 anos. Jogue com responsabilidade — apostas envolvem risco de perder dinheiro."
        ),
        "btn_bonus": "🎁 Pegar bônus",
        "btn_lang": "🌍 Mudar idioma",
        "go": "👇 Toque no botão e não esqueça o código <code>{promo}</code>",
        "btn_go": "🚀 Ir para a 1win",
    },
}

# ---------------------------------------------------------------- database
async def db_init():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id   INTEGER PRIMARY KEY,
                username  TEXT,
                first_name TEXT,
                lang      TEXT,
                joined_at TEXT,
                active    INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS clicks (
                user_id INTEGER,
                at      TEXT
            );
            """
        )
        await db.commit()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def upsert_user(msg_or_cb):
    u = msg_or_cb.from_user
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO users (user_id, username, first_name, joined_at, active)
               VALUES (?, ?, ?, ?, 1)
               ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,
                   first_name=excluded.first_name, active=1""",
            (u.id, u.username, u.first_name, now()),
        )
        await db.commit()


async def set_lang(user_id: int, lang: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET lang=? WHERE user_id=?", (lang, user_id))
        await db.commit()


async def get_lang(user_id: int) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT lang FROM users WHERE user_id=?", (user_id,))
        row = await cur.fetchone()
        return row[0] if row else None


async def log_click(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO clicks (user_id, at) VALUES (?, ?)", (user_id, now()))
        await db.commit()

# ---------------------------------------------------------------- keyboards
def kb_lang():
    b = InlineKeyboardBuilder()
    b.button(text="🇷🇺 Русский", callback_data="lang:ru")
    b.button(text="🇧🇷 Português", callback_data="lang:pt")
    b.adjust(2)
    return b.as_markup()


def kb_main(lang: str):
    b = InlineKeyboardBuilder()
    b.button(text=T[lang]["btn_bonus"], callback_data="bonus")
    b.button(text=T[lang]["btn_lang"], callback_data="change_lang")
    b.adjust(1)
    return b.as_markup()


def kb_go(lang: str):
    b = InlineKeyboardBuilder()
    b.button(text=T[lang]["btn_go"], url=BONUS_URL)
    return b.as_markup()

# ---------------------------------------------------------------- user handlers
router = Router()


async def send_welcome(message: Message, lang: str):
    text = T[lang]["welcome"].format(promo=PROMO_CODE)
    if LOGO_PATH.exists():
        await message.answer_photo(FSInputFile(LOGO_PATH), caption=text, reply_markup=kb_main(lang))
    else:
        await message.answer(text, reply_markup=kb_main(lang))


@router.message(CommandStart())
async def on_start(message: Message):
    await upsert_user(message)
    await message.answer(T["ru"]["choose"], reply_markup=kb_lang())


@router.message(Command("lang"))
async def on_lang_cmd(message: Message):
    await upsert_user(message)
    await message.answer(T["ru"]["choose"], reply_markup=kb_lang())


@router.callback_query(F.data == "change_lang")
async def on_change_lang(cb: CallbackQuery):
    await cb.message.answer(T["ru"]["choose"], reply_markup=kb_lang())
    await cb.answer()


@router.callback_query(F.data.startswith("lang:"))
async def on_lang(cb: CallbackQuery):
    lang = cb.data.split(":", 1)[1]
    if lang not in T:
        return await cb.answer()
    await upsert_user(cb)
    await set_lang(cb.from_user.id, lang)
    try:
        await cb.message.delete()
    except TelegramBadRequest:
        pass
    await send_welcome(cb.message, lang)
    await cb.answer()


@router.callback_query(F.data == "bonus")
async def on_bonus(cb: CallbackQuery):
    lang = await get_lang(cb.from_user.id) or "ru"
    await log_click(cb.from_user.id)
    await cb.message.answer(T[lang]["go"].format(promo=PROMO_CODE), reply_markup=kb_go(lang))
    await cb.answer()

# ---------------------------------------------------------------- admin handlers
admin = Router()
admin.message.filter(F.from_user.id.in_(ADMIN_IDS))
admin.callback_query.filter(F.from_user.id.in_(ADMIN_IDS))
pending: dict[int, tuple[str, int | None, str | None]] = {}   # admin_id -> (kind, msg_id, text)


@admin.message(Command("stats"))
async def on_stats(message: Message):
    today = datetime.now(timezone.utc).date().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        q = lambda sql, *a: db.execute(sql, a)
        total = (await (await q("SELECT COUNT(*) FROM users")).fetchone())[0]
        active = (await (await q("SELECT COUNT(*) FROM users WHERE active=1")).fetchone())[0]
        new_today = (await (await q("SELECT COUNT(*) FROM users WHERE joined_at LIKE ?", today + "%")).fetchone())[0]
        ru = (await (await q("SELECT COUNT(*) FROM users WHERE lang='ru'")).fetchone())[0]
        pt = (await (await q("SELECT COUNT(*) FROM users WHERE lang='pt'")).fetchone())[0]
        clicks = (await (await q("SELECT COUNT(*) FROM clicks")).fetchone())[0]
        uniq = (await (await q("SELECT COUNT(DISTINCT user_id) FROM clicks")).fetchone())[0]
        clicks_today = (await (await q("SELECT COUNT(*) FROM clicks WHERE at LIKE ?", today + "%")).fetchone())[0]
    conv = f"{uniq / total * 100:.1f}%" if total else "—"
    await message.answer(
        "📊 <b>Статистика</b>\n\n"
        f"👥 Всего пользователей: <b>{total}</b>\n"
        f"✅ Активных (не заблокировали): <b>{active}</b>\n"
        f"🆕 Новых сегодня: <b>{new_today}</b>\n"
        f"🇷🇺 RU: {ru}   🇧🇷 PT: {pt}\n\n"
        f"🎁 Нажатий «Забрать бонус»: <b>{clicks}</b> (сегодня {clicks_today})\n"
        f"👤 Уникальных нажавших: <b>{uniq}</b>  •  конверсия {conv}"
    )


@admin.message(Command("broadcast"))
async def on_broadcast(message: Message):
    parts = message.text.split(maxsplit=2)
    target = "all"
    if len(parts) > 1 and parts[1].lower() in ("ru", "pt"):
        target = parts[1].lower()
        text = parts[2] if len(parts) > 2 else None
    else:
        text = message.text.split(maxsplit=1)[1] if len(parts) > 1 else None

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
            "• <code>/broadcast ru текст</code> или <code>/broadcast pt текст</code> — по языку\n"
            "• или ответь командой <code>/broadcast</code> на любое сообщение (фото, видео, кнопки) — оно будет скопировано"
        )
    b = InlineKeyboardBuilder()
    b.button(text="✅ Отправить", callback_data="bc:yes")
    b.button(text="❌ Отмена", callback_data="bc:no")
    who = {"all": "всем", "ru": "RU-пользователям", "pt": "PT-пользователям"}[target]
    await message.answer(f"Отправить {who} {preview}", reply_markup=b.as_markup(), parse_mode=None)


@admin.callback_query(F.data.startswith("bc:"))
async def on_broadcast_confirm(cb: CallbackQuery, bot: Bot):
    job = pending.pop(cb.from_user.id, None)
    await cb.answer()
    if cb.data == "bc:no" or not job:
        return await cb.message.edit_text("Рассылка отменена.")
    target, msg_id, text = job
    sql = "SELECT user_id FROM users WHERE active=1" + ("" if target == "all" else " AND lang=?")
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(sql, () if target == "all" else (target,))
        ids = [r[0] for r in await cur.fetchall()]
    await cb.message.edit_text(f"⏳ Рассылка запущена: {len(ids)} получателей…")
    ok = fail = 0
    blocked = []
    for uid in ids:
        for attempt in range(3):
            try:
                if msg_id:
                    await bot.copy_message(uid, cb.from_user.id, msg_id)
                else:
                    await bot.send_message(uid, text)
                ok += 1
                break
            except TelegramRetryAfter as e:
                await asyncio.sleep(e.retry_after + 1)
            except (TelegramForbiddenError, TelegramBadRequest):
                fail += 1; blocked.append(uid)
                break
        await asyncio.sleep(0.05)   # ~20 msg/s, within Telegram limits
    if blocked:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.executemany("UPDATE users SET active=0 WHERE user_id=?", [(u,) for u in blocked])
            await db.commit()
    await cb.message.answer(f"✅ Рассылка завершена\nДоставлено: {ok}\nНе доставлено (бот заблокирован): {fail}")


@admin.message(Command("admin"))
async def on_admin_help(message: Message):
    await message.answer(
        "🛠 <b>Команды админа</b>\n"
        "/stats — статистика\n"
        "/broadcast — рассылка (подробности: просто отправь /broadcast)"
    )

# ---------------------------------------------------------------- run
async def main():
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN не задан. Заполни файл .env")
    await db_init()
    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(admin)
    dp.include_router(router)
    log.info("Bot started. Admins: %s", ADMIN_IDS or "не заданы")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
