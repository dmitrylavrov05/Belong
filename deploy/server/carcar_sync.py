#!/usr/bin/env python3
"""Спільні дані CARCAR для всіх пристроїв: клієнтів, мийок і адмінки.

Застосунок зберігає дані у вигляді ключів (bookings, reviews, partners…). Цей сервер тримає спільну копію
кожного ключа в SQLite, приймає зміни й розсилає їх іншим пристроям через «довге опитування».

  GET  /api/ping                     — сервер працює
  GET  /api/state?since=N&wait=1     — ключі, змінені після версії N (чекає до 25 с, якщо змін немає)
  PUT  /api/state/<key>  {value, base}
                                     — записати ключ. base — значення, яке пристрій бачив востаннє:
                                       якщо тим часом ключ змінив хтось інший, зміни зливаються (див. merge).

Лише стандартна бібліотека Python 3. Запуск: python3 carcar_sync.py --port 8090 --db /var/lib/carcar/data.db
Для локальної перевірки можна віддавати й сам застосунок: --static ../../autoservice/app

Увага: це демо без входу на сервері — хто знає адресу, може прочитати й змінити дані.
У робочій версії потрібні авторизація й перевірка прав для кожного запису.
"""
import argparse
import json
import mimetypes
import os
import re
import sqlite3
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

KEY_RE = re.compile(r'^[A-Za-z0-9_.\-]{1,120}$')
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

class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, ver INTEGER NOT NULL)')
        self.db.commit()
        self.lock = threading.Lock()
        self.changed = threading.Condition(self.lock)
        row = self.db.execute('SELECT MAX(ver) FROM kv').fetchone()
        self.ver = row[0] or 0

    def since(self, ver):
        rows = self.db.execute('SELECT key, value FROM kv WHERE ver > ?', (ver,)).fetchall()
        return {k: json.loads(v) for k, v in rows}

    def get(self, key):
        row = self.db.execute('SELECT value FROM kv WHERE key = ?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, key, value, base, has_base):
        with self.lock:
            cur = self.get(key)
            merged = merge(base if has_base else cur, cur, value) if cur is not None else value
            if merged != cur:
                self.ver += 1
                self.db.execute('INSERT INTO kv (key, value, ver) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, ver = excluded.ver',
                                (key, json.dumps(merged, ensure_ascii=False), self.ver))
                self.db.commit()
                self.changed.notify_all()
            return self.ver, merged

    def wait(self, ver, seconds):
        with self.lock:
            if self.ver <= ver:
                self.changed.wait(seconds)
            return self.ver, self.since(ver)


# ---------- HTTP ----------

def make_handler(store, static_dir):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, fmt, *args):  # тихо, без журналу кожного запиту
            pass

        def send_json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == '/api/ping':
                return self.send_json(200, {'ok': True, 'ver': store.ver})
            if url.path == '/api/state':
                q = parse_qs(url.query)
                since = int((q.get('since') or ['0'])[0] or 0)
                if (q.get('wait') or ['0'])[0] == '1':
                    ver, data = store.wait(since, WAIT_SECONDS)
                else:
                    ver, data = store.ver, store.since(since)
                return self.send_json(200, {'ver': ver, 'data': data})
            if static_dir:
                return self.serve_static(url.path)
            self.send_json(404, {'error': 'not found'})

        def do_HEAD(self):
            url = urlparse(self.path)
            if static_dir and not url.path.startswith('/api/'):
                return self.serve_static(url.path)
            self.send_json(404, {'error': 'not found'})

        def do_PUT(self):
            url = urlparse(self.path)
            m = re.match(r'^/api/state/(.+)$', url.path)
            key = unquote(m.group(1)) if m else ''
            if not KEY_RE.match(key):
                return self.send_json(400, {'error': 'bad key'})
            size = int(self.headers.get('Content-Length') or 0)
            if size > MAX_BODY:
                return self.send_json(413, {'error': 'too large'})
            try:
                body = json.loads(self.rfile.read(size) or b'{}')
            except ValueError:
                return self.send_json(400, {'error': 'bad json'})
            ver, merged = store.put(key, body.get('value'), body.get('base'), 'base' in body)
            self.send_json(200, {'ver': ver, 'value': merged})

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


def main():
    ap = argparse.ArgumentParser(description='Спільні дані CARCAR')
    ap.add_argument('--port', type=int, default=8090)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--db', default='/var/lib/carcar/data.db')
    ap.add_argument('--static', default='', help='тека застосунку, щоб віддавати його без nginx (для перевірки)')
    a = ap.parse_args()
    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('application/manifest+json', '.webmanifest')
    store = Store(a.db)
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(store, a.static and os.path.abspath(a.static)))
    srv.daemon_threads = True
    print(f'CARCAR sync: http://{a.host}:{a.port}  db={a.db}  ver={store.ver}', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
