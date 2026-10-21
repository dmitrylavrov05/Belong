"""Навантажувальна перевірка сервера CARCAR: багато телефонів з довгим опитуванням + нові записи.

Запуск (на копії, не на робочій базі!): сервер з паролем адмінки load-admin, потім
  python3 loadtest.py http://127.0.0.1:8099 <телефонів> <тих, хто записується> <секунд> <записів_у_базі>
"""
import http.client
import json
import random
import statistics
import sys
import threading
import time
import urllib.parse

base = sys.argv[1]
POLLERS = int(sys.argv[2])
WRITERS = int(sys.argv[3])
SECONDS = int(sys.argv[4])
PREFILL = int(sys.argv[5])
DELTA = (sys.argv[6] if len(sys.argv) > 6 else 'delta') == 'delta'  # як телефони: списки змінами
u = urllib.parse.urlparse(base)


import re
VER = re.compile(rb'"ver":(\d+)')


def req(method, path, body=None, token=None, timeout=60, light=False):
    c = http.client.HTTPConnection(u.hostname, u.port, timeout=timeout)
    h = {'Content-Type': 'application/json'}
    if token:
        h['Authorization'] = 'Bearer ' + token
    c.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
    r = c.getresponse()
    data = r.read()
    c.close()
    if light:
        m = VER.search(data[:40])
        return r.status, {'ver': int(m.group(1)) if m else 0}, len(data)
    return r.status, (json.loads(data) if data else {}), len(data)


def login(i):
    return req('POST', '/api/auth/demo', {'phone': f'+38067{i:07d}'})[1]['token']


places = ['blysk', 'aqua24', 'hvylia', 'strumin', 'pina', 'kraplia', 'chysto', 'hlyanets', 'keramika']
admin = req('POST', '/api/auth/admin', {'password': 'load-admin'})[1]['token']
if PREFILL:
    pre = [{'id': f'p{i}', 'placeId': random.choice(places), 'clientId': f'tel:38050{i:07d}', 'clientName': 'Клієнт', 'clientPhone': f'+38050{i:07d}',
            'date': f'2026-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}', 'time': '10:00', 'minutes': 30, 'state': 'completed',
            'services': ['Експрес-мийка кузова'], 'paid': 250, 'total': 250, 'createdAt': int(time.time() * 1000), 'chat': []} for i in range(PREFILL)]
    print('prefill', req('PUT', '/api/state/bookings', {'value': pre}, admin)[0])

stop = time.time() + SECONDS
lat_put, prop, errors, bytes_in = [], [], [0], [0]
written = {}  # ver -> time
lock = threading.Lock()
tokens = [login(i) for i in range(POLLERS + WRITERS)]
print('logged in', len(tokens))


def poller(tok):
    try:
        _, j, n = req('GET', '/api/state?since=0', token=tok)
        ver = j['ver']
        bytes_in[0] += n
        while time.time() < stop:
            st, j, n = req('GET', f'/api/state?since={ver}&wait=1' + ('&delta=1' if DELTA else ''), token=tok, timeout=40, light=True)
            if st != 200:
                errors[0] += 1
                time.sleep(1)
                continue
            now = time.time()
            with lock:
                bytes_in[0] += n
                for v, t in written.items():
                    if ver < v <= j['ver']:
                        prop.append(now - t)
            ver = j['ver']
    except Exception:
        errors[0] += 1


def writer(tok, i):
    try:
        cid = req('GET', '/api/me', token=tok)[1]['cid']
        k = 0
        while time.time() < stop:
            _, j, _ = req('GET', '/api/state?since=0', token=tok)
            mine = j['data'].get('bookings', [])
            b = {'id': f'w{i}-{k}', 'placeId': random.choice(places), 'clientId': cid, 'clientName': 'Тест', 'date': '2026-11-01',
                 'time': f'{8 + k % 12:02d}:00', 'minutes': 30, 'state': 'paid', 'services': ['Експрес-мийка кузова'], 'paid': 0, 'total': 250,
                 'createdAt': int(time.time() * 1000)}
            t = time.time()
            st, r, _ = req('PUT', '/api/state/bookings', {'value': mine + [b], 'base': mine}, tok)
            dt = time.time() - t
            with lock:
                lat_put.append(dt)
                if st == 200:
                    written[r['ver']] = time.time()
                else:
                    errors[0] += 1
            k += 1
            time.sleep(2)
    except Exception as e:
        errors[0] += 1
        print('writer error', e)


ths = [threading.Thread(target=poller, args=(t,), daemon=True) for t in tokens[:POLLERS]]
ths += [threading.Thread(target=writer, args=(t, i), daemon=True) for i, t in enumerate(tokens[POLLERS:])]
t0 = time.time()
for t in ths:
    t.start()
time.sleep(SECONDS + 5)


def pct(a, p):
    return sorted(a)[int(len(a) * p) - 1] if a else float('nan')


print(json.dumps({
    'pollers': POLLERS, 'writers': WRITERS, 'prefill': PREFILL, 'writes': len(lat_put),
    'put_p50_ms': round(statistics.median(lat_put) * 1000) if lat_put else None, 'put_p95_ms': round(pct(lat_put, .95) * 1000) if lat_put else None,
    'propagation_p50_ms': round(statistics.median(prop) * 1000) if prop else None, 'propagation_p95_ms': round(pct(prop, .95) * 1000) if prop else None,
    'deliveries': len(prop), 'errors': errors[0], 'MB_downloaded': round(bytes_in[0] / 1e6, 1),
}, ensure_ascii=False))
