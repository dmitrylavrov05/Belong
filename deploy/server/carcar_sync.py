#!/usr/bin/env python3
"""Сервер CARCAR: спільні дані для всіх пристроїв, вхід, права доступу, сповіщення, оплата й дзвінки.

Застосунок зберігає дані ключами (bookings, reviews, partners…). Сервер тримає спільну копію кожного ключа
в SQLite, кожному віддає лише те, що йому можна бачити (acl.py), приймає зміни з перевіркою прав і розсилає
їх іншим пристроям («довге опитування»). Події записів (новий запис, підтвердження, «Машина готова»,
повідомлення в чаті) надсилає push-сповіщенням і в Telegram.

  GET  /api/config                       — що ввімкнено: Telegram-вхід, демо-вхід, оплата, push, TURN
  POST /api/auth/demo   {phone, name}    — вхід клієнта без перевірки номера (якщо demo_login)
  POST /api/auth/tg/start  → {nonce,url} / GET /api/auth/tg/check?nonce=…  — вхід через Telegram-бота
  POST /api/auth/biz    {login,password} або {demo:true}  — кабінет мийки
  POST /api/auth/admin  {password}       — адмінка
  GET  /api/me, POST /api/auth/logout
  GET  /api/state?since=N&wait=1         — змінені ключі (лише дозволене цій ролі)
  PUT  /api/state/<key>  {value, base}   — зміни з тристороннім злиттям і перевіркою прав
  POST /api/push/subscribe {subscription} — push на цей телефон
  POST /api/notify/telegram              — посилання, щоб отримувати сповіщення в Telegram
  POST /api/pay/create {booking}         — оплата LiqPay; POST /api/pay/liqpay/callback — відповідь банку
  GET  /api/ice                          — STUN/TURN для дзвінків

Запуск: python3 carcar_sync.py --port 8090 --db /var/lib/carcar/data.db --config /etc/carcar/config.json
Пароль адмінки: python3 carcar_sync.py --config /etc/carcar/config.json --set-admin-password 'пароль'
Лише стандартна бібліотека Python 3 (+ python3-cryptography для push).
"""
import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acl  # noqa: E402
from auth import Sessions, TelegramBot, biz_hash, check_admin, make_admin_hash, tg_link_url  # noqa: E402
from pay import LiqPay  # noqa: E402
import places_lookup  # noqa: E402
from push import WebPush  # noqa: E402

KEY_RE = re.compile(r'^[A-Za-z0-9_.:\-]{1,120}$')  # wallet.tel:380… — двокрапка теж
MAX_BODY = 20 * 1024 * 1024  # фото в записах займають місце
WAIT_SECONDS = 25


# ---------- злиття змін ----------

def _ids(lst):
    """Список обʼєктів з унікальним id — зливаємо по id, інакше як простий список."""
    if not all(isinstance(x, dict) and 'id' in x for x in lst):
        return None
    ids = [x['id'] for x in lst]
    return ids if len(set(map(json.dumps, ids))) == len(ids) else None


def merge(base, cur, new):
    """Тристороннє злиття: base — що бачив пристрій, cur — що зараз на сервері, new — що прислав пристрій.
    Зміни пристрою (додане, змінене, видалене відносно base) накладаються на поточне значення сервера."""
    if cur is None:
        return new
    if new == base:
        return cur  # пристрій нічого не змінив
    if cur == base:
        return new
    if isinstance(cur, dict) and isinstance(new, dict):
        b = base if isinstance(base, dict) else {}
        out = dict(cur)
        for k in set(b) | set(new):
            if new.get(k, '__none__') != b.get(k, '__none__'):
                if k in new:
                    out[k] = merge(b.get(k), cur.get(k), new[k]) if isinstance(new[k], (dict, list)) else new[k]
                else:
                    out.pop(k, None)
        return out
    if isinstance(cur, list) and isinstance(new, list):
        b = base if isinstance(base, list) else []
        if _ids(cur) is not None and _ids(new) is not None and _ids(b) is not None:
            key = lambda x: json.dumps(x['id'])
            bm = {key(x): x for x in b}
            nm = {key(x): x for x in new}
            out = []
            for x in cur:
                k = key(x)
                if k in nm:
                    out.append(nm[k] if nm[k] != bm.get(k) else x)
                elif k not in bm:
                    out.append(x)  # додано іншим пристроєм
                # було в base, немає в new — пристрій видалив
            seen = {key(x) for x in cur}
            out += [x for x in new if key(x) not in seen and key(x) not in bm]
            return out
        # Простий список (наприклад, журнал подій): порівнюємо елементи як JSON — швидко й на тисячах записів.
        js = lambda lst: [json.dumps(x, sort_keys=True) for x in lst]
        bj, nj, cj = set(js(b)), set(js(new)), js(cur)
        removed = bj - nj
        cset = set(cj)
        added = [x for x, j in zip(new, js(new)) if j not in bj and j not in cset]
        return [x for x, j in zip(cur, cj) if j not in removed] + added
    return new



# ---------- сховище ----------

# Готовий JSON кожного запису: однаковий для сотень телефонів, тож серіалізуємо один раз.
# Тримаємо сам обʼєкт поруч, щоб його id не дістався іншому обʼєкту; збережені обʼєкти не змінюються на місці.
_JSON = {}


def item_json(x):
    e = _JSON.get(id(x))
    if e is not None and e[0] is x:
        return e[1]
    if len(_JSON) > 300_000:
        _JSON.clear()
    out = json.dumps(x, ensure_ascii=False)
    _JSON[id(x)] = (x, out)
    return out


def value_json(v):
    if isinstance(v, acl.RawJSON):
        return v
    if isinstance(v, list):
        return '[' + ','.join(item_json(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(json.dumps(str(k), ensure_ascii=False) + ':' + item_json(x) for k, x in v.items()) + '}'
    return json.dumps(v, ensure_ascii=False)


ANALYTICS_MAX = 50_000  # журнал подій: останні N (старіші — у резервних копіях)


class Store:
    """Дані в памʼяті (розібрані один раз) + SQLite на диску. Читання не чіпає диск і не розбирає JSON —
    так сотні телефонів з довгим опитуванням не навантажують сервер."""

    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=NORMAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, ver INTEGER NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, role TEXT, subject TEXT, data TEXT, created INTEGER)')
        self.db.execute('CREATE TABLE IF NOT EXISTS notify_prefs (subject TEXT PRIMARY KEY, data TEXT)')
        self.db.commit()
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.cache = {k: (v, json.loads(raw)) for k, raw, v in self.db.execute('SELECT key, value, ver FROM kv')}
        self.ver = max([v for v, _ in self.cache.values()], default=0)
        self.on_change = None  # (key, old, new) — для сповіщень
        self._seen = None  # id подій журналу

    def since(self, ver):
        return {k: val for k, (v, val) in list(self.cache.items()) if v > ver}

    def get(self, key):
        e = self.cache.get(key)
        return e[1] if e else None

    def _save(self, key, value):
        self.ver += 1
        self.cache[key] = (self.ver, value)
        self.db.execute('INSERT INTO kv (key, value, ver) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, ver = excluded.ver',
                        (key, value_json(value), self.ver))
        self.db.commit()
        self.changed.notify_all()

    def add_events(self, value):
        """Журнал подій: лише дописуємо нові (за id), без повного злиття; найстаріші понад ліміт — відкидаємо."""
        with self.lock:
            cur = self.get('analytics') or []
            if self._seen is None:
                self._seen = {json.dumps(x.get('id')) for x in cur if isinstance(x, dict)}
            new = [x for x in value if isinstance(x, dict) and 'id' in x and json.dumps(x['id']) not in self._seen]
            if new:
                merged = (cur + new)[-ANALYTICS_MAX:]
                self._seen = {json.dumps(x.get('id')) for x in merged} if len(cur) + len(new) > ANALYTICS_MAX else self._seen | {json.dumps(x['id']) for x in new}
                self._save('analytics', merged)
            return self.ver

    def put(self, who, key, value, base, has_base):
        """Зміни від пристрою: лише те, що роль може змінити, зливаємо з поточним значенням."""
        with self.lock:
            cur = self.get(key)
            view = acl.read(who, key, cur, self.get)
            b, n, ok = acl.allowed_change(who, key, base if has_base else view, cur, value, self.get)
            if not ok:
                return self.ver, view, False
            merged = merge(b, cur, n) if cur is not None else n
            merged = acl.sanitize(who, key, cur, merged, self.get)
            if merged != cur:
                self._save(key, merged)
                if self.on_change:
                    threading.Thread(target=self.on_change, args=(key, cur, merged), daemon=True).start()
            return self.ver, acl.read(who, key, merged, self.get), True

    def update(self, key, fn):
        """Зміна від самого сервера (оплата, повернення): fn(старе) -> нове."""
        with self.lock:
            cur = self.get(key)
            new = fn(acl.deep(cur))
            if new != cur:
                self._save(key, new)
                if self.on_change:
                    threading.Thread(target=self.on_change, args=(key, cur, new), daemon=True).start()
            return new

    def wait(self, ver, seconds, view):
        """Довге опитування: чекаємо змін, які цей користувач бачить (чужі гаманці, журнал подій тощо його не будять)."""
        deadline = time.time() + seconds
        while True:
            with self.lock:
                if self.ver <= ver:
                    self.changed.wait(max(0.0, deadline - time.time()))
                cur = self.ver
            out = view(self.since(ver))
            # Порожнє ({} чи []) — це чуже, що змінилося (нотатки іншої мийки тощо): не будимо через нього.
            if any(v not in ({}, []) for v in out.values()) or time.time() >= deadline:
                return cur, out
            ver = cur


# ---------- сповіщення про події записів ----------

def booking_events(old, new):
    """Що змінилося в записах — кому й що сказати. Повертає [(кому, заголовок, текст, посилання)]."""
    om = {x.get('id'): x for x in old or [] if isinstance(x, dict)}
    out = []
    for b in new or []:
        if not isinstance(b, dict) or b.get('source'):
            continue
        o = om.get(b.get('id'))
        when = f"{b.get('date', '')[8:10]}.{b.get('date', '')[5:7]} о {b.get('time', '')}"
        svc = ', '.join(b.get('services') or [])
        place = ('place', b.get('placeId'))
        client = ('client', b.get('clientId'))
        pro_url = f"pro.html#/booking/{b.get('id')}"
        cli_url = f"index.html#/bookings/{b.get('id')}"
        st, ost = b.get('state'), (o or {}).get('state')
        if (o is None or ost == 'unpaid') and st == 'pending':
            out.append((place, 'Новий запис — підтвердіть', f"{when} · {svc}. Відповісти протягом 5 хв", pro_url))
        elif (o is None or ost == 'unpaid') and st == 'paid':
            out.append((place, 'Новий запис', f"{when} · {svc} (прийнято автоматично)", pro_url))
        elif o is not None and st != ost:
            if ost == 'pending' and st == 'paid':
                out.append((client, 'Запис підтверджено', f"Мийка чекає вас {when}", cli_url))
            elif ost == 'pending' and st == 'offer':
                out.append((client, 'Мийка пропонує інший час', f"{when}. Підтвердіть або скасуйте без втрат", cli_url))
            elif st == 'cancelled' and b.get('declined') in ('place', 'timeout'):
                out.append((client, 'Мийка не підтвердила запис', 'Гроші повернуто. Оберіть інший час чи мийку', cli_url))
            elif st == 'cancelled' and b.get('cancelBy') == 'client':
                out.append((place, 'Клієнт скасував запис', f"{when} · {svc}", pro_url))
            elif st == 'completed' and ost in ('paid', 'dispute'):
                out.append((client, 'Машина готова', 'Мийка завершила роботу. Можна забирати авто й залишити відгук', cli_url))
            elif st == 'dispute':
                out.append((place, 'Клієнт відкрив спір', f"{when} · гроші заморожено до рішення CARCAR", pro_url))
        # Нове повідомлення в чаті запису
        oc, nc = len((o or {}).get('chat') or []), len(b.get('chat') or [])
        if nc > oc and o is not None:
            m = (b.get('chat') or [])[-1]
            if m.get('from') == 'client':
                out.append((place, 'Повідомлення від клієнта', (m.get('text') or 'Фото')[:120], f"pro.html#/chat/b-{b.get('id')}"))
            elif m.get('from') == 'biz':
                out.append((client, 'Повідомлення від мийки', (m.get('text') or 'Фото')[:120], f"index.html#/chat/{b.get('id')}"))
    return out


def request_events(old, new):
    om = {x.get('id'): x for x in old or [] if isinstance(x, dict)}
    out = []
    for r in new or []:
        o = om.get(r.get('id'))
        msgs, olds = r.get('messages') or [], (o or {}).get('messages') or []
        if len(msgs) > len(olds):
            m = msgs[-1]
            if m.get('from') == 'client':
                out.append((('place', r.get('placeId')), 'Питання від клієнта', (m.get('text') or 'Фото')[:120], f"pro.html#/chat/r-{r.get('id')}"))
            elif m.get('from') == 'biz':
                out.append((('client', r.get('clientId')), 'Мийка відповіла', (m.get('text') or 'Фото')[:120], f"index.html#/ask/{r.get('placeId')}"))
    return out


def call_events(old, new):
    out = []
    for cid, c in (new or {}).items():
        o = (old or {}).get(cid)
        if o is None and c.get('state') == 'ringing':
            if c.get('from') == 'client':
                out.append((('place', c.get('placeId')), 'Вхідний дзвінок CARCAR', f"{c.get('clientName') or 'Клієнт'} дзвонить", 'pro.html#/'))
            else:
                out.append((('client', c.get('clientId')), 'Вхідний дзвінок CARCAR', f"{c.get('placeName') or 'Мийка'} дзвонить", 'index.html#/inbox'))
    return out


def acl_norm_plate(s):
    lookalike = str.maketrans({'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X'})
    return re.sub(r'[\s-]', '', str(s or '').upper()).translate(lookalike)


# ---------- авто за держномером (реєстр МВС, див. vehicles_import.py) ----------

# Кросовери й позашляховики — щоб одразу підставити клас (ціна мийки залежить від класу).
CROSSOVERS = {'RAV4', 'RAV 4', 'CR-V', 'HR-V', 'TUCSON', 'SPORTAGE', 'QASHQAI', 'X-TRAIL', 'JUKE', 'KODIAQ', 'KAROQ', 'KAMIQ', 'TIGUAN', 'T-ROC',
              'DUSTER', 'ARKANA', 'CAPTUR', 'KADJAR', 'KOLEOS', 'CX-3', 'CX-30', 'CX-5', 'ASX', 'ECLIPSE CROSS', 'OUTLANDER', 'VITARA', 'S-CROSS',
              'SX4', 'FORESTER', 'XV', 'OUTBACK', 'KUGA', 'ECOSPORT', 'PUMA', 'MOKKA', 'GRANDLAND X', 'CROSSLAND X', '2008', '3008', '5008',
              'C-HR', 'CRETA', 'KONA', 'SELTOS', 'NIRO', 'STONIC', 'X1', 'X2', 'X3', 'X4', 'Q2', 'Q3', 'Q5', 'GLA', 'GLB', 'GLC', 'NX', 'UX', 'XC40', 'XC60',
              'COMPASS', 'RENEGADE', 'ZS', 'HS', 'TIGGO', 'COOLRAY', 'ATLAS', 'JOLION', 'H6', 'EV6', 'ID.4', 'MODEL Y', 'ENYAQ'}
SUVS = {'LAND CRUISER', 'LAND CRUISER PRADO', 'PRADO', 'HIGHLANDER', 'SEQUOIA', 'PAJERO', 'PAJERO SPORT', 'PATROL', 'X5', 'X6', 'X7', 'Q7', 'Q8',
        'TOUAREG', 'GLE', 'GLS', 'G-CLASS', 'GX', 'LX', 'RX', 'XC90', 'CAYENNE', 'RANGE ROVER', 'DISCOVERY', 'DEFENDER', 'SANTA FE', 'SORENTO',
        'GRAND CHEROKEE', 'EXPLORER', 'TAHOE', 'ESCALADE', 'MODEL X', 'MULTIVAN', 'TRANSPORTER', 'CARAVELLE', 'VITO', 'V-CLASS', 'SPRINTER',
        'TRAFIC', 'VIVARO', 'EXPERT', 'JUMPY', 'TRANSIT', 'DUCATO', 'BOXER', 'JUMPER', 'MASTER', 'CRAFTER', 'SHARAN', 'GALAXY', 'ZAFIRA',
        'HILUX', 'L200', 'NAVARA', 'RANGER', 'AMAROK', 'H-1', 'STARIA', 'CARNIVAL', 'SIENNA', 'ODYSSEY', 'ALPHARD'}


def car_class(brand, model, body):
    m = re.sub(r'\s+', ' ', f'{model}'.upper()).strip()
    b = (body or '').upper()
    if any(w in b for w in ('ПОЗАШЛЯХ', 'ПІКАП', 'МІНІВЕН', 'ФУРГОН', 'АВТОБУС')):
        return 2
    words = m.replace(brand.upper(), '').strip()
    if any(words == x or words.startswith(x + ' ') for x in SUVS):
        return 2
    if any(words == x or words.startswith(x + ' ') for x in CROSSOVERS):
        return 1
    return 0


def nice(s):
    """TOYOTA → Toyota, але BMW, VW, ZAZ лишаються великими."""
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    return ' '.join(w if len(w) <= 3 or any(ch.isdigit() for ch in w) else w.capitalize() for w in s.split(' '))


def _txt(v):
    """Поле відповіді сервісу: рядок або {ua: …, slug: …}."""
    if isinstance(v, dict):
        return str(v.get('ua') or v.get('title') or v.get('name') or v.get('slug') or '')
    return '' if v is None else str(v)


def car_from(brand, model, year, color, fuel, cap, body, registered=''):
    brand = re.sub(r'\s+', ' ', brand or '').strip()
    # У реєстрі модель часто разом з маркою: «TOYOTA RAV4».
    model_only = re.sub('^' + re.escape(brand) + r'\s+', '', model or '', flags=re.I) if brand else (model or '')
    try:
        cap = int(float(cap)) if cap not in (None, '') else None
    except (TypeError, ValueError):
        cap = None
    try:
        year = int(year) if year not in (None, '') else None
    except (TypeError, ValueError):
        year = None
    return {'make': nice(brand), 'model': nice(model_only), 'year': year, 'color': (color or '').lower(), 'fuel': (fuel or '').lower(),
            'engine': f"{cap / 1000:.1f} л".replace('.', ',') if cap and cap > 300 else '', 'body': (body or '').lower(),
            'cls': car_class(brand, model_only, body), 'registered': registered}


def parse_baza_gai(j):
    """Відповідь baza-gai.com.ua (дані МВС): марка й модель — зверху, колір, пальне, кузов — в останній операції."""
    ops = [o for o in j.get('operations') or [] if isinstance(o, dict)]
    last = next((o for o in ops if o.get('is_last')), ops[0] if ops else {})
    brand = _txt(j.get('vendor') or last.get('vendor') or j.get('brand') or last.get('brand'))
    if not brand:
        return {}
    return car_from(brand, _txt(j.get('model') or last.get('model')), j.get('model_year') or last.get('model_year') or j.get('year'),
                    _txt(last.get('color') or j.get('color')), _txt(last.get('fuel') or j.get('fuel')),
                    last.get('capacity') or j.get('capacity') or last.get('engine_volume'), _txt(last.get('body') or j.get('body')),
                    _txt(last.get('registered_at') or j.get('registered_at')))


class Vehicles:
    """Авто за держномером. Джерела по черзі: власна копія реєстру МВС (vehicles.db, якщо завантажили)
    і онлайн-сервіс (baza-gai.com.ua за ключем API). Відповіді сервісу кешуються на 30 днів — щоб не витрачати ліміт."""

    def __init__(self, path, api, store):
        self.path, self.db, self.mtime = path, None, 0
        self.api = api if isinstance(api, dict) and api.get('key') else None
        self.store = store
        with store.lock:
            store.db.execute('CREATE TABLE IF NOT EXISTS vehicle_cache (plate TEXT PRIMARY KEY, data TEXT, at INTEGER)')
            store.db.commit()

    @property
    def available(self):
        return bool(self.api) or os.path.exists(self.path)

    def local(self, plate):
        try:
            mtime = os.path.getmtime(self.path)
        except OSError:
            return None
        if self.db is None or mtime != self.mtime:  # база оновилась — відкриваємо нову
            self.db = sqlite3.connect(f'file:{self.path}?mode=ro', uri=True, check_same_thread=False)
            self.mtime = mtime
        row = self.db.execute('SELECT brand, model, year, color, fuel, capacity, body, kind, d_reg FROM vehicles WHERE plate = ?', (plate,)).fetchone()
        if not row:
            return {}
        brand, model, year, color, fuel, cap, body, _kind, d_reg = row
        return car_from(brand, model, year, color, fuel, cap, body, d_reg)

    def online(self, plate):
        row = self.store.db.execute('SELECT data, at FROM vehicle_cache WHERE plate = ?', (plate,)).fetchone()
        if row:
            data = json.loads(row[0])
            if time.time() - row[1] < (30 if data else 1) * 86400:
                return data
        url = (self.api.get('url') or 'https://baza-gai.com.ua/nomer/{plate}').replace('{plate}', urllib.parse.quote(plate))
        req = urllib.request.Request(url, headers={'Accept': 'application/json', 'X-Api-Key': self.api['key'], 'User-Agent': 'CARCAR'})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                data = parse_baza_gai(json.loads(r.read()))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                data = {}
            else:
                return {'error': 'Сервіс перевірки номерів зараз недоступний' if e.code >= 500 else
                        'Ліміт перевірок номерів вичерпано' if e.code == 429 else 'Перевірте ключ API сервісу номерів'}
        except Exception:
            return {'error': 'Сервіс перевірки номерів зараз недоступний'}
        with self.store.lock:
            self.store.db.execute('INSERT OR REPLACE INTO vehicle_cache VALUES (?, ?, ?)', (plate, json.dumps(data, ensure_ascii=False), int(time.time())))
            self.store.db.commit()
        return data

    def lookup(self, plate):
        """None — джерел немає; {} — не знайдено; {'error': …} — сервіс не відповів; інакше — дані авто."""
        car = self.local(plate)
        if car:
            return car
        if self.api:
            return self.online(plate)
        return car


def kyiv_now():
    try:
        from zoneinfo import ZoneInfo
        from datetime import datetime
        return datetime.now(ZoneInfo('Europe/Kyiv'))
    except Exception:  # немає бази часових поясів — час сервера
        from datetime import datetime
        return datetime.now()


def muted(prefs, kind, who):
    """Чи мовчати: сповіщення вимкнено або (для мийки) зараз неробочий час і ввімкнено «тишу»."""
    if not prefs:
        return False
    if prefs.get('on') is False:
        return True
    if kind == 'place':
        days = (prefs.get('quiet') or {}).get(who)
        if isinstance(days, dict):
            now = kyiv_now()
            iso = now.strftime('%Y-%m-%d')
            if iso in days:
                h = days[iso]
                m = now.hour * 60 + now.minute
                return not h or not (h[0] <= m < h[1])
    return False


class Notifier:
    def __init__(self, store, webpush, bot):
        self.store, self.webpush, self.bot = store, webpush, bot

    def prefs(self, subject):
        row = self.store.db.execute('SELECT data FROM notify_prefs WHERE subject = ?', (subject,)).fetchone()
        return json.loads(row[0]) if row else None

    def on_change(self, key, old, new):
        try:
            events = {'bookings': booking_events, 'requests': request_events, 'calls': call_events}.get(key, lambda a, b: [])(old, new)
            for (kind, who), title, text, url in events:
                if who:
                    self.send(kind, who, title, text, url)
        except Exception as e:  # сповіщення не мають ламати збереження
            print('notify error', e, flush=True)

    def place_subjects(self, pid):
        """Хто керує мийкою: акаунти з biz.accounts; якщо нікому не належить — демо-кабінет."""
        accounts = self.store.get('biz.accounts') or []
        logins = [a.get('login') for a in accounts if pid == a.get('placeId') or pid in (a.get('places') or [])]
        return [f'acct:{x}' for x in logins] or ['acct:*demo*']

    def send(self, kind, who, title, text, url):
        subjects = [who] if kind == 'client' else self.place_subjects(who)
        msg = {'title': title, 'body': text, 'url': url, 'tag': f'{kind}-{who}-{title}'}
        for subject in subjects:
            if muted(self.prefs(subject), kind, who):
                continue
            rows = self.store.db.execute('SELECT endpoint, data FROM push_subs WHERE subject = ?', (subject,)).fetchall()
            for endpoint, data in rows:
                if self.webpush.send(json.loads(data), msg) is False:
                    with self.store.lock:
                        self.store.db.execute('DELETE FROM push_subs WHERE endpoint = ?', (endpoint,))
                        self.store.db.commit()
            if self.bot:
                chat = self.store_sessions.tg_chat(subject)
                if chat:
                    self.bot.send(chat, f'🔔 {title}\n{text}')


# ---------- конфігурація ----------

def load_config(path):
    cfg = {}
    if path and os.path.exists(path):
        with open(path) as f:
            cfg = json.load(f)
    cfg.setdefault('demo_login', not cfg.get('telegram_token'))  # без бота — вхід за номером без перевірки
    cfg.setdefault('demo_wash', True)  # демо-кабінет мийки з вигаданими мийками
    return cfg


# ---------- HTTP ----------

class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 1024  # черга нових зʼєднань (типово 5 — під навантаженням зʼєднання відкидались би)


class Limiter:
    """Не більше N спроб входу за хвилину з однієї адреси — щоб не підбирали паролі."""

    def __init__(self, per_minute=10):
        self.per, self.hits, self.lock = per_minute, {}, threading.Lock()

    def ok(self, ip):
        now = time.time()
        with self.lock:
            self.hits[ip] = [t for t in self.hits.get(ip, []) if now - t < 60]
            return len(self.hits[ip]) < self.per

    def fail(self, ip):
        with self.lock:
            self.hits.setdefault(ip, []).append(time.time())


def make_handler(app):
    store, cfg, sessions = app['store'], app['cfg'], app['sessions']
    static_dir = app['static']
    limiter = Limiter()
    veh_limiter = Limiter(30)  # перевірок номерів на хвилину з одного акаунта — щоб реєстр не вивантажували

    def setting(name):
        """Демо-режим: вирішує адмінка (ключ admin.server, діє одразу), інакше — конфігурація сервера.
        Демо-вхід без бота Telegram не вимикається: інакше клієнти не змогли б увійти взагалі."""
        v = (store.get('admin.server') or {}).get(name)
        if name == 'demoLogin' and not cfg.get('telegram_token'):
            return True
        if isinstance(v, bool):
            return v
        return bool({'demoLogin': cfg.get('demo_login'), 'demoWash': cfg.get('demo_wash', True), 'demoPlaces': cfg.get('demo_places', True)}[name])

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, fmt, *args):
            pass

        # --- відповіді ---
        def send_json(self, code, obj, raw=None):
            body = (raw if raw is not None else json.dumps(obj, ensure_ascii=False)).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def body_json(self):
            size = int(self.headers.get('Content-Length') or 0)
            if size > MAX_BODY:
                raise ValueError('too large')
            raw = self.rfile.read(size) if size else b''
            if self.headers.get('Content-Type', '').startswith('application/x-www-form-urlencoded'):
                return {k: v[0] for k, v in parse_qs(raw.decode()).items()}
            return json.loads(raw or b'{}')

        def ip(self):
            # X-Real-IP ставить nginx; напряму (не з цього ж сервера) заголовку не віримо — інакше обійдуть ліміт спроб входу.
            peer = self.client_address[0]
            return (self.headers.get('X-Real-IP') or peer) if peer in ('127.0.0.1', '::1') else peer

        # --- хто питає ---
        def who(self):
            token = (self.headers.get('Authorization') or '').removeprefix('Bearer ').strip()
            s = sessions.get(token)
            if not s:
                return acl.Who()
            role, sub = s
            w = acl.Who(role, cid=sub.get('cid'), login=sub.get('login'), demo=bool(sub.get('demo')))
            if role == 'place':
                if w.demo and not setting('demoWash'):
                    return acl.Who()
                w.places = acl.account_places(store.get, w)
            return w

        def subject(self, w):
            return w.cid if w.role == 'client' else f"acct:{'*demo*' if w.demo else w.login}" if w.role == 'place' else 'admin'

        # --- GET ---
        def do_GET(self):
            url = urlparse(self.path)
            q = parse_qs(url.query)
            p = url.path
            if p == '/api/ping':
                return self.send_json(200, {'ok': True, 'ver': store.ver})
            if p == '/api/config':
                return self.send_json(200, {
                    'telegramBot': cfg.get('telegram_bot') if cfg.get('telegram_token') else None,
                    'demoLogin': setting('demoLogin'), 'demoWash': setting('demoWash'), 'demoPlaces': setting('demoPlaces'),
                    'payments': 'liqpay' if app['liqpay'].on else 'demo', 'sandbox': app['liqpay'].sandbox,
                    'vapid': app['webpush'].public if app['webpush'].ok else None, 'turn': bool(cfg.get('turn')),
                    'googlePlaces': bool(cfg.get('google_places_key'))})
            if p.startswith('/api/avatar/'):
                # Фото профілю клієнта за випадковим номером: віддаємо картинкою з довгим кешем (номер версії — у ?v=).
                got = acl.avatar_image(store.get('avatars'), unquote(p[len('/api/avatar/'):]))
                if not got:
                    return self.send_json(404, {'error': 'not found'})
                ctype, data = got
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if p == '/api/me':
                w = self.who()
                return self.send_json(200, {'role': w.role, 'cid': w.cid, 'login': w.login, 'demo': w.demo, 'places': sorted(w.places)})
            if p == '/api/state':
                w = self.who()
                try:
                    since = int((q.get('since') or ['0'])[0] or 0)
                except ValueError:
                    return self.send_json(400, {'error': 'bad since'})

                def view(data):
                    out = {}
                    for k, v in data.items():
                        r = acl.read_fast(w, k, v, store.get, item_json)
                        if r is not None:
                            out[k] = r
                    return out
                if (q.get('wait') or ['0'])[0] == '1':
                    ver, out = store.wait(since, WAIT_SECONDS, view)
                else:
                    ver, out = store.ver, view(store.since(since))
                data = ','.join(json.dumps(k, ensure_ascii=False) + ':' + value_json(v) for k, v in out.items())
                return self.send_json(200, None, raw=f'{{"ver":{ver},"data":{{{data}}}}}')
            if p == '/api/auth/tg/check':
                row = sessions.tg_check((q.get('nonce') or [''])[0])
                if not row:
                    return self.send_json(200, {'pending': True})
                phone, name, _ = row
                token = sessions.create('client', {'cid': phone})
                return self.send_json(200, {'token': token, 'phone': phone, 'name': name})
            if p in ('/api/admin/place-lookup', '/api/admin/place-photo'):
                if not self.who().admin:
                    return self.send_json(403, {'error': 'Лише для адміністрації'})
                try:
                    if p == '/api/admin/place-photo':
                        if not cfg.get('google_places_key'):
                            return self.send_json(400, {'error': 'Немає ключа Google Places'})
                        url = places_lookup.google_photo(cfg['google_places_key'], (q.get('name') or [''])[0], cfg.get('google_places_url') or places_lookup.GOOGLE)
                        return self.send_json(200, {'photo': url})
                    text = (q.get('q') or [''])[0][:500]
                    if not text.strip():
                        return self.send_json(400, {'error': 'Вставте посилання на Google Карти або назву й місто'})
                    found, source = places_lookup.lookup(cfg, text)
                    return self.send_json(200, {'results': found, 'source': source})
                except urllib.error.HTTPError as e:
                    return self.send_json(502, {'error': 'Google не прийняв ключ або вичерпано ліміт' if e.code in (401, 403, 429) else f'Сервіс карт відповів помилкою {e.code}'})
                except Exception:
                    return self.send_json(502, {'error': 'Сервіс карт зараз недоступний'})
            if p == '/api/vehicle':
                w = self.who()
                if w.role == 'anon':
                    return self.send_json(401, {'error': 'Потрібен вхід'})
                who_key = w.cid or w.login or 'demo'
                if not veh_limiter.ok(who_key):
                    return self.send_json(429, {'error': 'Забагато перевірок. Зачекайте хвилину.'})
                veh_limiter.fail(who_key)
                plate = acl_norm_plate((q.get('plate') or [''])[0])
                if not re.match(r'^[A-Z]{2}\d{4}[A-Z]{2}$', plate):
                    return self.send_json(400, {'error': 'Номер має вигляд AA1234BB'})
                car = app['vehicles'].lookup(plate)
                if car is None:
                    return self.send_json(200, {'plate': plate, 'registry': False})
                if 'error' in car:
                    return self.send_json(200, {'plate': plate, 'registry': True, 'car': None, 'error': car['error']})
                return self.send_json(200, {'plate': plate, 'registry': True, 'car': car or None})
            if p == '/api/ice':
                return self.send_json(200, {'iceServers': ice_servers(cfg, self.subject(self.who()))})
            if static_dir:
                return self.serve_static(url.path)
            return self.send_json(404, {'error': 'not found'})

        def do_HEAD(self):
            url = urlparse(self.path)
            if static_dir and not url.path.startswith('/api/'):
                return self.serve_static(url.path)
            return self.send_json(404, {'error': 'not found'})

        # --- POST ---
        def do_POST(self):
            p = urlparse(self.path).path
            try:
                body = self.body_json()
            except ValueError:
                return self.send_json(400, {'error': 'bad body'})
            if p in ('/api/auth/biz', '/api/auth/admin') and not limiter.ok(self.ip()):
                return self.send_json(429, {'error': 'Забагато спроб. Зачекайте хвилину.'})
            if p == '/api/auth/demo':
                if not setting('demoLogin'):
                    return self.send_json(403, {'error': 'Вхід лише через Telegram'})
                cid = acl.phone_key(body.get('phone'))
                if not cid or len(cid) != 16:
                    return self.send_json(400, {'error': 'Невірний номер'})
                return self.send_json(200, {'token': sessions.create('client', {'cid': cid}), 'phone': cid})
            if p == '/api/auth/tg/start':
                if not cfg.get('telegram_token'):
                    return self.send_json(404, {'error': 'Telegram не налаштовано'})
                nonce = sessions.tg_start()
                return self.send_json(200, {'nonce': nonce, 'url': tg_link_url(cfg.get('telegram_bot'), nonce)})
            if p == '/api/auth/biz':
                if body.get('demo'):
                    if not setting('demoWash'):
                        return self.send_json(403, {'error': 'Демо-кабінет вимкнено'})
                    return self.send_json(200, {'token': sessions.create('place', {'demo': True})})
                login = str(body.get('login') or '').strip().lower()
                acc = next((a for a in store.get('biz.accounts') or [] if a.get('login') == login), None)
                if not acc or not hmac.compare_digest(acc.get('hash', ''), biz_hash(login, str(body.get('password') or ''))):
                    limiter.fail(self.ip())
                    return self.send_json(401, {'error': 'Невірний логін або пароль.'})
                return self.send_json(200, {'token': sessions.create('place', {'login': login}), 'login': login, 'placeId': acc.get('placeId')})
            if p == '/api/auth/admin':
                if not cfg.get('admin_password_hash') or not check_admin(str(body.get('password') or ''), cfg['admin_password_hash']):
                    limiter.fail(self.ip())
                    return self.send_json(401, {'error': 'Невірний пароль'})
                return self.send_json(200, {'token': sessions.create('admin', {})})
            if p == '/api/auth/logout':
                sessions.drop((self.headers.get('Authorization') or '').removeprefix('Bearer ').strip())
                return self.send_json(200, {'ok': True})
            if p == '/api/push/subscribe':
                w = self.who()
                sub = body.get('subscription') or {}
                if w.role == 'anon' or not str(sub.get('endpoint', '')).startswith('https://'):
                    return self.send_json(400, {'error': 'bad subscription'})
                with store.lock:
                    store.db.execute('INSERT INTO push_subs VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET role = excluded.role, subject = excluded.subject, data = excluded.data',
                                     (sub['endpoint'], w.role, self.subject(w), json.dumps(sub), int(time.time())))
                    store.db.commit()
                return self.send_json(200, {'ok': True})
            if p == '/api/push/unsubscribe':
                with store.lock:
                    store.db.execute('DELETE FROM push_subs WHERE endpoint = ?', (str(body.get('endpoint') or ''),))
                    store.db.commit()
                return self.send_json(200, {'ok': True})
            if p == '/api/notify/prefs':
                w = self.who()
                if w.role == 'anon':
                    return self.send_json(401, {'error': 'Потрібен вхід'})
                quiet = body.get('quiet') if isinstance(body.get('quiet'), dict) else {}
                prefs = {'on': body.get('on') is not False,
                         'quiet': {pid: days for pid, days in quiet.items() if w.role != 'place' or pid in w.places}}
                data = json.dumps(prefs)
                if len(data) > 100_000:
                    return self.send_json(400, {'error': 'too big'})
                with store.lock:
                    store.db.execute('INSERT INTO notify_prefs VALUES (?, ?) ON CONFLICT(subject) DO UPDATE SET data = excluded.data', (self.subject(w), data))
                    store.db.commit()
                return self.send_json(200, {'ok': True})
            if p == '/api/notify/telegram':
                w = self.who()
                if w.role == 'anon' or not cfg.get('telegram_token'):
                    return self.send_json(400, {'error': 'Telegram не налаштовано'})
                code = secrets.token_urlsafe(12).replace('-', 'x').replace('_', 'y')
                app['links'][code] = (self.subject(w), time.time())
                return self.send_json(200, {'url': tg_link_url(cfg.get('telegram_bot'), 'link_' + code)})
            if p == '/api/pay/create':
                return self.pay_create(body)
            if p == '/api/pay/liqpay/callback':
                return self.pay_callback(body)
            return self.send_json(404, {'error': 'not found'})

        # --- PUT ---
        def do_PUT(self):
            url = urlparse(self.path)
            m = re.match(r'^/api/state/(.+)$', url.path)
            key = unquote(m.group(1)) if m else ''
            if not KEY_RE.match(key):
                return self.send_json(400, {'error': 'bad key'})
            try:
                body = self.body_json()
            except ValueError:
                return self.send_json(400, {'error': 'bad body'})
            w = self.who()
            # Мийка повертає гроші клієнту, якого знає лише за хешем номера, — знаходимо справжній гаманець.
            if key.startswith('wallet.h:') and w.role == 'place':
                real = acl.resolve_client(w, key[len('wallet.'):], store.get)
                if not real:
                    return self.send_json(403, {'error': 'unknown client'})
                key = 'wallet.' + real
                body = {'value': body.get('value')}
            if key == 'analytics' and w.role == 'anon':
                return self.send_json(403, {'error': 'login required'})
            if key == 'analytics' and isinstance(body.get('value'), list):
                return self.send_json(200, {'ver': store.add_events(body['value']), 'value': store.get('analytics') if w.admin else None})
            ver, value, ok = store.put(w, key, body.get('value'), body.get('base'), 'base' in body)
            self.send_json(200 if ok else 403, {'ver': ver, 'value': value})

        # --- оплата ---
        def pay_create(self, body):
            w = self.who()
            lp = app['liqpay']
            b = body.get('booking') or {}
            if w.role != 'client' or not lp.on:
                return self.send_json(400, {'error': 'Оплата недоступна'})
            if b.get('clientId') != w.cid or b.get('state') != 'unpaid' or not b.get('id'):
                return self.send_json(400, {'error': 'Невірний запис'})
            # Запис з'являється на сервері зі статусом «очікує оплати» — час тримаємо 15 хв.
            view = [x for x in acl.read(w, 'bookings', store.get('bookings'), store.get) or [] if x.get('id') != b['id']]
            store.put(w, 'bookings', view + [b], None, False)
            base = app['public_url'] or f"https://{self.headers.get('Host')}"
            try:
                amount = float(b.get('paid') or 0)
            except (TypeError, ValueError):
                amount = 0
            if amount <= 0:
                return self.send_json(400, {'error': 'Нічого сплачувати'})
            form = lp.checkout(b['id'], amount, f"CARCAR: {', '.join(b.get('services') or [])}", f"{base}/#/bookings/{b['id']}", f"{base}/api/pay/liqpay/callback")
            return self.send_json(200, form)

        def pay_callback(self, body):
            info = app['liqpay'].parse_callback(body.get('data'), body.get('signature'))
            if not info:
                return self.send_json(400, {'error': 'bad signature'})
            bid, status = info.get('order_id'), info.get('status')
            auto = store.get('biz.autoConfirm') or {}

            def apply(lst):
                for b in lst or []:
                    if b.get('id') != bid:
                        continue
                    if status in ('success', 'sandbox') and b.get('state') == 'unpaid':
                        now = int(time.time() * 1000)
                        # Автопідтвердження мийки чи запис за її ж пропозицією в чаті — одразу підтверджено.
                        ok = bool(auto.get(b.get('placeId')) or b.get('fromReq'))
                        b.update({'state': 'paid' if ok else 'pending', 'needsConfirm': not ok,
                                  'createdAt': now, 'payment': {'provider': 'liqpay', 'id': info.get('payment_id'), 'amount': info.get('amount'), 'at': now}})
                    elif status in ('failure', 'error', 'reversed') and b.get('state') == 'unpaid':
                        b.update({'state': 'cancelled', 'cancelBy': 'system', 'closedAt': int(time.time() * 1000), 'payFailed': info.get('err_description') or status})
                return lst
            store.update('bookings', apply)
            return self.send_json(200, {'ok': True})

        # --- статика (для перевірки без nginx) ---
        def serve_static(self, path):
            rel = os.path.normpath(unquote(path).lstrip('/')) or 'index.html'
            if rel == '.':
                rel = 'index.html'
            full = os.path.join(static_dir, rel)
            if rel.startswith('..') or not os.path.isfile(full):
                return self.send_json(404, {'error': 'not found'})
            with open(full, 'rb') as f:
                data = f.read()
            if full.endswith('.html'):  # позначка для застосунку: поруч є спільні дані
                data = data.replace(b'</head>', b'<meta name="carcar-sync" content="1"></head>', 1)
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(full)[0] or 'application/octet-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

    return Handler


def ice_servers(cfg, subject):
    """STUN завжди; TURN (coturn з use-auth-secret) — тимчасові облікові дані на 12 годин."""
    out = [{'urls': ['stun:stun.l.google.com:19302']}]
    turn = cfg.get('turn') or {}
    if turn.get('secret') and turn.get('host'):
        user = f"{int(time.time()) + 12 * 3600}:{subject}"
        cred = base64.b64encode(hmac.new(turn['secret'].encode(), user.encode(), hashlib.sha1).digest()).decode()
        host = turn['host']
        out.append({'urls': [f'turn:{host}:3478?transport=udp', f'turn:{host}:3478?transport=tcp'], 'username': user, 'credential': cred})
    return out


def refunds_loop(app):
    """Повернення на картку через LiqPay: запис скасовано з поверненням — просимо банк повернути гроші."""
    store, lp = app['store'], app['liqpay']
    while True:
        time.sleep(30)
        if not lp.on:
            continue
        todo = [b for b in store.get('bookings') or [] if (b.get('payment') or {}).get('provider') == 'liqpay'
                and b.get('refundTo') == 'card' and (b.get('refund') or 0) > 0 and not b.get('refundDone') and b.get('state') in ('cancelled', 'refunded')]
        for b in todo:
            card_part = max(0.0, float(b.get('refund') or 0) - min(float(b.get('fromBalance') or 0), float(b.get('refund') or 0)))
            card_part = min(card_part, float((b.get('payment') or {}).get('amount') or card_part))
            if card_part <= 0:
                continue
            res = lp.refund(b['id'], card_part)
            ok = res.get('status') in ('reversed', 'success', 'sandbox')

            def mark(lst, bid=b['id'], ok=ok, res=res):
                for x in lst or []:
                    if x.get('id') == bid:
                        if ok:
                            x['refundDone'] = int(time.time() * 1000)
                        else:
                            x['refundError'] = res.get('err_description') or res.get('status')
                return lst
            store.update('bookings', mark)


def unpaid_loop(app):
    """Запис, який так і не оплатили за 15 хв, звільняє час."""
    store = app['store']
    while True:
        time.sleep(60)
        limit = (time.time() - 15 * 60) * 1000

        def expire(lst):
            for b in lst or []:
                if b.get('state') == 'unpaid' and (b.get('createdAt') or 0) < limit:
                    b.update({'state': 'cancelled', 'cancelBy': 'system', 'closedAt': int(time.time() * 1000), 'payFailed': 'Час на оплату минув'})
            return lst
        store.update('bookings', expire)


def main():
    ap = argparse.ArgumentParser(description='Сервер CARCAR')
    ap.add_argument('--port', type=int, default=8090)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--db', default='/var/lib/carcar/data.db')
    ap.add_argument('--config', default='')
    ap.add_argument('--static', default='', help='тека застосунку, щоб віддавати його без nginx (для перевірки)')
    ap.add_argument('--public-url', default='', help='адреса сайту для повернення з оплати, напр. https://185.166.155.225.sslip.io')
    ap.add_argument('--set-admin-password', default=None, help='записати пароль адмінки в конфігурацію й вийти')
    a = ap.parse_args()
    if a.set_admin_password is not None:
        cfg = json.load(open(a.config)) if a.config and os.path.exists(a.config) else {}
        cfg['admin_password_hash'] = make_admin_hash(a.set_admin_password)
        os.makedirs(os.path.dirname(os.path.abspath(a.config)), exist_ok=True)
        with open(a.config, 'w') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.chmod(a.config, 0o600)
        print('Пароль адмінки збережено')
        return
    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('application/manifest+json', '.webmanifest')
    cfg = load_config(a.config)
    store = Store(a.db)
    sessions = Sessions(store.db, store.lock)
    webpush = WebPush(os.path.dirname(os.path.abspath(a.db)))
    app = {'store': store, 'cfg': cfg, 'sessions': sessions, 'static': a.static and os.path.abspath(a.static),
           'vehicles': Vehicles(cfg.get('vehicles_db') or os.path.join(os.path.dirname(os.path.abspath(a.db)), 'vehicles.db'), cfg.get('vehicle_api'), store),
           'liqpay': LiqPay(cfg.get('liqpay')), 'webpush': webpush, 'links': {}, 'public_url': a.public_url or cfg.get('public_url', '')}

    def on_link(code):
        subject, at = app['links'].pop(code, (None, 0))
        return subject if subject and time.time() - at < 3600 else None
    bot = TelegramBot(cfg['telegram_token'], sessions, on_link) if cfg.get('telegram_token') else None
    acl.REQUIRE_PAYMENT = app['liqpay'].on
    notifier = Notifier(store, webpush, bot)
    notifier.store_sessions = sessions
    store.on_change = notifier.on_change
    if bot:
        bot.start()
    threading.Thread(target=refunds_loop, args=(app,), daemon=True).start()
    threading.Thread(target=unpaid_loop, args=(app,), daemon=True).start()
    threading.stack_size(512 * 1024)  # потік на кожне зʼєднання — менше памʼяті на тисячу телефонів
    srv = Server((a.host, a.port), make_handler(app))
    print(f"CARCAR sync: http://{a.host}:{a.port}  db={a.db}  ver={store.ver}  telegram={'так' if bot else 'ні'}  "
          f"оплата={'LiqPay' if app['liqpay'].on else 'демо'}  push={'так' if webpush.ok else 'ні'}  адмінка={'так' if cfg.get('admin_password_hash') else 'не налаштовано'}", flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
