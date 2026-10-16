"""Вхід у CARCAR на сервері: сесії, Telegram-бот, демо-вхід, кабінет мийки й адмінка.

Клієнт: номер телефону підтверджує Telegram (кнопка «Поділитися номером» у боті — безкоштовно).
Поки бота не налаштовано, можна ввімкнути демо-вхід за номером без перевірки (demo_login у конфігурації).
Мийка: логін і пароль, видані адміністрацією (перевіряються тут, а не в браузері).
Адмінка: пароль із конфігурації (зберігається лише як PBKDF2-хеш).
"""
import hashlib
import hmac
import json
import secrets
import threading
import time
import urllib.parse
import urllib.request

from acl import phone_key

SESSION_DAYS = 90


# ---------- паролі ----------

def biz_hash(login, password):
    """Те саме, що hashPass у core.js (SHA-256 від «carcar:логін:пароль»)."""
    return hashlib.sha256(f'carcar:{login.lower()}:{password}'.encode()).hexdigest()


def make_admin_hash(password):
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000).hex()
    return f'pbkdf2${salt}${h}'


def check_admin(password, stored):
    try:
        _, salt, h = stored.split('$')
    except (AttributeError, ValueError):
        return False
    got = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000).hex()
    return hmac.compare_digest(got, h)


# ---------- сесії ----------

class Sessions:
    def __init__(self, db, lock):
        self.db, self.lock = db, lock
        self.cache = {}  # token -> (роль, субʼєкт, створено): кожен запит без звернення до диска
        db.execute('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT, subject TEXT, created INTEGER)')
        db.execute('CREATE TABLE IF NOT EXISTS tg_login (nonce TEXT PRIMARY KEY, created INTEGER, phone TEXT, name TEXT, chat_id INTEGER)')
        db.execute('CREATE TABLE IF NOT EXISTS tg_links (subject TEXT PRIMARY KEY, chat_id INTEGER)')
        db.commit()

    def create(self, role, subject):
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.db.execute('INSERT INTO sessions VALUES (?, ?, ?, ?)', (token, role, json.dumps(subject), int(time.time())))
            self.db.commit()
        return token

    def get(self, token):
        if not token:
            return None
        row = self.cache.get(token)
        if row is None:
            row = self.db.execute('SELECT role, subject, created FROM sessions WHERE token = ?', (token,)).fetchone()
            if not row:
                return None
            row = (row[0], json.loads(row[1]), row[2])
            if len(self.cache) > 100_000:
                self.cache.clear()
            self.cache[token] = row
        if time.time() - row[2] > SESSION_DAYS * 86400:
            return None
        return row[0], row[1]

    def drop(self, token):
        self.cache.pop(token, None)
        with self.lock:
            self.db.execute('DELETE FROM sessions WHERE token = ?', (token,))
            self.db.commit()

    # Telegram: вхід і привʼязка сповіщень
    def tg_start(self):
        nonce = secrets.token_urlsafe(12).replace('-', 'x').replace('_', 'y')
        with self.lock:
            self.db.execute('INSERT INTO tg_login (nonce, created) VALUES (?, ?)', (nonce, int(time.time())))
            self.db.execute('DELETE FROM tg_login WHERE created < ?', (int(time.time()) - 3600,))
            self.db.commit()
        return nonce

    def tg_done(self, nonce, phone, name, chat_id):
        with self.lock:
            cur = self.db.execute('UPDATE tg_login SET phone = ?, name = ?, chat_id = ? WHERE nonce = ? AND phone IS NULL', (phone, name, chat_id, nonce))
            self.db.commit()
            return cur.rowcount > 0

    def tg_check(self, nonce):
        row = self.db.execute('SELECT phone, name, chat_id FROM tg_login WHERE nonce = ?', (nonce,)).fetchone()
        return row if row and row[0] else None

    def tg_link(self, subject, chat_id):
        with self.lock:
            self.db.execute('INSERT INTO tg_links VALUES (?, ?) ON CONFLICT(subject) DO UPDATE SET chat_id = excluded.chat_id', (subject, chat_id))
            self.db.commit()

    def tg_chat(self, subject):
        row = self.db.execute('SELECT chat_id FROM tg_links WHERE subject = ?', (subject,)).fetchone()
        return row[0] if row else None


# ---------- Telegram-бот ----------

class TelegramBot:
    """Бот без вебхука (довге опитування getUpdates) — не потрібні домен і сертифікат."""

    def __init__(self, token, sessions, on_link=None):
        self.token, self.sessions, self.on_link = token, sessions, on_link
        self.offset = 0
        self.pending = {}  # chat_id -> nonce, поки людина не поділилась номером

    def api(self, method, **params):
        data = json.dumps(params).encode()
        req = urllib.request.Request(f'https://api.telegram.org/bot{self.token}/{method}', data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read())

    def send(self, chat_id, text, **extra):
        try:
            self.api('sendMessage', chat_id=chat_id, text=text, **extra)
        except Exception:  # мережа чи користувач заблокував бота — сповіщення не критичне
            pass

    def start(self):
        threading.Thread(target=self.loop, daemon=True).start()

    def loop(self):
        while True:
            try:
                res = self.api('getUpdates', offset=self.offset, timeout=30, allowed_updates=['message'])
                for upd in res.get('result', []):
                    self.offset = upd['update_id'] + 1
                    self.handle(upd.get('message') or {})
            except Exception:
                time.sleep(5)

    def handle(self, msg):
        chat = (msg.get('chat') or {}).get('id')
        sender = (msg.get('from') or {}).get('id')
        text = msg.get('text') or ''
        if not chat:
            return
        if text.startswith('/start'):
            arg = text.split(' ', 1)[1].strip() if ' ' in text else ''
            if arg.startswith('link_'):
                # Привʼязка сповіщень мийки чи клієнта: код видає /api/notify/telegram.
                subject = self.on_link(arg[5:]) if self.on_link else None
                self.send(chat, 'Готово! Сюди приходитимуть сповіщення CARCAR.' if subject else 'Посилання застаріло — відкрийте його ще раз із застосунку.')
                if subject:
                    self.sessions.tg_link(subject, chat)
                return
            if arg:
                self.pending[chat] = arg
            self.send(chat, 'Щоб увійти в CARCAR, поділіться номером телефону — кнопка нижче.',
                      reply_markup={'keyboard': [[{'text': '📱 Поділитися номером', 'request_contact': True}]], 'resize_keyboard': True, 'one_time_keyboard': True})
            return
        contact = msg.get('contact')
        if contact:
            # Номер має належати тому, хто натиснув кнопку, — інакше можна підсунути чужий контакт.
            if contact.get('user_id') != sender:
                self.send(chat, 'Поділіться, будь ласка, власним номером — кнопкою нижче.')
                return
            phone = phone_key(contact.get('phone_number'))
            nonce = self.pending.pop(chat, None)
            name = ' '.join(x for x in [contact.get('first_name'), contact.get('last_name')] if x)
            if nonce and phone and self.sessions.tg_done(nonce, phone, name, chat):
                self.sessions.tg_link(phone, chat)
                self.send(chat, 'Номер підтверджено ✅ Повертайтеся в CARCAR — ви вже увійшли. Сюди приходитимуть сповіщення про записи.',
                          reply_markup={'remove_keyboard': True})
            else:
                self.send(chat, 'Посилання для входу застаріло. Відкрийте вхід у CARCAR ще раз.', reply_markup={'remove_keyboard': True})


def tg_link_url(bot_username, payload):
    return f'https://t.me/{bot_username}?start={urllib.parse.quote(payload)}'
