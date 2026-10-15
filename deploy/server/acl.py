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


def phone_hash(phone):
    """Номер замість самого номера (FNV-1a), як phoneHash у core.js: мийка може впізнати клієнта, не бачачи номер."""
    key = phone_key(phone)
    if not key:
        return ''
    h = 0x811C9DC5
    for ch in ('carcar:' + key).encode():
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return 'h:%08x' % h


def hidden_phone(v):
    return isinstance(v, str) and v.startswith('h:')


# Що лишається від чужого запису: лише зайнятість часу й статистика відповідей мийки.
BOOKING_PUBLIC = ('id', 'placeId', 'date', 'time', 'minutes', 'state', 'source', 'no', 'createdAt', 'respondedAt',
                  'confirmedAt', 'closedAt', 'declined', 'cancelBy', 'needsConfirm', 'offer', 'deal')


def pick(d, keys):
    return {k: d[k] for k in keys if k in d}


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


def account_places(store_get, who):
    """Мийки акаунта мийки: з biz.accounts; демо-кабінет — усі мийки, що не належать жодному акаунту."""
    accounts = store_get('biz.accounts') or []
    owned = set()
    for a in accounts:
        owned.update([a.get('placeId')] + list(a.get('places') or []))
    owned.discard(None)
    if who.demo:
        # Демо-мийки з data.js серверу невідомі на імʼя — демо-кабінет керує всім, що не належить справжнім акаунтам.
        return {'*demo*'} | (set(store_get('biz.demoPlaces') or []) - owned)
    acc = next((a for a in accounts if a.get('login') == who.login), None)
    if not acc:
        return set()
    return {x for x in [acc.get('placeId')] + list(acc.get('places') or []) if x}


def owns(who, pid, store_get=None):
    if who.admin:
        return True
    if who.role != 'place' or not pid:
        return False
    if pid in who.places:
        return True
    if '*demo*' in who.places and store_get is not None:
        accounts = store_get('biz.accounts') or []
        owned = {x for a in accounts for x in [a.get('placeId')] + list(a.get('places') or []) if x}
        return pid not in owned
    return False


# ---------- політики ----------
# Кожна політика: read(who, value, get) -> value для цієї ролі; can_write(who, item_or_key, get) -> bool;
# restore(who, new_item, cur_item) — повертає приховані поля (телефон), щоб запис не затер справжні дані.

def _client_of(item):
    return item.get('clientId') or None


def read_bookings(who, value, get):
    out = []
    for b in value or []:
        if who.admin:
            out.append(b)
        elif owns(who, b.get('placeId'), get):
            x = dict(b)
            if not b.get('source') and b.get('clientPhone'):
                x['clientPhone'] = phone_hash(b['clientPhone'])  # клієнт CARCAR — номер прихований
            out.append(x)
        elif who.is_client(_client_of(b)):
            out.append(b)
        else:
            x = pick(b, BOOKING_PUBLIC)
            if b.get('mobile'):
                x['mobile'] = {'hidden': True}
            if isinstance(x.get('offer'), dict):
                x['offer'] = {}
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
            x = dict(r)
            if r.get('clientPhone'):
                x['clientPhone'] = phone_hash(r['clientPhone'])
            out.append(x)
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
        return [x for x in value or [] if who.admin or who.is_client(x.get(field) or x.get('clientId'))
                or owns(who, x.get('placeId'), get)]
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
    return [t for t in value or [] if who.admin or who.is_client(t.get('clientKey'))
            or (t.get('from') == 'client' and who.role == 'client' and phone_key(t.get('clientPhone')) == who.cid)
            or owns(who, t.get('placeId'), get)]


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
    # Нову заявку може подати будь-хто (навіть без входу), але не схвалити.
    return cur is None and item.get('status') == 'new' and not item.get('issued')


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
    return {pid: (lst if who.admin or owns(who, pid, get) else [{k: v for k, v in w.items() if k != 'phone'} for w in lst or []])
            for pid, lst in (value or {}).items()}


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
    # Повернення на баланс роблять мийка (відмова) й адміністрація (спір), тож писати можуть і вони.
    return who.admin or who.role == 'place' or who.is_client(cid)


def read_calls(who, value, get):
    return {cid: c for cid, c in (value or {}).items() if who.admin or who.is_client(c.get('clientId')) or owns(who, c.get('placeId'), get)}


def write_call(who, key, cur, get, item=None):
    c = item or cur or {}
    ok = lambda x: who.admin or who.is_client(x.get('clientId')) or owns(who, x.get('placeId'), get)
    return ok(c) and (cur is None or ok(cur))


def read_calllog(who, value, get):
    return [x for x in value or [] if who.admin or who.is_client(x.get('clientId')) or owns(who, x.get('placeId'), get)]


def write_calllog(who, item, cur, get):
    return write_call(who, None, cur, get, item)


def read_passes(who, value, get):
    out = {}
    for pid, p in (value or {}).items():
        if who.admin or owns(who, pid, get):
            out[pid] = p
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
    'biz.offers':      ('list', lambda w, v, g: [o for o in v or [] if w.admin or owns(w, o.get('placeId'), g) or w.is_client(o.get('clientKey'))], write_by_place_or_client),
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
    'biz.passes':      ('dict', read_passes, write_place_key),
    'presence':        ('dict', read_all, write_place_key),
    'calls':           ('dict', read_calls, write_call),
    'admin.settings':  ('raw', read_all, write_admin),
    'admin.pauseLift': ('raw', read_all, write_admin),
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
        else:
            okk = lambda k, v: can(who, k, cur.get(k), get)
        return ({k: v for k, v in (base or {}).items() if okk(k, v)}, {k: v for k, v in new.items() if okk(k, v)}, True)
    return base, new, False


# Увімкнена справжня оплата (LiqPay): запис із сумою до сплати стає «оплаченим» лише після підпису банку.
REQUIRE_PAYMENT = False


def _paid_bookings(who, cur, merged):
    cmap = {b.get('id'): b for b in cur or [] if isinstance(b, dict)}
    out = []
    for b in merged:
        old = cmap.get(b.get('id')) if isinstance(b, dict) else None
        if isinstance(b, dict) and who.role == 'client':
            try:
                due = float(b.get('paid') or 0) > 0
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


def sanitize(who, key, cur, merged):
    """Поля, які роль не може змінити навіть у своєму: статус перевірки мийки, пароль, вміст відгуку тощо."""
    if who.admin or merged is None:
        return merged
    if key == 'bookings' and REQUIRE_PAYMENT and isinstance(merged, list):
        merged = _paid_bookings(who, cur, merged)
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
    if key == 'biz.accounts' and who.role == 'place':
        cmap = {a.get('login'): a for a in cur or []}
        out = []
        for a in merged:
            old = cmap.get(a.get('login'))
            if old is not None and a.get('login') == who.login:
                a = {**old, 'places': list(dict.fromkeys((old.get('places') or []) + [p for p in a.get('places') or [] if p]))}
            elif old is not None:
                a = old
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
