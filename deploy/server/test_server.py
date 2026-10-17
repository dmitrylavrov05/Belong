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
import unittest
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

    def test_99_login_rate_limit(self):
        codes = [self.call('POST', '/api/auth/admin', {'password': 'x'})[0] for _ in range(12)]
        self.assertIn(429, codes)


if __name__ == '__main__':
    unittest.main()
