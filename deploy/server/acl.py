"""Права доступу до спільних даних CARCAR.

Ролі (визначає вхід, див. auth.py):
  anon   — без входу: бачить каталог (мийки, ціни, відгуки, зайнятість часу);
  client — клієнт, ідентифікатор — номер телефону 'tel:380…': свої записи, гаманець, питання, звернення;
  place  — мийка: записи, чати й налаштування своїх мийок (номери клієнтів CARCAR приховані);
  admin  — адміністрація CARCAR: усе.

Для кожного ключа даних: що роль бачить (read) і що може змінити (write). Чуже, яке потрібне для роботи
(наприклад, зайнятість боксів), віддаємо урізаним — без імен, телефонів, адрес і грошей.
"""
import copy
import re
import json

# ---------- допоміжне ----------


def phone_key(phone):
    """Те саме, що phoneKey у core.js: tel:380XXXXXXXXX."""
    d = ''.join(ch for ch in str(phone or '') if ch.isdigit())
    if not d:
        return None
    if len(d) == 10 and d.startswith('0'):
        d = '38' + d
    if len(d) == 9:
        d = '380' + d
    return 'tel:' + d


# Секрет сервера для відбитків номерів (ставить carcar_sync.py при запуску; зберігається в базі).
# Без секрету відбиток можна було б порахувати самому й перебором номерів дізнатися телефон клієнта CARCAR.
HASH_SECRET = b''


def legacy_phone_hash(phone):
    """Старий відбиток (FNV-1a без секрету) — лише щоб перенести давні нотатки на новий."""
    key = phone_key(phone)
    if not key:
        return ''
    h = 0x811C9DC5
    for ch in ('carcar:' + key).encode():
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return 'h:%08x' % h


def phone_hash(phone):
    """Відбиток номера замість самого номера: мийка впізнає свого клієнта, не бачачи номер (HMAC із секретом сервера)."""
    key = phone_key(phone)
    if not key:
        return ''
    if not HASH_SECRET:
        return legacy_phone_hash(phone)
    import hmac as _hmac
    return 'h:' + _hmac.new(HASH_SECRET, key.encode(), 'sha256').hexdigest()[:16]


def hidden_phone(v):
    return isinstance(v, str) and v.startswith('h:')


# Що лишається від чужого запису: лише зайнятість часу й статистика відповідей мийки.
BOOKING_PUBLIC = ('id', 'placeId', 'date', 'time', 'minutes', 'state', 'source', 'no', 'createdAt', 'respondedAt',
                  'confirmedAt', 'closedAt', 'declined', 'cancelBy', 'needsConfirm', 'offer', 'deal')


def pick(d, keys):
    return {k: d[k] for k in keys if k in d}


# Поля, за якими можна дізнатися номер клієнта CARCAR. Мийці замість них — хеш (впізнати клієнта можна, номер — ні).
ID_FIELDS = ('clientId', 'clientKey', 'clientPhone')


def mask_ids(x):
    """Запис чи повідомлення, як його бачить мийка: без номера клієнта CARCAR (свої записи мийки — як є)."""
    if not isinstance(x, dict) or x.get('source'):
        return x
    y = dict(x)
    for f in ID_FIELDS:
        v = y.get(f)
        if isinstance(v, str) and v and not hidden_phone(v) and (f == 'clientPhone' or v.startswith('tel:')):
            y[f] = phone_hash(v)
    return y


def unmask_ids(who, merged, cur_items, get):
    """Мийка повертає змінене з хешами — підставляємо справжні номери (лише клієнтів її мийок)."""
    tel, raw = {}, {}

    def add(items):
        for x in items or []:
            if not isinstance(x, dict) or not owns(who, x.get('placeId'), get):
                continue
            for f in ID_FIELDS:
                v = x.get(f)
                if not isinstance(v, str) or not v or hidden_phone(v):
                    continue
                h = phone_hash(v)
                if not h:
                    continue
                if f == 'clientPhone':
                    raw.setdefault(h, v)
                elif v.startswith('tel:'):
                    tel[h] = v
    add(get('bookings'))
    add(get('requests'))
    add(cur_items)

    def fix(x):
        if not isinstance(x, dict) or not any(hidden_phone(x.get(f)) for f in ID_FIELDS):
            return x
        y = dict(x)
        for f in ID_FIELDS:
            if hidden_phone(y.get(f)):
                real = raw.get(y[f]) if f == 'clientPhone' else tel.get(y[f])
                if real:
                    y[f] = real
        return y
    if isinstance(merged, list):
        return [fix(x) for x in merged]
    if isinstance(merged, dict):
        return {k: fix(v) for k, v in merged.items()}
    return merged


def resolve_client(who, h, get):
    """Справжній ідентифікатор клієнта за хешем — лише серед клієнтів мийок цього акаунта."""
    for key in ('bookings', 'requests'):
        for x in get(key) or []:
            if isinstance(x, dict) and owns(who, x.get('placeId'), get):
                v = x.get('clientId')
                if isinstance(v, str) and v.startswith('tel:') and phone_hash(v) == h:
                    return v
    return None


# Ключі, у яких мийка бачить клієнтів CARCAR лише за хешем номера.
MASKED_KEYS = ('bookings', 'requests', 'messages', 'calls', 'callLog', 'waitlist', 'support', 'biz.offers')


class Who:
    """Хто робить запит. places — мийки, якими керує акаунт (рахуються наживо з biz.accounts)."""

    def __init__(self, role='anon', cid=None, login=None, demo=False, places=()):
        self.role, self.cid, self.login, self.demo, self.places = role, cid, login, demo, set(places)

    @property
    def admin(self):
        return self.role == 'admin'

    def owns_place(self, pid):
        return self.admin or (self.role == 'place' and pid in self.places)

    def is_client(self, cid):
        return self.role == 'client' and cid and cid == self.cid


def _demo_ids():
    """Вигадані мийки з data.js застосунку — ними (і доданими в демо) керує демо-кабінет."""
    import os
    import re as _re
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'autoservice', 'app', 'data.js')
    try:
        with open(path, encoding='utf-8') as f:
            src = f.read()
        part = src[src.index('export const PLACES = ['):]
        part = part[:part.index('\n];')]
        return set(_re.findall(r"^    id: '([^']+)'", part, _re.M))
    except (OSError, ValueError):
        return set()


DEMO_IDS = _demo_ids()


def account_places(store_get, who):
    """Мийки акаунта мийки: з biz.accounts; демо-кабінет — лише вигадані мийки й додані в демо."""
    accounts = store_get('biz.accounts') or []
    owned = set()
    for a in accounts:
        owned.update([a.get('placeId')] + list(a.get('places') or []))
    owned.discard(None)
    if who.demo:
        # Демо-кабінет: вигадані мийки з data.js і ті, які він сам додав (позначка by='demo' на сервері).
        # Чужу мийку без акаунта (напр. додану адміністрацією) приписати собі не можна.
        mine = {x.get('id') for x in store_get('places.custom') or [] if isinstance(x, dict) and x.get('by') == 'demo'}
        return (DEMO_IDS | (set(store_get('biz.demoPlaces') or []) & mine)) - owned
    acc = next((a for a in accounts if a.get('login') == who.login), None)
    if not acc:
        return set()
    return {x for x in [acc.get('placeId')] + list(acc.get('places') or []) if x}


def owns(who, pid, store_get=None):
    if who.admin:
        return True
    if who.role != 'place' or not pid:
        return False
    return pid in who.places


# ---------- політики ----------
# Кожна політика: read(who, value, get) -> value для цієї ролі; can_write(who, item_or_key, get) -> bool;
# restore(who, new_item, cur_item) — повертає приховані поля (телефон), щоб запис не затер справжні дані.

def _client_of(item):
    return item.get('clientId') or None


def _public_booking(b):
    x = pick(b, BOOKING_PUBLIC)
    if b.get('mobile'):
        x['mobile'] = {'hidden': True}
    if isinstance(x.get('offer'), dict):
        x['offer'] = {}
    return x


# Чужі записи потрібні клієнту лише для вільного часу (сьогодні й далі) і статистики відповідей мийок (30 днів).
# Старі чужі записи не надсилаємо — інакше кожна зміна розсилала б усю історію всім телефонам.
STATS_DAYS = 31
_pub = {'src': None, 'day': None, 'items': None}


def _public_view(value):
    """Урізані чужі записи — один раз на версію даних (спільні для всіх клієнтів)."""
    import time as _t
    day = _t.strftime('%Y-%m-%d', _t.localtime(_t.time() - 86400))
    if _pub['src'] is value and _pub['day'] == day:
        return _pub['items']
    small = len(value or []) < 500  # зміни для довгого опитування — рахуємо без спільного кешу повного списку
    since_ms = (_t.time() - STATS_DAYS * 86400) * 1000
    items = []
    for b in value or []:
        if not isinstance(b, dict):
            items.append(None)
            continue
        relevant = str(b.get('date') or '') >= day or (b.get('needsConfirm') and (b.get('createdAt') or 0) >= since_ms)
        items.append(_public_booking(b) if relevant else None)
    if not small:
        _pub.update(src=value, day=day, items=items)
    return items


class RawJSON(str):
    """Готовий JSON (сервер віддає як є)."""


_idx = {'src': None, 'day': None, 'own': None, 'pub': None, 'pub_json': None}


def bookings_json(who, value, dumps):
    """Записи для клієнта чи гостя одразу як JSON: спільна частина (чужі урізані записи) збирається
    один раз на версію даних, до неї додаються лише власні записи клієнта."""
    items = _public_view(value)
    if _idx['src'] is not value or _idx['day'] != _pub['day']:
        own = {}
        for i, b in enumerate(value or []):
            c = _client_of(b) if isinstance(b, dict) else None
            if c:
                own.setdefault(c, []).append(i)
        pub = [(i, dumps(x)) for i, x in enumerate(items) if x is not None]
        _idx.update(src=value, day=_pub['day'], own=own, pub=pub, pub_json=','.join(j for _, j in pub))
    mine = _idx['own'].get(who.cid, []) if who.role == 'client' and who.cid else []
    if not mine:
        return RawJSON('[' + _idx['pub_json'] + ']')
    ms = set(mine)
    return RawJSON('[' + ','.join([dumps(value[i]) for i in mine] + [j for i, j in _idx['pub'] if i not in ms]) + ']')


def read_fast(who, key, value, get, dumps):
    """Те саме, що read, але для довгого опитування: найважче (записи для клієнтів) — з готових шматків JSON."""
    if key == 'bookings' and who.role in ('client', 'anon') and isinstance(value, list):
        return bookings_json(who, value, dumps)
    return read(who, key, value, get)


def read_bookings(who, value, get):
    if who.admin:
        return value
    out = []
    pub = _public_view(value) if who.role != 'place' or not who.places else None
    for i, b in enumerate(value or []):
        if who.role == 'place' and owns(who, b.get('placeId'), get):
            out.append(mask_ids(b))  # клієнт CARCAR — номер прихований
        elif who.is_client(_client_of(b)):
            out.append(b)
        else:
            x = pub[i] if pub is not None else _public_view(value)[i]
            if x is not None:
                out.append(x)
    return out


def write_booking(who, item, cur, get):
    if who.admin:
        return True
    pid = item.get('placeId')
    if owns(who, pid, get) and (cur is None or owns(who, cur.get('placeId'), get)):
        return True
    if who.role == 'client':
        return who.is_client(_client_of(item)) and (cur is None or who.is_client(_client_of(cur)))
    return False


def restore_phone(new, cur):
    if cur and hidden_phone(new.get('clientPhone')):
        new = dict(new)
        new['clientPhone'] = cur.get('clientPhone')
    return new


def read_requests(who, value, get):
    out = []
    for r in value or []:
        if who.admin or who.is_client(_client_of(r)):
            out.append(r)
        elif owns(who, r.get('placeId'), get):
            out.append(mask_ids(r))
    return out


def write_by_place_or_client(who, item, cur, get):
    if who.admin:
        return True
    if owns(who, item.get('placeId'), get) and (cur is None or owns(who, cur.get('placeId'), get)):
        return True
    return who.role == 'client' and who.is_client(_client_of(item)) and (cur is None or who.is_client(_client_of(cur)))


def read_client_items(field):
    """Списки, де власник — клієнт у полі field (clientKey / clientId), а мийка — за placeId."""
    def read(who, value, get):
        out = []
        for x in value or []:
            if who.admin or who.is_client(x.get(field) or x.get('clientId')):
                out.append(x)
            elif owns(who, x.get('placeId'), get):
                out.append(mask_ids(x))
        return out
    return read


def write_client_items(field):
    def can(who, item, cur, get):
        if who.admin:
            return True
        if owns(who, item.get('placeId'), get) and (cur is None or owns(who, cur.get('placeId'), get)):
            return True
        own = lambda x: who.is_client(x.get(field) or x.get('clientId'))
        return who.role == 'client' and own(item) and (cur is None or own(cur))
    return can


def read_reviews(who, value, get):
    out = []
    for r in value or []:
        if who.admin or who.is_client(r.get('clientKey')):
            out.append(r)
        else:
            x = {k: v for k, v in r.items() if k not in ('clientKey', 'clientPhone')}
            if r.get('hidden') and not owns(who, r.get('placeId'), get):
                continue
            out.append(x)
    return out


def write_review(who, item, cur, get):
    if who.admin:
        return True
    if who.role == 'client':
        return who.is_client(item.get('clientKey')) and (cur is None or who.is_client(cur.get('clientKey')))
    # Мийка може лише відповісти на відгук чи поскаржитись — не змінити й не видалити (див. sanitize).
    return cur is not None and owns(who, cur.get('placeId'), get)


def read_tickets(who, value, get):
    out = []
    for t in value or []:
        if who.admin or who.is_client(t.get('clientKey')) or (t.get('from') == 'client' and who.role == 'client' and phone_key(t.get('clientPhone')) == who.cid):
            out.append(t)
        elif owns(who, t.get('placeId'), get):
            out.append(mask_ids(t))
    return out


def write_ticket(who, item, cur, get):
    if who.admin:
        return True
    if owns(who, item.get('placeId'), get) and (cur is None or owns(who, cur.get('placeId'), get)):
        return True
    own = lambda t: who.is_client(t.get('clientKey')) or (who.role == 'client' and phone_key(t.get('clientPhone')) == who.cid)
    return who.role == 'client' and own(item) and (cur is None or own(cur))


def read_apps(who, value, get):
    return [a for a in value or [] if who.admin or who.is_client(a.get('clientId'))
            or (who.role == 'client' and phone_key(a.get('phone')) == who.cid)]


def write_app(who, item, cur, get):
    if who.admin:
        return True
    # Нову заявку подає клієнт, що увійшов за номером (бачитиме статус і дані для входу), але не схвалює.
    return who.role == 'client' and cur is None and item.get('status') == 'new' and not item.get('issued')


# ----- словники {placeId: …} -----

def read_all(who, value, get):
    return value


def read_admin(who, value, get):
    return value if who.admin else None


def write_admin(who, item, cur, get):
    return who.admin


def write_place_key(who, key, cur, get):
    return owns(who, key, get)


def read_partners(who, value, get):
    out = {}
    for pid, pt in (value or {}).items():
        if who.admin or owns(who, pid, get):
            out[pid] = pt
        else:
            out[pid] = pick(pt or {}, ('status', 'demo', 'publishedAt', 'commission'))
    return out


def write_partner(who, pid, cur, get):
    # Нову мийку з кабінету можна створити (зі статусом «на перевірці»), свою — змінювати (обмеження — у sanitize).
    return who.admin or owns(who, pid, get) or (who.role == 'place' and cur is None)


def read_staff(who, value, get):
    # Клієнти бачать імена мийників (хто митиме), але не телефони й не зарплату.
    return {pid: (lst if who.admin or owns(who, pid, get) else [{k: v for k, v in w.items() if k not in ('phone', 'pct', 'perCar', 'paid')} for w in lst or []])
            for pid, lst in (value or {}).items()}


def read_own_dict(who, value, get):
    """Внутрішнє мийки (каса, склад, нотатки про клієнтів): лише її власні мийки."""
    return {pid: v for pid, v in (value or {}).items() if who.admin or owns(who, pid, get)}


def read_own_list(who, value, get):
    return [x for x in value or [] if who.admin or owns(who, x.get('placeId'), get)]


def write_own_list(who, item, cur, get):
    return owns(who, item.get('placeId'), get) and (cur is None or owns(who, cur.get('placeId'), get))


def read_accounts(who, value, get):
    if who.admin:
        return value
    if who.role == 'place' and not who.demo:
        return [{k: v for k, v in a.items() if k != 'hash'} for a in value or [] if a.get('login') == who.login]
    return []


def write_account(who, item, cur, get):
    if who.admin:
        return True
    # Мийка може лише додати до свого акаунта нову мийку (sanitize не дасть змінити пароль чи логін).
    return who.role == 'place' and cur is not None and cur.get('login') == who.login


def read_wallet(who, value, get, key=''):
    cid = key[len('wallet.'):] if key.startswith('wallet.') else None
    return value if who.admin or who.is_client(cid) else None


def write_wallet_key(who, key):
    cid = key[len('wallet.'):] if key.startswith('wallet.') else None
    # Власник гаманця, мийка (повернення за відмову — перевіряє sanitize) і адміністрація.
    return who.admin or who.is_client(cid) or (who.role == 'place' and bool(cid) and cid.startswith('tel:'))


# Як PAYMENT у data.js: скасувати без втрат можна не пізніше ніж за стільки годин до візиту;
# гроші за виконане замовлення заморожені стільки годин.
FREE_CANCEL_HOURS = 1.5
FREEZE_HOURS = 48


def booking_start(b):
    """Початок візиту (Київ) у секундах."""
    import datetime as _dt
    try:
        d = _dt.datetime.strptime(f"{b.get('date')} {b.get('time')}", '%Y-%m-%d %H:%M')
    except (TypeError, ValueError):
        return 0
    try:
        from zoneinfo import ZoneInfo
        return d.replace(tzinfo=ZoneInfo('Europe/Kyiv')).timestamp()
    except Exception:
        return d.timestamp()


def _num(v):
    try:
        return max(0.0, float(v or 0))
    except (TypeError, ValueError):
        return 0.0


def _wallet_caps(b, spent=None):
    """Скільки за цей запис можна повернути на баланс і бонусами. Частина «з балансу» (fromBalance) — не більше,
    ніж справді списали з гаманця за цей запис (spent): інакше вигадане fromBalance перетворювалось би на гроші."""
    money = 0.0
    from_bal = _num(b.get('fromBalance'))
    if spent is not None:
        from_bal = min(from_bal, spent.get(b.get('id'), 0.0))
    if b.get('state') in ('cancelled', 'refunded'):
        refund = _num(b.get('refund'))
        money = refund if b.get('refundTo') == 'balance' else min(from_bal, refund)
    if b.get('payFailed'):
        money = max(money, from_bal)
    bonus = _num(b.get('bonus')) if b.get('state') in ('cancelled', 'refunded') or b.get('payFailed') else 0.0
    return money, bonus


def sanitize_wallet(who, cur, new, get):
    """Гаманець рахує сервер: нові записи історії приймаються лише обґрунтовані. Витрачати (мінус) може власник;
    повертати (плюс) — лише за скасований чи неоплачений запис цього клієнта і не більше, ніж за нього належить."""
    cur = cur if isinstance(cur, dict) else {}
    old_hist = [h for h in cur.get('history') or [] if isinstance(h, dict)]
    seen = {json.dumps(h, sort_keys=True) for h in old_hist}
    added = [h for h in (new or {}).get('history') or [] if isinstance(h, dict) and json.dumps(h, sort_keys=True) not in seen]
    money, bonus = _num(cur.get('money')), _num(cur.get('bonus'))
    owner = who.role == 'client'
    books = {b.get('id'): b for b in get('bookings') or [] if isinstance(b, dict)}
    # Скільки списано за кожен запис (мінус у вже прийнятій історії з bookingId): гроші з балансу й бонуси окремо —
    # межа повернення «з балансу» і бонусів (поля fromBalance/bonus у записі задає клієнт, їм не віримо).
    spent, spent_bonus = {}, {}
    for h in old_hist:
        try:
            a = float(h.get('amount') or 0)
        except (TypeError, ValueError):
            continue
        if a < 0 and h.get('bookingId'):
            d = spent if h.get('kind') == 'money' else spent_bonus
            d[h['bookingId']] = d.get(h['bookingId'], 0.0) - a
    credited = {}
    for h in old_hist:
        if (h.get('amount') or 0) > 0 and h.get('bookingId'):
            k = (h['bookingId'], h.get('kind') == 'money')
            credited[k] = credited.get(k, 0) + float(h['amount'])
    ok = []
    for h in added:
        try:
            amount = float(h.get('amount') or 0)
        except (TypeError, ValueError):
            continue
        is_money = h.get('kind') == 'money'
        if amount < 0:
            if not owner or (money if is_money else bonus) + amount < 0:
                continue
        elif amount > 0 and h.get('ref') and not is_money:
            # Бонус за запрошенням: один раз, лише новому клієнту (без записів), рівно REFERRAL_BONUS, не за свій код.
            code = str(h.get('ref') or '').upper()
            if not owner or abs(amount - REFERRAL_BONUS) > 0.001 or not re.match(r'^CAR[A-Z0-9]{5}$', code) or code == ref_code(who.cid) \
                    or any(x.get('ref') for x in old_hist) or any(who.is_client(b.get('clientId')) for b in books.values()):
                continue
            # Код має належати справжньому клієнту CARCAR (який уже записувався), а не бути вигаданим.
            known = {b.get('clientId') for b in books.values() if isinstance(b.get('clientId'), str) and b['clientId'].startswith('tel:')}
            if not any(ref_code(c) == code for c in known):
                continue
        elif amount > 0:
            b = books.get(h.get('bookingId'))
            if not b:
                continue
            if owner and not who.is_client(b.get('clientId')):
                continue
            if who.role == 'place' and not owns(who, b.get('placeId'), get):
                continue
            cap = _wallet_caps(b, spent)[0] if is_money else min(_wallet_caps(b)[1], spent_bonus.get(b.get('id'), 0.0))
            k = (h['bookingId'], is_money)
            if credited.get(k, 0) + amount > cap + 0.001:
                continue
            credited[k] = credited.get(k, 0) + amount
        else:
            continue
        if is_money:
            money += amount
        else:
            bonus += amount
        ok.append({'amount': amount, 'text': str(h.get('text') or '')[:200], 'at': h.get('at'), **({'kind': 'money'} if is_money else {}),
                   **({'bookingId': h['bookingId']} if h.get('bookingId') else {}), **({'ref': str(h['ref']).upper()} if h.get('ref') else {})})
    return {**{k: v for k, v in cur.items() if k not in ('money', 'bonus', 'history')}, 'money': round(money, 2), 'bonus': round(bonus, 2),
            'history': (ok + old_hist)[:500]}


# ---------- «Приведи друга» ----------
REFERRAL_BONUS = 150  # як REFERRAL.bonus у data.js: другу одразу, тому, хто запросив, — коли друг завершить перше замовлення


def ref_code(cid):
    """Код запрошення клієнта (як refCode у core.js): з номера, але номер із коду не дізнатися."""
    if not cid:
        return ''
    h = 0x811C9DC5
    for ch in ('carcar-ref:' + str(cid)).encode():
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    alphabet, out = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', ''
    for _ in range(5):
        out += alphabet[h % len(alphabet)]
        h //= len(alphabet)
    return 'CAR' + out


# ---------- фото профілю клієнтів ----------
# { номер: { by: клієнт, img: data:image/…, at } }. Номер випадковий (не з телефону). Саме фото й «by» бачить лише власник,
# решта — позначку { at }, а картинку бере за посиланням /api/avatar/<номер> (з кешем браузера), щоб не возити фото всім.
AVATAR_MAX = 200_000


def read_avatars(who, value, get):
    if who.admin:
        return value
    out = {}
    for k, v in (value or {}).items():
        if not isinstance(v, dict):
            continue
        # Лише власнику: іншим перелік номерів фото не віддаємо — номер фото вони бачать лише в тому, що їм і так
        # видно (запис, запит, відгук), а картинку беруть за посиланням /api/avatar/<номер>.
        if who.is_client(v.get('by')):
            out[k] = v
    return out


def write_avatar(who, key, cur, item):
    if who.admin:
        return True
    if who.role != 'client' or not isinstance(item, dict) or not isinstance(key, str) or not (8 <= len(key) <= 40):
        return False
    if cur is not None and not who.is_client(cur.get('by')):
        return False  # чуже фото не змінити
    img = item.get('img')
    return who.is_client(item.get('by')) and (img == '' or (isinstance(img, str) and img.startswith('data:image/') and len(img) <= AVATAR_MAX))


def avatar_image(value, key):
    """(тип, байти) фото за номером — для /api/avatar/<номер>."""
    import base64
    v = (value or {}).get(key)
    img = v.get('img') if isinstance(v, dict) else None
    m = re.match(r'^data:(image/(?:jpeg|png|webp|gif));base64,(.+)$', img or '', re.S)
    if not m:
        return None
    try:
        return m.group(1), base64.b64decode(m.group(2), validate=True)
    except (ValueError, TypeError):
        return None


def read_calls(who, value, get):
    out = {}
    for cid, c in (value or {}).items():
        if who.admin or who.is_client(c.get('clientId')):
            out[cid] = c
        elif owns(who, c.get('placeId'), get):
            out[cid] = mask_ids(c)
    return out


def write_call(who, key, cur, get, item=None):
    c = item or cur or {}
    ok = lambda x: who.admin or who.is_client(x.get('clientId')) or owns(who, x.get('placeId'), get)
    if who.role == 'place' and cur is not None and not owns(who, cur.get('placeId'), get):
        return False
    return ok(c) and (cur is None or ok(cur))


def read_calllog(who, value, get):
    out = []
    for x in value or []:
        if who.admin or who.is_client(x.get('clientId')):
            out.append(x)
        elif owns(who, x.get('placeId'), get):
            out.append(mask_ids(x))
    return out


def write_calllog(who, item, cur, get):
    return write_call(who, None, cur, get, item)


def _mask_sold(s):
    """Абонемент, куплений у застосунку CARCAR: мийка не бачить номера покупця (продані на місці — бачить, номер вписала вона)."""
    if not isinstance(s, dict) or s.get('buyer') == 'place':
        return s
    y = mask_ids(s)
    if y.get('phone'):
        y = {**y, 'phone': phone_hash(y['phone'])}
    return y


def read_passes(who, value, get):
    out = {}
    for pid, p in (value or {}).items():
        if who.admin:
            out[pid] = p
        elif owns(who, pid, get):
            out[pid] = {**(p or {}), 'sold': [_mask_sold(s) for s in (p or {}).get('sold', [])]}
        else:
            out[pid] = {**(p or {}), 'sold': [s for s in (p or {}).get('sold', []) if who.is_client(s.get('clientKey'))]}
    return out


def read_custom_places(who, value, get):
    return value


def write_custom_place(who, item, cur, get):
    return who.admin or owns(who, item.get('id'), get) or (who.role == 'place' and cur is None)


def write_any_auth(who, item, cur, get):
    return who.role != 'anon'


def write_append_only(who, item, cur, get):
    """Журнал подій: додавати може будь-хто, змінювати чи видаляти — лише адміністрація."""
    return who.admin or cur is None


# Тип значення: list (по id), dict (по ключу), raw (ціле значення).
POLICIES = {
    'bookings':        ('list', read_bookings, write_booking),
    'requests':        ('list', read_requests, write_by_place_or_client),
    'messages':        ('list', read_client_items('clientKey'), write_client_items('clientKey')),
    'support':         ('list', read_tickets, write_ticket),
    'reviews':         ('list', read_reviews, write_review),
    'waitlist':        ('list', read_client_items('clientId'), write_client_items('clientId')),
    'payouts':         ('list', lambda w, v, g: [x for x in v or [] if owns(w, x.get('placeId'), g)], lambda w, i, c, g: owns(w, i.get('placeId'), g) and (c is None or owns(w, c.get('placeId'), g))),
    'callLog':         ('list', read_calllog, write_calllog),
    'biz.applications': ('list', read_apps, write_app),
    'biz.accounts':    ('list', read_accounts, write_account),
    'places.custom':   ('list', read_custom_places, write_custom_place),
    'analytics':       ('list', read_admin, write_append_only),
    'admin.campaigns': ('list', read_all, write_admin),
    'admin.promos':    ('list', read_all, write_admin),
    'biz.offers':      ('list', lambda w, v, g: [o if w.admin or w.is_client(o.get('clientKey')) else mask_ids(o) for o in v or [] if w.admin or owns(w, o.get('placeId'), g) or w.is_client(o.get('clientKey'))], write_by_place_or_client),
    'biz.expenses':    ('list', lambda w, v, g: [x for x in v or [] if owns(w, x.get('placeId'), g)], write_by_place_or_client),
    'biz.demoPlaces':  ('raw', read_all, lambda w, i, c, g: w.admin or (w.role == 'place' and w.demo)),
    'partners':        ('dict', read_partners, write_partner),
    'biz.places':      ('dict', read_all, write_place_key),
    'biz.deals':       ('dict', read_all, write_place_key),
    'biz.staff':       ('dict', read_staff, write_place_key),
    'biz.autoConfirm': ('dict', read_all, write_place_key),
    'biz.power':       ('dict', read_all, write_place_key),
    'biz.queue':       ('dict', read_all, write_place_key),
    'biz.queueOn':     ('dict', read_all, write_place_key),
    'biz.passes':      ('dict', read_passes, lambda w, k, c, g: owns(w, k, g) or (w.role == 'client' and c is not None)),
    'biz.stock':       ('dict', read_own_dict, write_place_key),
    'biz.clientNotes': ('dict', read_own_dict, write_place_key),
    'biz.shifts':      ('list', read_own_list, write_own_list),
    'presence':        ('dict', read_all, write_place_key),
    'calls':           ('dict', read_calls, write_call),
    'avatars':         ('dict', read_avatars, write_avatar),
    'admin.settings':  ('raw', read_all, write_admin),
    'admin.server':    ('raw', read_all, write_admin),
    'admin.pauseLift': ('raw', read_all, write_admin),
    'admin.pauses':    ('raw', read_all, write_admin),
    'admin.fraud':     ('raw', read_admin, write_admin),
    'admin.campaignDemo': ('raw', read_admin, write_admin),
    'seq.booking':     ('raw', read_all, write_any_auth),
}


def policy(key):
    if key.startswith('wallet'):
        return ('wallet', None, None)
    return POLICIES.get(key, ('raw', read_admin, write_admin))


def read(who, key, value, get):
    kind, rd, _ = policy(key)
    if kind == 'wallet':
        return read_wallet(who, value, get, key)
    return rd(who, value, get)


def _ids(lst):
    return isinstance(lst, list) and all(isinstance(x, dict) and 'id' in x for x in lst)


def allowed_change(who, key, base, cur, new, get):
    """Залишає в base і new лише те, що роль може змінити. Повертає (base, new, дозволено_взагалі)."""
    kind, _, can = policy(key)
    if who.admin:
        return base, new, True
    if kind == 'wallet':
        return base, new, write_wallet_key(who, key)
    if kind == 'raw':
        return base, new, can(who, new, cur, get)
    if kind == 'list' and key == 'biz.accounts':
        # Рядки акаунтів без id: мийка змінює лише свій (перелік мийок — у sanitize).
        if not isinstance(new, list) or who.role != 'place':
            return base, new, False
        return [], [a for a in new if isinstance(a, dict) and a.get('login') == who.login], True
    if kind == 'list':
        if not _ids(new) or (cur is not None and not _ids(cur)):
            return base, new, False
        cmap = {json.dumps(x['id']): x for x in cur or []}
        restore = key in ('bookings', 'requests')
        ok_new = []
        for x in new:
            c = cmap.get(json.dumps(x['id']))
            if can(who, x, c, get):
                ok_new.append(restore_phone(x, c) if restore else x)
        ok_base = [x for x in (base or []) if isinstance(x, dict) and 'id' in x and can(who, x, cmap.get(json.dumps(x['id'])), get)]
        if key == 'analytics' or (key == 'reviews' and who.role == 'place'):
            ok_base = []  # журнал і відгуки (для мийки): видаляти не можна, лише додавати чи відповідати
        return ok_base, ok_new, True
    if kind == 'dict':
        if not isinstance(new, dict):
            return base, new, False
        cur = cur or {}
        if key == 'calls':
            okk = lambda k, v: write_call(who, k, cur.get(k), get, v if isinstance(v, dict) else None)
        elif key == 'avatars':
            okk = lambda k, v: write_avatar(who, k, cur.get(k), v)
        else:
            okk = lambda k, v: can(who, k, cur.get(k), get)
        return ({k: v for k, v in (base or {}).items() if okk(k, v)}, {k: v for k, v in new.items() if okk(k, v)}, True)
    return base, new, False


# Увімкнена справжня оплата (LiqPay): запис із сумою до сплати стає «оплаченим» лише після підпису банку.
REQUIRE_PAYMENT = False


# Що клієнт не може змінити у вже створеному записі (гроші, мийка, послуги, оплата).
CLIENT_LOCKED = ('placeId', 'paid', 'total', 'listTotal', 'bonus', 'fromBalance', 'promo', 'covered', 'passUse', 'loyalty', 'payment',
                 'installments', 'deal', 'clientId', 'fromReq', 'needsConfirm', 'source', 'channel', 'services', 'minutes', 'cls',
                 'refundDone', 'payFailed', 'placeAmount', 'refund', 'refundTo', 'declined', 'resolution', 'unfreezeAt', 'confirmedAt', 'respondedAt')
# Куди клієнт може перевести свій запис.
CLIENT_MOVES = {('pending', 'cancelled'), ('offer', 'cancelled'), ('paid', 'cancelled'), ('unpaid', 'cancelled'),
                ('offer', 'paid'), ('offer', 'pending'), ('done', 'completed'), ('paid', 'dispute'), ('done', 'dispute'), ('completed', 'dispute')}
# Мийка не змінює грошей записів CARCAR (лише свої записи з журналу).
PLACE_LOCKED = ('clientAvatar', 'paid', 'total', 'listTotal', 'bonus', 'fromBalance', 'promo', 'covered', 'passUse', 'loyalty', 'payment', 'installments',
                'clientId', 'fromReq', 'placeId', 'refundDone', 'resolution')


def _client_booking(who, b, old, get):
    import time as _t
    if old is None:
        b = {k: v for k, v in b.items() if k not in ('refund', 'refundTo', 'refundDone', 'placeAmount', 'resolution', 'payment', 'payFailed', 'declined')}
        for k in ('paid', 'total', 'bonus', 'fromBalance', 'covered'):
            if k in b:
                b[k] = _num(b[k])
        # Запис за пропозицією мийки в чаті — лише якщо така пропозиція справді є для цього клієнта.
        if b.get('fromReq'):
            r = next((x for x in get('requests') or [] if isinstance(x, dict) and x.get('id') == b['fromReq']), None)
            if not (r and who.is_client(r.get('clientId')) and r.get('placeId') == b.get('placeId') and r.get('invite')):
                b.pop('fromReq', None)
        auto = (get('biz.autoConfirm') or {}).get(b.get('placeId'))
        if b.get('state') not in ('unpaid', 'pending', 'paid'):
            b['state'] = 'pending'
        if b.get('state') == 'paid' and not (auto or b.get('fromReq')):
            b['state'], b['needsConfirm'] = 'pending', True
        return b
    st_old, st_new = old.get('state'), b.get('state')
    out = {**b, **{k: old[k] for k in CLIENT_LOCKED if k in old}}
    for k in CLIENT_LOCKED:
        if k not in old:
            out.pop(k, None)
    if st_new != st_old and (st_old, st_new) not in CLIENT_MOVES:
        out['state'] = st_old
        return out
    if st_new == 'cancelled' and st_old != 'cancelled':
        # Скасування клієнтом: повернення рахуємо тут, а не беремо на слово.
        charged = _num(old.get('paid'))
        if old.get('installments'):
            inst = old['installments']
            charged = max(0.0, charged - _num(inst.get('card') or charged) + _num(inst.get('first')))
        waiting = st_old in ('pending', 'offer', 'unpaid')
        late = not waiting and _t.time() > booking_start(old) - FREE_CANCEL_HOURS * 3600
        price = _num(old.get('paid')) + _num(old.get('bonus')) + (_num((old.get('promo') or {}).get('amount')) if isinstance(old.get('promo'), dict) and not old['promo'].get('returned') else 0)
        if st_old == 'unpaid':
            refund, to = 0.0, None
        elif late:
            refund, to = 0.0, None
        else:
            refund = charged
            to_bal = min(_num(old.get('fromBalance')), refund) if waiting else refund
            to = 'card' if refund - to_bal > 0 else 'balance'
        # Мийка не відповіла (5 хв) чи клієнт не прийняв інший час — це не скасування клієнтом.
        why = b.get('declined')
        sys_cancel = (why == 'timeout' and st_old == 'pending' and _t.time() * 1000 - (old.get('createdAt') or 0) > 5 * 60000) or (why == 'proposal' and st_old == 'offer')
        if sys_cancel:
            refund = charged
            to = 'balance' if _num(old.get('fromBalance')) >= refund else 'card'
            late = False
            out.update(declined=why, cancelBy='system', refund=refund, placeAmount=0)
        else:
            out.update(cancelBy='client', refund=refund, placeAmount=price if late else 0)
        if to:
            out['refundTo'] = to
        else:
            out.pop('refundTo', None)
        if not late:
            if isinstance(old.get('promo'), dict):
                out['promo'] = {**old['promo'], 'returned': True}
            out['passUse'] = None
            if old.get('installments'):
                out['installments'] = {**old['installments'], 'cancelled': int(_t.time() * 1000)}
        if b.get('payFailed') and st_old == 'unpaid':
            out['payFailed'] = str(b['payFailed'])[:100]
    if st_new == 'completed' and st_old == 'done':
        out['unfreezeAt'] = int((_t.time() + FREEZE_HOURS * 3600) * 1000)
    return out


def _place_booking(who, b, old):
    if old is None or old.get('source'):
        return b
    out = {**b, **{k: old[k] for k in PLACE_LOCKED if k in old}}
    for k in PLACE_LOCKED:
        if k not in old:
            out.pop(k, None)
    if b.get('state') == 'refunded' and old.get('state') != 'refunded':
        out['state'] = old.get('state')  # повернення за спором вирішує CARCAR
    charged = _num(old.get('paid'))
    if _num(out.get('refund')) > charged:
        out['refund'] = charged
    # Мийка скасувала чи відмовила — клієнт не отримав послугу, промокод (напр. «Перша мийка −30%») повертається йому.
    if out.get('state') == 'cancelled' and old.get('state') != 'cancelled' and isinstance(old.get('promo'), dict):
        out['promo'] = {**old['promo'], 'returned': True}
    return out


def _guard_bookings(who, cur, merged, get):
    cmap = {b.get('id'): b for b in cur or [] if isinstance(b, dict)}
    # Номери записів видає сервер: у кожного пристрою свій лічильник, тож без цього номери повторювались.
    used = {b.get('no') for b in cur or [] if isinstance(b, dict) and isinstance(b.get('no'), int)}
    nxt = max([n for n in used if n] + [100000]) + 1
    taken = set()
    out = []
    for b in merged:
        if isinstance(b, dict):
            old = cmap.get(b.get('id'))
            if who.role == 'client' and (old is None or who.is_client(old.get('clientId'))):
                b = _client_booking(who, b, old, get)
            elif who.role == 'place':
                b = _place_booking(who, b, old)
            # Уже виданий номер не змінюється; повтор (з давніх часів, коли номери видавали пристрої) — отримує новий.
            # Новому запису номер дає лише сервер (свій номер клієнт чи мийка не призначить).
            no = old.get('no') if old is not None and isinstance(old.get('no'), int) else None if old is None else b.get('no')
            if not isinstance(no, int) or no in taken:
                no, nxt = nxt, nxt + 1
            if b.get('no') != no:
                b = {**b, 'no': no}
            taken.add(no)
            nxt = max(nxt, no + 1)
        out.append(b)
    return out


def _paid_bookings(who, cur, merged):
    cmap = {b.get('id'): b for b in cur or [] if isinstance(b, dict)}
    out = []
    for b in merged:
        old = cmap.get(b.get('id')) if isinstance(b, dict) else None
        if isinstance(b, dict) and who.role == 'client':
            try:
                # До сплати карткою — без частини з балансу CARCAR.
                due = float(b.get('paid') or 0) - float(b.get('fromBalance') or 0) > 0
            except (TypeError, ValueError):
                due = True
            if old is None and due and b.get('state') != 'unpaid':
                b = {**b, 'state': 'unpaid'}
            elif old is not None and old.get('state') == 'unpaid' and b.get('state') not in ('unpaid', 'cancelled'):
                b = {**b, 'state': 'unpaid'}
            if old is not None and old.get('payment') != b.get('payment'):
                b = {**b, 'payment': old.get('payment')}
            elif old is None and 'payment' in b:
                b = {k: v for k, v in b.items() if k != 'payment'}
        elif isinstance(b, dict) and who.role == 'place' and old is not None and old.get('state') == 'unpaid':
            b = old  # неоплачений запис мийка не чіпає — його ще немає
        out.append(b)
    return out


def _client_pass_change(who, old, s, get_bookings):
    """Списати візит (суму) клієнт може сам. Повернути — лише за свій скасований запис, з якого списувалось, і один раз."""
    hist_old = old.get('history') or []
    hist_new = s.get('history') if isinstance(s.get('history'), list) else hist_old
    if hist_new[:len(hist_old)] != hist_old:
        return old  # історію не переписуємо
    added = hist_new[len(hist_old):]
    field = 'visitsLeft' if old.get('kind') == 'sub' else 'balance'
    try:
        want = float(s.get(field, old.get(field)) or 0)
        was = float(old.get(field) or 0)
    except (TypeError, ValueError):
        return old
    allowed_up = 0.0
    mine = {b.get('id'): b for b in get_bookings() or [] if isinstance(b, dict) and who.is_client(b.get('clientId'))}
    redeemed = {h.get('bookingId') for h in hist_old if isinstance(h, dict) and (h.get('amount') or 0) > 0}
    refunded = {h.get('bookingId') for h in hist_old if isinstance(h, dict) and (h.get('amount') or 0) < 0}
    for h in added:
        if not isinstance(h, dict) or (h.get('amount') or 0) >= 0:
            continue
        bid = h.get('bookingId')
        b = mine.get(bid)
        if b and bid in redeemed and bid not in refunded and b.get('state') in ('cancelled', 'refunded'):
            refunded.add(bid)
            allowed_up += 1 if field == 'visitsLeft' else -float(h.get('amount') or 0)
    want = max(0.0, min(want, was + allowed_up))
    if old.get('visits') is not None and field == 'visitsLeft':
        want = min(want, float(old['visits']))
    return {**old, 'history': hist_new, field: int(want) if field == 'visitsLeft' else want}


def _client_passes(who, cur, merged, get_bookings):
    """Клієнт у biz.passes: лише купує собі абонемент чи списує власний візит. Плани, картку лояльності
    й чужі абонементи не змінює (і не бачить)."""
    out = {}
    for pid, cur_p in (cur or {}).items():
        cur_p = cur_p or {}
        new_p = (merged or {}).get(pid) or {}
        mine = lambda s: isinstance(s, dict) and who.is_client(s.get('clientKey'))
        cur_sold = {s.get('id'): s for s in cur_p.get('sold') or [] if isinstance(s, dict)}
        keep = [s for s in cur_p.get('sold') or [] if not mine(s)]
        own = []
        for s in new_p.get('sold') or []:
            if not mine(s):
                continue
            old = cur_sold.get(s.get('id'))
            if old is None:
                if REQUIRE_PAYMENT:
                    continue  # з оплатою карткою абонемент продає мийка (оплата на місці) — без банку не «купиш»
                plan = next((x for x in cur_p.get('plans') or [] if x.get('id') == s.get('planId')), None)
                if not plan or plan.get('active') is False:
                    continue
                s = {**s, 'price': plan.get('price'), 'visits': plan.get('visits'), 'services': plan.get('services') or []}
                if s.get('kind') == 'sub':
                    s['visitsLeft'] = plan.get('visits')
                own.append(s)
            else:
                own.append(_client_pass_change(who, old, s, get_bookings))
        out[pid] = {**cur_p, 'sold': keep + own}
    return out


def _server_numbers(cur, merged, first):
    """Номери (no) видає сервер: виданий не змінюється, новому чи повтору — наступний вільний. Кожен пристрій бачить
    лише частину списку (свої звернення), тож рахувати номери на пристрої не можна."""
    cmap = {x.get('id'): x for x in cur or [] if isinstance(x, dict)}
    nxt = max([x.get('no') for x in cur or [] if isinstance(x, dict) and isinstance(x.get('no'), int)] + [first - 1]) + 1
    taken, out = set(), []
    for x in merged:
        if isinstance(x, dict):
            old = cmap.get(x.get('id'))
            no = old.get('no') if old is not None and isinstance(old.get('no'), int) else None
            if no is None or no in taken:
                no, nxt = nxt, nxt + 1
            if x.get('no') != no:
                x = {**x, 'no': no}
            taken.add(no)
            nxt = max(nxt, no + 1)
        out.append(x)
    return out


def sanitize(who, key, cur, merged, get=None):
    """Поля, які роль не може змінити навіть у своєму: статус перевірки мийки, пароль, вміст відгуку тощо."""
    if key == 'support' and isinstance(merged, list):
        merged = _server_numbers(cur, merged, 1001)
    if who.admin or merged is None:
        return merged
    if who.role == 'place' and key in MASKED_KEYS and get is not None:
        cur_items = list(cur.values()) if isinstance(cur, dict) else cur
        merged = unmask_ids(who, merged, cur_items, get)
    if key == 'biz.passes' and who.role == 'place' and isinstance(merged, dict):
        out = {}
        for pid, p in merged.items():
            cur_sold = {x.get('id'): x for x in ((cur or {}).get(pid) or {}).get('sold') or [] if isinstance(x, dict)}
            if isinstance(p, dict):
                p = {**p, 'sold': [({**s, **{k: cur_sold[s.get('id')][k] for k in ('clientKey', 'clientId', 'phone') if k in cur_sold[s.get('id')]}}
                                    if isinstance(s, dict) and s.get('id') in cur_sold and any(hidden_phone(s.get(k)) for k in ('clientKey', 'clientId', 'phone')) else s)
                                   for s in p.get('sold') or []]}
            out[pid] = p
        merged = out
    if key == 'biz.passes' and who.role == 'client' and isinstance(merged, dict):
        return _client_passes(who, cur, merged, lambda: get('bookings') if get else [])
    if key == 'bookings' and isinstance(merged, list) and get is not None:
        merged = _guard_bookings(who, cur, merged, get)
    if key == 'bookings' and REQUIRE_PAYMENT and isinstance(merged, list):
        merged = _paid_bookings(who, cur, merged)
    if key.startswith('wallet') and get is not None:
        return sanitize_wallet(who, cur, merged, get)
    if key == 'seq.booking':
        # Лічильник номерів записів лише зростає (і не стрибає).
        try:
            old_n = int(cur or 0)
            n = int(merged)
        except (TypeError, ValueError):
            return cur
        return n if old_n < n <= max(old_n, 100000) + 1000 else cur
    if key == 'biz.applications' and isinstance(merged, list):
        # Не більше трьох заявок на розгляді від одного клієнта.
        cur_ids = {a.get('id') for a in cur or [] if isinstance(a, dict)}
        mine_new = [a for a in merged if isinstance(a, dict) and a.get('id') not in cur_ids]
        pending = sum(1 for a in cur or [] if isinstance(a, dict) and a.get('status') == 'new' and who.is_client(a.get('clientId')))
        allowed = set(a.get('id') for a in mine_new[:max(0, 3 - pending)])
        merged = [a if a.get('id') in cur_ids or a.get('id') in allowed else None for a in merged if isinstance(a, dict)]
        merged = [dict(a, clientId=who.cid) if a and a.get('id') not in cur_ids else a for a in merged if a]
    if key == 'partners' and who.role == 'place':
        out = dict(merged)
        for pid, pt in merged.items():
            old = (cur or {}).get(pid)
            if not isinstance(pt, dict):
                continue
            pt = dict(pt)
            if old is None:
                pt['status'] = 'pending'  # нова мийка — на перевірку
                pt.pop('commission', None)
            else:
                allowed = {('setup', 'approved'), ('changes', 'pending'), ('rejected', 'pending')}
                if pt.get('status') != old.get('status') and (old.get('status'), pt.get('status')) not in allowed:
                    pt['status'] = old.get('status')
                if pt.get('status') == 'approved' and old.get('status') == 'setup':
                    pt.setdefault('publishedAt', old.get('publishedAt'))
                pt['commission'] = old.get('commission')
                if pt.get('commission') is None:
                    pt.pop('commission', None)
                # Рахунок для виплат підтверджує лише CARCAR.
                if isinstance(pt.get('payout'), dict):
                    old_pay = old.get('payout') or {}
                    same = old_pay.get('iban') == pt['payout'].get('iban')
                    pt['payout'] = {**pt['payout'], 'verified': bool(old_pay.get('verified')) and same}
            out[pid] = pt
        return out
    if key == 'places.custom' and isinstance(merged, list):
        # Хто створив мийку — ставить сервер і не змінює: від цього залежить, хто може приписати її собі.
        cmap = {x.get('id'): x for x in cur or [] if isinstance(x, dict)}
        author = 'demo' if who.demo else who.login or who.cid or who.role
        out = []
        for x in merged:
            if isinstance(x, dict):
                old = cmap.get(x.get('id'))
                x = {**x, 'by': old.get('by')} if old is not None else {**x, 'by': author}
                if x.get('by') is None:
                    x.pop('by')
            out.append(x)
        merged = out
    if key == 'biz.accounts' and who.role == 'place':
        cmap = {a.get('login'): a for a in cur or []}
        out = []
        for a in merged:
            old = cmap.get(a.get('login'))
            if old is not None and a.get('login') == who.login:
                # Додати можна лише власну нову мийку, яку ще не має жоден акаунт.
                taken = {x for o in cur or [] for x in [o.get('placeId')] + list(o.get('places') or []) if x}
                # …і саме цей акаунт її створив (позначка by на сервері): мийку адміністрації чи іншого кабінету — ні.
                created = {x.get('id') for x in (get('places.custom') if get else None) or [] if isinstance(x, dict) and x.get('by') == who.login}
                extra = [p for p in a.get('places') or [] if p and p not in taken and p in created]
                a = {**old, 'places': list(dict.fromkeys((old.get('places') or []) + extra))}
            elif old is not None:
                a = old
            if a.get('login') not in {x.get('login') for x in out}:
                out.append(a)
        return out
    if key == 'reviews' and who.role == 'place':
        cmap = {json.dumps(r.get('id')): r for r in cur or []}
        out = []
        for r in merged:
            old = cmap.get(json.dumps(r.get('id')))
            if old is not None and not who.is_client(r.get('clientKey')):
                r = {**old, **{k: r[k] for k in ('reply', 'report') if k in r}}
            out.append(r)
        return out
    return merged


def deep(x):
    return copy.deepcopy(x)
