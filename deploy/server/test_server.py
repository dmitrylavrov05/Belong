"""Перевірки сервера CARCAR: вхід, права доступу, злиття, оплата. Запуск: python3 -m unittest test_server.py"""
import base64
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.cfg = os.path.join(cls.tmp, 'config.json')
        subprocess.run([sys.executable, os.path.join(HERE, 'carcar_sync.py'), '--config', cls.cfg, '--set-admin-password', 'secret-admin'], check=True, capture_output=True)
        with open(cls.cfg) as f:
            cfg = json.load(f)
        cfg['liqpay'] = {'public_key': 'pub', 'private_key': 'priv', 'sandbox': True}
        # Онлайн-сервіс номерів (як baza-gai.com.ua) — локальна заглушка.
        cls.gai_hits = []

        class Gai(BaseHTTPRequestHandler):
            def do_GET(h):
                cls.gai_hits.append((h.path, h.headers.get('X-Api-Key')))
                if h.path.endswith('/BC1234HH'):
                    body = {'digits': 'BC1234HH', 'vendor': 'HYUNDAI', 'model': 'TUCSON', 'model_year': 2019,
                            'operations': [{'is_last': True, 'registered_at': '01.06.2023', 'color': {'slug': 'grey', 'ua': 'Сірий'},
                                            'fuel': {'ua': 'Бензин'}, 'capacity': 1999, 'body': {'ua': 'Універсал'}}]}
                    code = 200
                elif h.path.endswith('/AA0000AA'):
                    body, code = {'error': 'limit'}, 429
                else:
                    body, code = {'error': 'not found'}, 404
                data = json.dumps(body).encode()
                h.send_response(code)
                h.send_header('Content-Type', 'application/json')
                h.send_header('Content-Length', str(len(data)))
                h.end_headers()
                h.wfile.write(data)

            def log_message(h, *a):
                pass
        class Goo(BaseHTTPRequestHandler):
            def do_POST(h):
                body = json.loads(h.rfile.read(int(h.headers.get('Content-Length') or 0)))
                cls.goo_req = (h.path, h.headers.get('X-Goog-Api-Key'), body)
                data = json.dumps({'places': [{
                    'id': 'ChIJ1', 'displayName': {'text': 'Автомийка Хмаринка'}, 'formattedAddress': 'вулиця Хрещатик, 1, Київ, Україна, 02000',
                    'location': {'latitude': 50.447, 'longitude': 30.522}, 'internationalPhoneNumber': '+380 44 123 4567',
                    'regularOpeningHours': {'periods': [{'open': {'day': d, 'hour': 8, 'minute': 0}, 'close': {'day': d, 'hour': 21, 'minute': 0}} for d in range(1, 6)],
                                            'weekdayDescriptions': ['понеділок: 08:00–21:00']},
                    'rating': 4.7, 'userRatingCount': 312, 'googleMapsUri': 'https://maps.google.com/?cid=1',
                    'addressComponents': [{'longText': 'Київ', 'types': ['locality', 'political']}],
                    'photos': [{'name': 'places/ChIJ1/photos/AbC'}]}]}).encode()
                h.send_response(200)
                h.send_header('Content-Type', 'application/json')
                h.send_header('Content-Length', str(len(data)))
                h.end_headers()
                h.wfile.write(data)

            def do_GET(h):
                data = b'\xff\xd8\xffJPEG'
                h.send_response(200)
                h.send_header('Content-Type', 'image/jpeg')
                h.send_header('Content-Length', str(len(data)))
                h.end_headers()
                h.wfile.write(data)

            def log_message(h, *a):
                pass
        cls.goo = HTTPServer(('127.0.0.1', 0), Goo)
        threading.Thread(target=cls.goo.serve_forever, daemon=True).start()
        cfg['google_places_key'] = 'gkey'
        cfg['google_places_url'] = f'http://127.0.0.1:{cls.goo.server_port}'
        cls.gai = HTTPServer(('127.0.0.1', 0), Gai)
        threading.Thread(target=cls.gai.serve_forever, daemon=True).start()
        cfg['vehicle_api'] = {'key': 'test-key', 'url': f'http://127.0.0.1:{cls.gai.server_port}/nomer/{{plate}}'}
        with open(cls.cfg, 'w') as f:
            json.dump(cfg, f)
        # Реєстр авто: невеликий файл у форматі відкритих даних МВС (кирилиця в номерах, «;»).
        csv_path = os.path.join(cls.tmp, 'tz.csv')
        with open(csv_path, 'w', encoding='utf-8') as f:
            f.write('"PERSON";"OPER_CODE";"OPER_NAME";"D_REG";"BRAND";"MODEL";"VIN";"MAKE_YEAR";"COLOR";"KIND";"BODY";"PURPOSE";"FUEL";"CAPACITY";"OWN_WEIGHT";"TOTAL_WEIGHT";"N_REG_NEW"\n')
            f.write('"P";"100";"РЕЄСТРАЦIЯ";"12.03.2021";"TOYOTA";"TOYOTA RAV4";"";"2020";"БІЛИЙ";"ЛЕГКОВИЙ";"УНІВЕРСАЛ-B";"ЗАГАЛЬНИЙ";"БЕНЗИН";"1987";"1500";"2000";"КА0001АА"\n')
            f.write('"P";"100";"РЕЄСТРАЦIЯ";"02.02.2019";"SKODA";"OCTAVIA";"";"2012";"СІРИЙ";"ЛЕГКОВИЙ";"СЕДАН-B";"ЗАГАЛЬНИЙ";"ДИЗЕЛЬ";"1598";"1300";"1800";"KA0001AA"\n')
            f.write('"P";"100";"РЕЄСТРАЦIЯ";"05.05.2022";"VOLKSWAGEN";"TRANSPORTER";"";"2015";"ЧОРНИЙ";"ЛЕГКОВИЙ";"МІНІВЕН-B";"ЗАГАЛЬНИЙ";"ДИЗЕЛЬ";"1968";"2000";"3000";"АІ7777КЕ"\n')
        subprocess.run([sys.executable, os.path.join(HERE, 'vehicles_import.py'), '--db', os.path.join(cls.tmp, 'vehicles.db'), '--file', csv_path], check=True, capture_output=True)
        cls.port = free_port()
        cls.proc = subprocess.Popen([sys.executable, os.path.join(HERE, 'carcar_sync.py'), '--port', str(cls.port), '--db', os.path.join(cls.tmp, 'd.db'),
                                     '--config', cls.cfg, '--public-url', 'https://carcar.test'], stdout=subprocess.PIPE)
        cls.proc.stdout.readline()
        cls.base = f'http://127.0.0.1:{cls.port}'

    @classmethod
    def tearDownClass(cls):
        cls.proc.kill()
        cls.proc.wait()
        cls.gai.shutdown()
        cls.gai.server_close()
        cls.goo.shutdown()
        cls.goo.server_close()
        cls.proc.stdout.close()

    def call(self, method, path, body=None, token=None, form=False):
        data = None
        headers = {}
        if body is not None:
            if form:
                data = '&'.join(f'{k}={urllib.request.quote(v)}' for k, v in body.items()).encode()
                headers['Content-Type'] = 'application/x-www-form-urlencoded'
            else:
                data = json.dumps(body).encode()
                headers['Content-Type'] = 'application/json'
        if token:
            headers['Authorization'] = f'Bearer {token}'
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def login_client(self, phone):
        code, j = self.call('POST', '/api/auth/demo', {'phone': phone})
        self.assertEqual(code, 200, j)
        return j['token'], j['phone']

    def state(self, token=None):
        return self.call('GET', '/api/state?since=0', token=token)[1]['data']

    def put(self, key, value, token, base=None):
        body = {'value': value}
        if base is not None:
            body['base'] = base
        return self.call('PUT', f'/api/state/{key}', body, token)

    # ----------------------------------------------------------------

    def test_01_clients_see_only_their_bookings(self):
        ira, ira_id = self.login_client('067 111 11 11')
        oleh, oleh_id = self.login_client('050 222 22 22')
        b1 = {'id': 'b1', 'placeId': 'blysk', 'clientId': ira_id, 'clientName': 'Ірина', 'clientPhone': '+380671111111', 'date': '2099-10-05', 'time': '10:00', 'minutes': 30, 'state': 'pending', 'paid': 0, 'total': 250}
        code, j = self.put('bookings', [b1], ira)
        self.assertEqual(code, 200)
        # Олег бачить лише зайнятість: без імені, телефону й грошей.
        other = self.state(oleh)['bookings'][0]
        self.assertEqual(other['time'], '10:00')
        for f in ('clientName', 'clientPhone', 'total', 'clientId'):
            self.assertNotIn(f, other)
        # Олег не може змінити чужий запис — сервер ігнорує зміну.
        hacked = dict(other, state='cancelled')
        self.put('bookings', [hacked], oleh)
        self.assertEqual(self.state(ira)['bookings'][0]['state'], 'pending')
        # І не може видалити його.
        self.put('bookings', [], oleh, base=[other])
        self.assertEqual(len(self.state(ira)['bookings']), 1)
        # Без входу каталог видно, а особисте — ні.
        anon = self.state()
        self.assertNotIn('clientName', anon['bookings'][0])

    def test_02_wash_sees_own_bookings_without_client_phone(self):
        code, j = self.call('POST', '/api/auth/biz', {'demo': True})
        wash = j['token']
        b = next(x for x in self.state(wash)['bookings'] if x['id'] == 'b1')
        self.assertEqual(b['clientName'], 'Ірина')
        self.assertTrue(b['clientPhone'].startswith('h:'))  # номер клієнта CARCAR прихований
        # Мийка приймає запис — телефон на сервері не затирається хешем.
        self.put('bookings', [dict(b, state='paid')], wash)
        ira, _ = self.login_client('067 111 11 11')
        mine = self.state(ira)['bookings'][0]
        self.assertEqual(mine['state'], 'paid')
        self.assertEqual(mine['clientPhone'], '+380671111111')

    def test_03_concurrent_changes_merge(self):
        ira, ira_id = self.login_client('067 111 11 11')
        oleh, oleh_id = self.login_client('050 222 22 22')
        base_ira = self.state(ira)['bookings']
        base_oleh = self.state(oleh)['bookings']
        b2 = {'id': 'b2', 'placeId': 'blysk', 'clientId': oleh_id, 'date': '2099-10-05', 'time': '11:00', 'minutes': 30, 'state': 'pending'}
        self.put('bookings', base_oleh + [b2], oleh, base=base_oleh)
        b3 = {'id': 'b3', 'placeId': 'hvylia', 'clientId': ira_id, 'date': '2099-10-06', 'time': '12:00', 'minutes': 30, 'state': 'pending'}
        self.put('bookings', base_ira + [b3], ira, base=base_ira)
        _, j = self.call('POST', '/api/auth/admin', {'password': 'secret-admin'})
        ids = sorted(x['id'] for x in self.state(j['token'])['bookings'])
        self.assertEqual(ids, ['b1', 'b2', 'b3'])

    def test_04_wallets_are_private(self):
        ira, ira_id = self.login_client('067 111 11 11')
        oleh, _ = self.login_client('050 222 22 22')
        # Покласти собі гроші на баланс не можна — баланс рахує сервер.
        self.put(f'wallet.{ira_id}', {'money': 100, 'bonus': 50, 'history': [{'amount': 100, 'kind': 'money', 'text': 'хочу', 'at': 1}]}, ira)
        self.assertEqual(self.state(ira)[f'wallet.{ira_id}']['money'], 0)
        self.assertNotIn(f'wallet.{ira_id}', self.state(oleh))
        code, _ = self.put(f'wallet.{ira_id}', {'money': 0}, oleh)
        self.assertEqual(code, 403)

    def test_05_logins(self):
        self.assertEqual(self.call('POST', '/api/auth/admin', {'password': 'wrong'})[0], 401)
        # Кабінет мийки: лише правильний пароль із biz.accounts.
        _, j = self.call('POST', '/api/auth/admin', {'password': 'secret-admin'})
        admin = j['token']
        h = hashlib.sha256('carcar:khmarynka:pass1234'.encode()).hexdigest()
        self.put('biz.accounts', [{'login': 'khmarynka', 'hash': h, 'placeId': 'p_x'}], admin)
        self.assertEqual(self.call('POST', '/api/auth/biz', {'login': 'khmarynka', 'password': 'nope'})[0], 401)
        code, j = self.call('POST', '/api/auth/biz', {'login': 'khmarynka', 'password': 'pass1234'})
        self.assertEqual(code, 200)
        me = self.call('GET', '/api/me', token=j['token'])[1]
        self.assertEqual(me['places'], ['p_x'])
        # Хеші паролів ніхто, крім адмінки, не бачить.
        self.assertEqual(self.state(j['token']).get('biz.accounts'), [{'login': 'khmarynka', 'placeId': 'p_x'}])
        ira, _ = self.login_client('067 111 11 11')
        self.assertEqual(self.state(ira).get('biz.accounts'), [])

    def test_06_wash_cannot_publish_itself_without_check(self):
        _, j = self.call('POST', '/api/auth/admin', {'password': 'secret-admin'})
        admin = j['token']
        self.put('partners', {'p_x': {'status': 'pending', 'payout': {'iban': 'UA1', 'verified': False}}}, admin)
        _, j = self.call('POST', '/api/auth/biz', {'login': 'khmarynka', 'password': 'pass1234'})
        wash = j['token']
        self.put('partners', {'p_x': {'status': 'approved', 'payout': {'iban': 'UA1', 'verified': True}}}, wash)
        pt = self.state(admin)['partners']['p_x']
        self.assertEqual(pt['status'], 'pending')
        self.assertFalse(pt['payout']['verified'])
        # Після схвалення (setup) мийка публікує себе сама.
        self.put('partners', {'p_x': {'status': 'setup', 'payout': {'iban': 'UA1', 'verified': True}}}, admin)
        self.put('partners', {'p_x': {'status': 'approved', 'payout': {'iban': 'UA1', 'verified': True}}}, wash)
        self.assertEqual(self.state(admin)['partners']['p_x']['status'], 'approved')
        # Нову IBAN — знову на перевірку.
        self.put('partners', {'p_x': {'status': 'approved', 'payout': {'iban': 'UA2', 'verified': True}}}, wash)
        self.assertFalse(self.state(admin)['partners']['p_x']['payout']['verified'])

    def test_07_payment_only_by_signed_bank_callback(self):
        ira, ira_id = self.login_client('067 111 11 11')
        b = {'id': 'pay1', 'placeId': 'blysk', 'clientId': ira_id, 'date': '2099-10-07', 'time': '10:00', 'minutes': 30, 'state': 'unpaid', 'paid': 250, 'services': ['Мийка'], 'createdAt': int(time.time() * 1000)}
        code, form = self.call('POST', '/api/pay/create', {'booking': b}, ira)
        self.assertEqual(code, 200, form)
        params = json.loads(base64.b64decode(form['data']))
        self.assertEqual((params['order_id'], params['amount'], params['result_url']), ('pay1', 250, 'https://carcar.test/#/bookings/pay1'))
        # Підроблена відповідь «банку» не проходить.
        fake = base64.b64encode(json.dumps({'order_id': 'pay1', 'status': 'success'}).encode()).decode()
        self.assertEqual(self.call('POST', '/api/pay/liqpay/callback', {'data': fake, 'signature': 'x'}, form=True)[0], 400)
        mine = lambda: next(x for x in self.state(ira)['bookings'] if x['id'] == 'pay1')
        self.assertEqual(mine()['state'], 'unpaid')
        # Справжня (з підписом приватного ключа) — запис оплачено, чекає підтвердження мийки.
        sig = base64.b64encode(hashlib.sha1(('priv' + fake + 'priv').encode()).digest()).decode()
        self.assertEqual(self.call('POST', '/api/pay/liqpay/callback', {'data': fake, 'signature': sig}, form=True)[0], 200)
        self.assertEqual(mine()['state'], 'pending')
        self.assertEqual(mine()['payment']['provider'], 'liqpay')

    def test_07b_booking_cannot_skip_payment(self):
        ira, ira_id = self.login_client('067 111 11 11')
        b = {'id': 'skip1', 'placeId': 'blysk', 'clientId': ira_id, 'date': '2099-10-08', 'time': '10:00', 'minutes': 30, 'state': 'pending', 'paid': 300,
             'payment': {'provider': 'liqpay'}}
        self.put('bookings', self.state(ira)['bookings'] + [b], ira)
        got = next(x for x in self.state(ira)['bookings'] if x['id'] == 'skip1')
        self.assertEqual(got['state'], 'unpaid')
        self.assertNotIn('payment', got)
        # І «доплатити» самому, змінивши статус, теж не можна; скасувати — можна.
        self.put('bookings', [dict(x, state='paid') if x['id'] == 'skip1' else x for x in self.state(ira)['bookings']], ira)
        self.assertEqual(next(x for x in self.state(ira)['bookings'] if x['id'] == 'skip1')['state'], 'unpaid')
        self.put('bookings', [dict(x, state='cancelled') if x['id'] == 'skip1' else x for x in self.state(ira)['bookings']], ira)
        self.assertEqual(next(x for x in self.state(ira)['bookings'] if x['id'] == 'skip1')['state'], 'cancelled')

    def test_08_analytics_append_only_and_admin_only(self):
        ira, _ = self.login_client('067 111 11 11')
        self.put('analytics', [{'id': 'e1', 't': 'session'}], ira)
        self.put('analytics', [], ira, base=[{'id': 'e1', 't': 'session'}])
        self.assertNotIn('analytics', self.state(ira))
        _, j = self.call('POST', '/api/auth/admin', {'password': 'secret-admin'})
        self.assertEqual([e['id'] for e in self.state(j['token'])['analytics']], ['e1'])

    def test_09_notify_prefs_quiet_hours(self):
        sys.path.insert(0, HERE)
        from carcar_sync import muted, kyiv_now
        today = kyiv_now().strftime('%Y-%m-%d')
        self.assertTrue(muted({'on': False}, 'client', 'tel:1'))
        self.assertTrue(muted({'on': True, 'quiet': {'blysk': {today: None}}}, 'place', 'blysk'))
        self.assertFalse(muted({'on': True, 'quiet': {'blysk': {today: [0, 24 * 60]}}}, 'place', 'blysk'))
        self.assertFalse(muted(None, 'place', 'blysk'))
        _, j = self.call('POST', '/api/auth/biz', {'demo': True})
        self.assertEqual(self.call('POST', '/api/notify/prefs', {'on': True, 'quiet': {}}, j['token'])[0], 200)
        self.assertEqual(self.call('POST', '/api/notify/prefs', {'on': True}, None)[0], 401)

    def test_10_config_demo_switches(self):
        cfg = self.call('GET', '/api/config')[1]
        self.assertTrue(cfg['demoPlaces'])
        self.assertEqual(cfg['payments'], 'liqpay')

    def test_11_wash_never_sees_client_number(self):
        ira, ira_id = self.login_client('067 111 11 11')
        _, j = self.call('POST', '/api/auth/biz', {'demo': True})
        wash = j['token']
        view = self.state(wash)
        b = next(x for x in view['bookings'] if x['id'] == 'b1')
        self.assertTrue(b['clientId'].startswith('h:'))
        self.assertNotIn('380671111111', json.dumps(view))
        # Мийка пише клієнту (повідомлення з хешем) — воно доходить саме цьому клієнту.
        self.put('messages', [{'id': 'm1', 'placeId': 'blysk', 'clientKey': b['clientId'], 'text': 'Чекаємо'}], wash)
        self.assertEqual([m['id'] for m in self.state(ira).get('messages', [])], ['m1'])
        # Мийка змінює запис — справжній клієнт лишається власником.
        self.put('bookings', [dict(x, note='x') if x['id'] == 'b1' else x for x in self.state(wash)['bookings']], wash)
        self.assertEqual(next(x for x in self.state(ira)['bookings'] if x['id'] == 'b1')['clientId'], ira_id)

    def test_12_passes_notes_and_cash_are_protected(self):
        ira, ira_id = self.login_client('067 111 11 11')
        _, j = self.call('POST', '/api/auth/biz', {'demo': True})
        wash = j['token']
        plan = {'id': 'pl1', 'kind': 'sub', 'name': '5 мийок', 'visits': 5, 'price': 1000, 'services': []}
        self.put('biz.passes', {'blysk': {'plans': [plan], 'sold': [], 'loyalty': {'on': True, 'every': 6, 'pct': 100}}}, wash)
        self.put('biz.clientNotes', {'blysk': {'h:1': {'note': 'VIP', 'tags': ['VIP']}}}, wash)
        self.put('biz.shifts', [{'id': 's1', 'placeId': 'blysk', 'cash': 500}], wash)
        st = self.state(ira)
        self.assertEqual(st.get('biz.clientNotes'), {})
        self.assertEqual(st.get('biz.shifts'), [])
        # Клієнт не міняє планів і не дописує собі візитів (з оплатою LiqPay — не «купує» без банку).
        hacked = {'blysk': {'plans': [dict(plan, price=1)], 'loyalty': {'on': True, 'every': 1, 'pct': 100},
                            'sold': [{'id': 'x', 'planId': 'pl1', 'kind': 'sub', 'clientKey': ira_id, 'visitsLeft': 99, 'visits': 99}]}}
        self.put('biz.passes', hacked, ira)
        p = self.state(wash)['biz.passes']['blysk']
        self.assertEqual(p['plans'][0]['price'], 1000)
        self.assertEqual(p['loyalty']['every'], 6)
        self.assertEqual(p['sold'], [])
        # Мийка продала абонемент на місці — клієнт списує візит, але не може додати.
        sold = {'id': 'sold1', 'planId': 'pl1', 'kind': 'sub', 'name': '5 мийок', 'clientKey': ira_id, 'visits': 5, 'visitsLeft': 5, 'history': [], 'validUntil': '2099-01-01'}
        self.put('biz.passes', {'blysk': dict(p, sold=[sold])}, wash)
        mine = self.state(ira)['biz.passes']['blysk']
        spent = dict(sold, visitsLeft=4, history=[{'at': 1, 'bookingId': 'b1', 'amount': 250}])
        self.put('biz.passes', {'blysk': dict(mine, sold=[spent])}, ira)
        self.assertEqual(self.state(wash)['biz.passes']['blysk']['sold'][0]['visitsLeft'], 4)
        self.put('biz.passes', {'blysk': dict(mine, sold=[dict(spent, visitsLeft=50, visits=50)])}, ira)
        self.assertEqual(self.state(wash)['biz.passes']['blysk']['sold'][0]['visitsLeft'], 4)
        # «Повернення» за запис, який не скасовано, не проходить.
        back = dict(spent, visitsLeft=5, history=spent['history'] + [{'at': 2, 'bookingId': 'b1', 'amount': -250, 'note': 'повернення'}])
        self.put('biz.passes', {'blysk': dict(mine, sold=[back])}, ira)
        self.assertEqual(self.state(wash)['biz.passes']['blysk']['sold'][0]['visitsLeft'], 4)

    def test_13_admin_turns_demo_off(self):
        _, j = self.call('POST', '/api/auth/admin', {'password': 'secret-admin'})
        admin = j['token']
        ira, _ = self.login_client('067 111 11 11')
        # Клієнт не може ввімкнути чи вимкнути демо — лише адмінка.
        self.assertEqual(self.put('admin.server', {'demoWash': True, 'demoPlaces': True}, ira)[0], 403)
        self.put('admin.server', {'demoWash': False, 'demoPlaces': False, 'demoLogin': False}, admin)
        cfg = self.call('GET', '/api/config')[1]
        self.assertEqual((cfg['demoWash'], cfg['demoPlaces']), (False, False))
        self.assertTrue(cfg['demoLogin'])  # без бота Telegram демо-вхід лишається, інакше ніхто не увійде
        self.assertEqual(self.call('POST', '/api/auth/biz', {'demo': True})[0], 403)
        self.assertEqual(self.state()['admin.server']['demoPlaces'], False)  # бачать усі — застосунок ховає демо одразу
        self.put('admin.server', {'demoWash': True, 'demoPlaces': True}, admin)
        self.assertEqual(self.call('POST', '/api/auth/biz', {'demo': True})[0], 200)

    def test_14_money_rules(self):
        ira, ira_id = self.login_client('067 111 11 11')
        _, j = self.call('POST', '/api/auth/biz', {'demo': True})
        wash = j['token']
        mine = lambda: {b['id']: b for b in self.state(ira)['bookings']}
        # Запис оплачено балансом (175 ₴); мийка відмовляє й повертає гроші на баланс клієнта (знає його лише за хешем).
        b = {'id': 'm1', 'placeId': 'blysk', 'clientId': ira_id, 'date': '2099-10-10', 'time': '10:00', 'minutes': 30, 'state': 'pending', 'paid': 175,
             'fromBalance': 175, 'total': 175, 'needsConfirm': True, 'createdAt': int(time.time() * 1000)}
        self.put('bookings', self.state(ira)['bookings'] + [b], ira)
        wb = next(x for x in self.state(wash)['bookings'] if x['id'] == 'm1')
        self.put('bookings', [dict(x, state='cancelled', declined='place', refund=175, refundTo='balance', cancelBy='place') if x['id'] == 'm1' else x for x in self.state(wash)['bookings']], wash)
        entry = {'amount': 175, 'kind': 'money', 'text': 'Повернення', 'at': 2, 'bookingId': 'm1'}
        self.assertEqual(self.put(f"wallet.{wb['clientId']}", {'money': 175, 'bonus': 0, 'history': [entry]}, wash)[0], 200)
        self.assertEqual(self.state(ira)[f'wallet.{ira_id}']['money'], 175)
        # Вдруге за той самий запис — ні.
        self.put(f"wallet.{wb['clientId']}", {'money': 350, 'bonus': 0, 'history': [dict(entry, at=3)]}, wash)
        self.assertEqual(self.state(ira)[f'wallet.{ira_id}']['money'], 175)
        # Клієнт не може сам «повернути» собі оплату на картку чи змінити суму й мийку оплаченого запису.
        paid = {'id': 'm2', 'placeId': 'blysk', 'clientId': ira_id, 'date': '2099-10-11', 'time': '10:00', 'minutes': 30, 'state': 'pending', 'paid': 0,
                'total': 0, 'needsConfirm': True, 'createdAt': int(time.time() * 1000)}
        self.put('bookings', self.state(ira)['bookings'] + [paid], ira)
        self.put('bookings', [dict(x, state='refunded', refund=999, refundTo='card', paid=1, placeId='hvylia') if x['id'] == 'm2' else x for x in self.state(ira)['bookings']], ira)
        got = mine()['m2']
        self.assertEqual((got['state'], got['placeId'], got.get('refund')), ('pending', 'blysk', None))
        # Новий запис «одразу підтверджений» без пропозиції мийки — лише на підтвердження.
        self.put('bookings', self.state(ira)['bookings'] + [dict(paid, id='m3', state='paid', fromReq='fake', needsConfirm=False)], ira)
        self.assertEqual((mine()['m3']['state'], mine()['m3'].get('fromReq')), ('pending', None))
        # Пізнє скасування (менше ніж за 1,5 год) — без повернення.
        soon = time.strftime('%Y-%m-%d', time.localtime(time.time() + 1800)), time.strftime('%H:%M', time.localtime(time.time() + 1800))
        late = dict(paid, id='m4', date=soon[0], time=soon[1])
        self.put('bookings', self.state(ira)['bookings'] + [late], ira)
        self.put('bookings', [dict(x, state='paid') if x['id'] == 'm4' else x for x in self.state(wash)['bookings']], wash)
        self.put('bookings', [dict(x, state='cancelled', refund=500, refundTo='balance') if x['id'] == 'm4' else x for x in self.state(ira)['bookings']], ira)
        self.assertEqual(mine()['m4'].get('refund'), 0)

    def test_15_misc_hardening(self):
        ira, _ = self.login_client('067 111 11 11')
        _, j = self.call('POST', '/api/auth/biz', {'demo': True})
        wash = j['token']
        # Демо-кабінет не керує чужими (не демо) мийками.
        self.put('bookings', self.state(ira)['bookings'] + [{'id': 'o1', 'placeId': 'p_orphan', 'clientId': 'tel:380671111111', 'date': '2099-01-01', 'time': '10:00', 'minutes': 30, 'state': 'pending', 'paid': 0}], ira)
        self.assertNotIn('o1', [b['id'] for b in self.state(wash)['bookings'] if 'clientName' in b or b.get('state') == 'cancelled'])
        self.put('bookings', [dict(b, state='cancelled') if b['id'] == 'o1' else b for b in self.state(wash)['bookings']], wash)
        self.assertEqual(next(b for b in self.state(ira)['bookings'] if b['id'] == 'o1')['state'], 'pending')
        # Лічильник номерів лише зростає; журнал подій — не для гостей; заявки — лише після входу.
        self.put('seq.booking', 100, ira)
        self.put('seq.booking', 1, ira)
        self.assertEqual(self.state()['seq.booking'], 100)
        self.assertEqual(self.put('analytics', [{'id': 'spam', 't': 'x'}], None)[0], 403)
        self.put('biz.applications', [{'id': 'ap1', 'status': 'new', 'name': 'spam'}], None)
        self.assertNotIn('ap1', [a['id'] for a in self.state(ira).get('biz.applications', [])])
        self.assertEqual(self.call('GET', '/api/state?since=abc')[0], 400)

    def test_16_vehicle_by_plate(self):
        self.assertEqual(self.call('GET', '/api/vehicle?plate=KA0001AA')[0], 401)  # лише після входу
        ira, _ = self.login_client('067 111 11 11')
        code, j = self.call('GET', '/api/vehicle?plate=ka%200001%20aa', token=ira)
        self.assertEqual(code, 200)
        # Найсвіжіша реєстрація номера, марка без дублювання в моделі, кросовер.
        self.assertEqual({k: j['car'][k] for k in ('make', 'model', 'year', 'color', 'fuel', 'engine', 'cls')},
                         {'make': 'Toyota', 'model': 'RAV4', 'year': 2020, 'color': 'білий', 'fuel': 'бензин', 'engine': '2,0 л', 'cls': 1})
        self.assertEqual(self.call('GET', '/api/vehicle?plate=AI7777KE', token=ira)[1]['car']['cls'], 2)
        self.assertIsNone(self.call('GET', '/api/vehicle?plate=BC5555AA', token=ira)[1]['car'])
        self.assertEqual(self.call('GET', '/api/vehicle?plate=123', token=ira)[0], 400)
        # Немає у своїй копії реєстру — питаємо онлайн-сервіс (з ключем), відповідь кешуємо.
        car = self.call('GET', '/api/vehicle?plate=BC1234HH', token=ira)[1]['car']
        self.assertEqual({k: car[k] for k in ('make', 'model', 'year', 'color', 'fuel', 'engine', 'cls')},
                         {'make': 'Hyundai', 'model': 'Tucson', 'year': 2019, 'color': 'сірий', 'fuel': 'бензин', 'engine': '2,0 л', 'cls': 1})
        self.call('GET', '/api/vehicle?plate=BC1234HH', token=ira)
        self.assertEqual([h for h in self.gai_hits if h[0].endswith('BC1234HH')], [('/nomer/BC1234HH', 'test-key')])
        j = self.call('GET', '/api/vehicle?plate=AA0000AA', token=ira)[1]
        self.assertEqual((j['car'], j['error']), (None, 'Ліміт перевірок номерів вичерпано'))

    def test_17_place_from_google_maps(self):
        ira, _ = self.login_client('067 111 11 11')
        self.assertEqual(self.call('GET', '/api/admin/place-lookup?q=x', token=ira)[0], 403)  # лише адмінка
        _, j = self.call('POST', '/api/auth/admin', {'password': 'secret-admin'})
        admin = j['token']
        code, j = self.call('GET', '/api/admin/place-lookup?q=' + urllib.request.quote('Хмаринка Київ'), token=admin)
        self.assertEqual((code, j['source']), (200, 'google'))
        r = j['results'][0]
        self.assertEqual((r['name'], r['city'], r['address'], r['phone'], r['rating']), ('Автомийка Хмаринка', 'Київ', 'вулиця Хрещатик, 1', '+380 44 123 4567', 4.7))
        self.assertEqual(r['week'][0], [480, 1260])  # понеділок 08:00–21:00
        self.assertIsNone(r['week'][6])  # неділя — вихідний
        self.assertEqual(self.goo_req[1], 'gkey')
        photo = self.call('GET', '/api/admin/place-photo?name=places/ChIJ1/photos/AbC', token=admin)[1]['photo']
        self.assertTrue(photo.startswith('data:image/jpeg;base64,'))
        self.assertEqual(self.call('GET', '/api/admin/place-photo?name=../../etc', token=admin)[0], 502)

    def test_18_maps_links_and_hours(self):
        sys.path.insert(0, HERE)
        import places_lookup as pl
        fetch = lambda url, *a, **k: ('https://www.google.com/maps/place/%D0%90%D0%B2%D1%82%D0%BE%D0%BC%D0%B8%D0%B9%D0%BA%D0%B0+%D0%9B%D1%96%D0%B4%D0%B5%D1%80/@50.4012,30.6543,17z/data=!3d50.40123!4d30.65432', b'', '')
        link = pl.parse_maps_link('https://maps.app.goo.gl/abc', fetch)
        self.assertEqual((link['name'], link['loc']), ('Автомийка Лідер', (50.40123, 30.65432)))
        self.assertIsNone(pl.parse_maps_link('Мийка Лідер Київ', fetch))
        self.assertEqual(pl._week_from_osm('Mo-Fr 08:00-20:00; Sa,Su 09:00-18:00')[5], [540, 1080])
        self.assertEqual(pl._week_from_osm('24/7'), [[0, 1440]] * 7)
        self.assertEqual(pl._week_from_google({'periods': [{'open': {'day': 0, 'hour': 0, 'minute': 0}}]}), [[0, 1440]] * 7)

    def test_19_client_avatar(self):
        import base64
        ira, ira_id = self.login_client('067 333 33 33')
        oleh, oleh_id = self.login_client('050 444 44 44')
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==')
        img = 'data:image/png;base64,' + base64.b64encode(png).decode()
        code, _ = self.put('avatars', {'aIraPhoto01': {'by': ira_id, 'img': img, 'at': 5}}, ira)
        self.assertEqual(code, 200)
        # Власник бачить своє фото повністю, інші — лише позначку, без номера власника.
        self.assertEqual(self.state(ira)['avatars']['aIraPhoto01']['img'], img)
        self.assertEqual(self.state(oleh)['avatars']['aIraPhoto01'], {'at': 5})
        # Картинка — за посиланням, без входу (як <img>), з довгим кешем.
        with urllib.request.urlopen(self.base + '/api/avatar/aIraPhoto01?v=5') as r:
            self.assertEqual(r.headers['Content-Type'], 'image/png')
            self.assertIn('max-age', r.headers['Cache-Control'])
            self.assertEqual(r.read(), png)
        # Чуже фото не замінити й не підписати своїм; не картинку не прийняти.
        self.put('avatars', {'aIraPhoto01': {'by': oleh_id, 'img': img.replace('iVBOR', 'AAAA'), 'at': 6}}, oleh)
        self.put('avatars', {'aOlehPhoto1': {'by': ira_id, 'img': img, 'at': 6}}, oleh)
        self.put('avatars', {'aOlehPhoto2': {'by': oleh_id, 'img': 'javascript:alert(1)', 'at': 6}}, oleh)
        av = self.state(ira)['avatars']
        self.assertEqual(av['aIraPhoto01']['img'], img)
        self.assertNotIn('aOlehPhoto1', av)
        self.assertNotIn('aOlehPhoto2', av)
        # Прибрала фото — посилання більше не віддає картинку.
        self.put('avatars', {'aIraPhoto01': {'by': ira_id, 'img': '', 'at': 7}}, ira)
        self.assertNotIn('aIraPhoto01', self.state(oleh)['avatars'])
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(self.base + '/api/avatar/aIraPhoto01?v=7')

    def test_20_lists_sent_as_changes(self):
        ira, ira_id = self.login_client('067 666 66 66')
        oleh, _ = self.login_client('050 777 77 77')
        mk = lambda i, t: {'id': f'd{i}', 'placeId': 'blysk', 'clientId': ira_id, 'clientName': 'Ірина', 'date': '2099-11-01', 'time': t, 'minutes': 30, 'state': 'pending', 'paid': 0, 'total': 250}
        cur = self.state(ira).get('bookings', [])
        self.put('bookings', cur + [mk(1, '10:00'), mk(2, '11:00')], ira)
        ver = self.call('GET', '/api/state?since=0', token=oleh)[1]['ver']
        # Нова зміна — Олег отримує лише її (урізаною), а не весь список.
        cur = self.state(ira)['bookings']
        self.put('bookings', cur + [mk(3, '12:00')], ira)
        j = self.call('GET', f'/api/state?since={ver}&delta=1', token=oleh)[1]
        d = j['data']['bookings']
        self.assertEqual([x['id'] for x in d['$delta']], ['d3'])
        self.assertNotIn('clientName', d['$delta'][0])
        self.assertEqual(d['$gone'], [])
        # Видалили — приходить id у «зниклих».
        ver = j['ver']
        cur = self.state(ira)['bookings']
        self.put('bookings', [x for x in cur if x['id'] != 'd2'], ira, base=cur)
        d = self.call('GET', f'/api/state?since={ver}&delta=1', token=oleh)[1]['data']['bookings']
        self.assertEqual(d['$delta'], [])
        self.assertEqual(d['$gone'], ['d2'])
        # Без delta=1 (старі застосунки) і з since=0 — список цілком.
        full = self.call('GET', f'/api/state?since={ver}', token=oleh)[1]['data']['bookings']
        self.assertIsInstance(full, list)

    def test_99_login_rate_limit(self):
        codes = [self.call('POST', '/api/auth/admin', {'password': 'x'})[0] for _ in range(12)]
        self.assertIn(429, codes)


if __name__ == '__main__':
    unittest.main()
