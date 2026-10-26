# -*- coding: utf-8 -*-
"""
Бот Gruzovoe-Kharkiv для публикации объявлений в Telegram-чатах С РАЗРЕШЕНИЯ АДМИНОВ.

Как это работает:
  * Бот не умеет сам вступать в чаты: его добавляет администратор чата.
  * После добавления бот ничего не публикует, пока админ не напишет /allow <часы>.
  * Публикует не чаще, чем разрешил админ (минимум раз в 24 часа), только днём (9:00–21:00 по Киеву).
  * Тексты чередуются (см. texts.py).
  * /pause, /stop или удаление бота из чата — публикации сразу прекращаются.
  * Владелец бота (вы) получает уведомления и видит список чатов командой /chats в личке.

Запуск:
  pip install "python-telegram-bot[job-queue]>=21,<22"
  export BOT_TOKEN="токен от @BotFather"
  export OWNER_ID="ваш числовой Telegram ID (узнать у @userinfobot)"
  python3 bot.py
"""
import os
import sqlite3
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from telegram import Update, ChatMember, LinkPreviewOptions
from telegram.constants import ParseMode, ChatType
from telegram.error import Forbidden, BadRequest, ChatMigrated, RetryAfter
from telegram.ext import Application, CommandHandler, ChatMemberHandler, ContextTypes

from texts import ADS, HELLO

TOKEN = os.environ["BOT_TOKEN"]
OWNER_ID = int(os.environ.get("OWNER_ID", "0"))
DB_PATH = os.environ.get("DB_PATH", "chats.db")

TZ = ZoneInfo("Europe/Kyiv")
MIN_INTERVAL_H = 24          # чаще раза в сутки бот не публикует никогда
DAY_START, DAY_END = 9, 21   # публикуем только с 9:00 до 21:00
CHECK_EVERY_S = 600          # как часто бот проверяет, не пора ли публиковать

logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
log = logging.getLogger("bot")


# ---------- база ----------
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("""CREATE TABLE IF NOT EXISTS chats(
        chat_id INTEGER PRIMARY KEY,
        title TEXT,
        status TEXT DEFAULT 'pending',      -- pending | active | paused | stopped | removed
        interval_h INTEGER DEFAULT 72,
        allowed_by TEXT,
        last_post TEXT,
        next_ad INTEGER DEFAULT 0)""")
    return con

def get_chat(chat_id):
    with db() as con:
        return con.execute("SELECT * FROM chats WHERE chat_id=?", (chat_id,)).fetchone()

def upsert_chat(chat_id, **fields):
    with db() as con:
        con.execute("INSERT OR IGNORE INTO chats(chat_id) VALUES(?)", (chat_id,))
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            con.execute(f"UPDATE chats SET {sets} WHERE chat_id=?", (*fields.values(), chat_id))


# ---------- помощники ----------
async def notify_owner(context, text):
    if OWNER_ID:
        try:
            await context.bot.send_message(OWNER_ID, text, parse_mode=ParseMode.HTML)
        except Exception as e:  # владелец ещё не написал боту /start
            log.warning("cannot notify owner: %s", e)

async def is_chat_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user or chat.type == ChatType.PRIVATE:
        return False
    # анонимный админ пишет от имени группы
    if update.effective_message and update.effective_message.sender_chat and update.effective_message.sender_chat.id == chat.id:
        return True
    member = await context.bot.get_chat_member(chat.id, user.id)
    return member.status in (ChatMember.ADMINISTRATOR, ChatMember.OWNER)

def who(update: Update) -> str:
    u = update.effective_user
    return f"@{u.username}" if u and u.username else (u.full_name if u else "admin")


# ---------- бота добавили / удалили ----------
async def on_my_member(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cm = update.my_chat_member
    chat = cm.chat
    if chat.type == ChatType.PRIVATE:
        return
    new = cm.new_chat_member.status
    if new in (ChatMember.MEMBER, ChatMember.ADMINISTRATOR):
        row = get_chat(chat.id)
        if not row or row["status"] in ("removed", "stopped"):
            upsert_chat(chat.id, title=chat.title, status="pending")
            try:
                await context.bot.send_message(chat.id, HELLO, parse_mode=ParseMode.HTML)
            except Exception as e:
                log.warning("hello failed in %s: %s", chat.id, e)
            adder = cm.from_user.full_name if cm.from_user else "?"
            await notify_owner(context, f"➕ Бота добавили в «{chat.title}» ({adder}). Ждём /allow от админа.")
    elif new in (ChatMember.LEFT, ChatMember.BANNED):
        upsert_chat(chat.id, title=chat.title, status="removed")
        await notify_owner(context, f"➖ Бота удалили из «{chat.title}». Публикации там прекращены.")


# ---------- команды админов чата ----------
async def cmd_allow(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_chat_admin(update, context):
        return await update.effective_message.reply_text("Цю команду може виконати лише адміністратор чату.")
    hours = 72
    if context.args:
        try:
            hours = int(context.args[0])
        except ValueError:
            return await update.effective_message.reply_text("Вкажіть кількість годин, наприклад: /allow 72")
    hours = max(MIN_INTERVAL_H, hours)
    chat = update.effective_chat
    upsert_chat(chat.id, title=chat.title, status="active", interval_h=hours, allowed_by=who(update))
    await update.effective_message.reply_text(
        f"✅ Дякуємо! Публікуватиму оголошення не частіше, ніж раз на {hours} год, з {DAY_START}:00 до {DAY_END}:00.\n"
        "Зупинити: /pause або /stop.")
    await notify_owner(context, f"✅ «{chat.title}»: {who(update)} разрешил публикации раз в {hours} ч.")

async def cmd_pause(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_chat_admin(update, context):
        return
    upsert_chat(update.effective_chat.id, status="paused")
    await update.effective_message.reply_text("⏸ Публікації призупинено. Відновити: /resume")
    await notify_owner(context, f"⏸ «{update.effective_chat.title}»: пауза ({who(update)}).")

async def cmd_resume(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_chat_admin(update, context):
        return
    row = get_chat(update.effective_chat.id)
    if not row or row["status"] not in ("paused", "active"):
        return await update.effective_message.reply_text("Спочатку дайте дозвіл: /allow 72")
    upsert_chat(update.effective_chat.id, status="active")
    await update.effective_message.reply_text("▶️ Публікації відновлено.")

async def cmd_stop(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_chat_admin(update, context):
        return
    upsert_chat(update.effective_chat.id, status="stopped")
    await update.effective_message.reply_text("⛔ Більше не публікую в цьому чаті. Можете видалити бота.")
    await notify_owner(context, f"⛔ «{update.effective_chat.title}»: публикации остановлены ({who(update)}).")

async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type == ChatType.PRIVATE:
        return
    row = get_chat(update.effective_chat.id)
    if not row:
        return await update.effective_message.reply_text("Налаштувань ще немає. Адмін може дозволити: /allow 72")
    names = {"pending": "чекаю дозволу", "active": "активно", "paused": "пауза", "stopped": "зупинено", "removed": "видалено"}
    await update.effective_message.reply_text(
        f"Статус: {names.get(row['status'], row['status'])}\nІнтервал: раз на {row['interval_h']} год\n"
        f"Остання публікація: {row['last_post'] or 'ще не було'}")


# ---------- команды владельца (в личке с ботом) ----------
def owner_only(update: Update) -> bool:
    return update.effective_user and update.effective_user.id == OWNER_ID and update.effective_chat.type == ChatType.PRIVATE

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != ChatType.PRIVATE:
        return
    if owner_only(update):
        await update.message.reply_text("Привет! Команды: /chats — список чатов, /preview — тексты объявлений.\n"
                                        "Чтобы бот публиковал в чате, попросите админа добавить его и написать /allow 72.")
    else:
        await update.message.reply_text("Це бот Gruzovoe-Kharkiv. Замовити машину: https://gruzovoe-kharkiv.com.ua")

async def cmd_chats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not owner_only(update):
        return
    with db() as con:
        rows = con.execute("SELECT * FROM chats ORDER BY status, title").fetchall()
    if not rows:
        return await update.message.reply_text("Бота пока не добавили ни в один чат.")
    icon = {"active": "🟢", "pending": "🟡", "paused": "⏸", "stopped": "⛔", "removed": "⚪"}
    lines = [f"{icon.get(r['status'], '•')} {r['title']} — {r['status']}, раз в {r['interval_h']} ч, последняя: {r['last_post'] or '—'}" for r in rows]
    await update.message.reply_text("\n".join(lines))

async def cmd_preview(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not owner_only(update):
        return
    for i, t in enumerate(ADS, 1):
        await update.message.reply_text(f"Текст {i}:\n\n{t}", parse_mode=ParseMode.HTML,
                                        link_preview_options=LinkPreviewOptions(is_disabled=True))


# ---------- публикация по расписанию ----------
async def tick(context: ContextTypes.DEFAULT_TYPE):
    now_local = datetime.now(TZ)
    if not (DAY_START <= now_local.hour < DAY_END):
        return
    now = datetime.now(timezone.utc)
    with db() as con:
        rows = con.execute("SELECT * FROM chats WHERE status='active'").fetchall()
    for r in rows:
        interval = timedelta(hours=max(MIN_INTERVAL_H, r["interval_h"]))
        if r["last_post"]:
            last = datetime.fromisoformat(r["last_post"])
            if now - last < interval:
                continue
        text = ADS[r["next_ad"] % len(ADS)]
        try:
            await context.bot.send_message(r["chat_id"], text, parse_mode=ParseMode.HTML,
                                           link_preview_options=LinkPreviewOptions(is_disabled=True))
            upsert_chat(r["chat_id"], last_post=now.isoformat(timespec="minutes"), next_ad=(r["next_ad"] + 1) % len(ADS))
            log.info("posted to %s", r["title"])
        except ChatMigrated as e:  # группа стала супергруппой — новый id
            with db() as con:
                con.execute("UPDATE chats SET chat_id=? WHERE chat_id=?", (e.new_chat_id, r["chat_id"]))
        except Forbidden:
            upsert_chat(r["chat_id"], status="removed")
            await notify_owner(context, f"⚪ «{r['title']}»: бот больше не может писать в чат, публикации остановлены.")
        except RetryAfter as e:
            log.warning("rate limit, sleep %s", e.retry_after)
            return
        except BadRequest as e:
            log.warning("bad request in %s: %s", r["title"], e)


def main():
    db().close()
    app = Application.builder().token(TOKEN).build()
    app.add_handler(ChatMemberHandler(on_my_member, ChatMemberHandler.MY_CHAT_MEMBER))
    app.add_handler(CommandHandler("allow", cmd_allow))
    app.add_handler(CommandHandler("pause", cmd_pause))
    app.add_handler(CommandHandler("resume", cmd_resume))
    app.add_handler(CommandHandler("stop", cmd_stop))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("chats", cmd_chats))
    app.add_handler(CommandHandler("preview", cmd_preview))
    app.job_queue.run_repeating(tick, interval=CHECK_EVERY_S, first=30)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
