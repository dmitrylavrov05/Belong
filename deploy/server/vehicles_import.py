#!/usr/bin/env python3
"""Реєстр авто для перевірки за держномером: відкриті дані МВС (data.gov.ua) → vehicles.db.

МВС щомісяця публікує операції реєстрації транспортних засобів (марка, модель, рік, колір, пальне, обʼєм,
тип кузова, новий номерний знак). Скрипт завантажує архіви за останні роки й лишає для кожного номера
найсвіжішу реєстрацію. Сервер CARCAR (/api/vehicle) шукає в цій базі, коли клієнт вводить номер.

  python3 vehicles_import.py --db /var/lib/carcar/vehicles.db              # останні 5 років з data.gov.ua
  python3 vehicles_import.py --db vehicles.db --years 10                   # більше років — більше авто й місця на диску
  python3 vehicles_import.py --db vehicles.db --file tz_2024.zip --file tz_2025.csv   # вже завантажені файли

Набір даних: «Інформація з Єдиного державного реєстру транспортних засобів» (МВС), data.gov.ua.
"""
import argparse
import csv
import io
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
import urllib.request
import zipfile

DATASET = '06779371-308f-42d7-895e-5a39833375f0'
CKAN = 'https://data.gov.ua/api/3/action/'

# Кириличні літери номера, що пишуться як латинські (так само, як normPlate у vehicles.js).
LOOKALIKE = str.maketrans({'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X'})
PLATE_RE = re.compile(r'^[A-Z]{2}\d{4}[A-Z]{2}$')


def norm_plate(s):
    return re.sub(r'[\s-]', '', str(s or '').upper()).translate(LOOKALIKE)


def iso_date(s):
    s = str(s or '').strip()
    m = re.match(r'^(\d{2})\.(\d{2})\.(\d{4})', s)
    if m:
        return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    return m.group(0) if m else ''


def open_db(path):
    db = sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=OFF')
    db.execute('PRAGMA synchronous=OFF')
    db.execute('''CREATE TABLE IF NOT EXISTS vehicles (plate TEXT PRIMARY KEY, brand TEXT, model TEXT, year INTEGER, color TEXT,
                  fuel TEXT, capacity INTEGER, body TEXT, kind TEXT, d_reg TEXT)''')
    db.execute('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)')
    return db


def pick(row, *names):
    for n in names:
        v = row.get(n)
        if v not in (None, ''):
            return v.strip()
    return ''


def rows_from_text(stream):
    """CSV МВС: роздільник «;» (інколи «,»), заголовки великими літерами."""
    head = stream.readline()
    delim = ';' if head.count(';') >= head.count(',') else ','
    names = [h.strip().strip('"').upper() for h in next(csv.reader([head], delimiter=delim))]
    for r in csv.reader(stream, delimiter=delim):
        if len(r) >= len(names) - 1:
            yield dict(zip(names, r))


def text_stream(raw):
    data = raw.read(4096)
    enc = 'utf-8-sig'
    try:
        data.decode('utf-8')
    except UnicodeDecodeError:
        enc = 'cp1251'
    return io.TextIOWrapper(io.BufferedReader(_Prefixed(data, raw)), encoding=enc, errors='replace', newline='')


class _Prefixed(io.RawIOBase):
    def __init__(self, prefix, rest):
        self.prefix, self.rest = prefix, rest

    def readable(self):
        return True

    def readinto(self, b):
        if self.prefix:
            n = min(len(b), len(self.prefix))
            b[:n] = self.prefix[:n]
            self.prefix = self.prefix[n:]
            return n
        chunk = self.rest.read(len(b))
        b[:len(chunk)] = chunk
        return len(chunk)


def import_rows(db, rows):
    n = kept = 0
    batch = []
    for r in rows:
        n += 1
        plate = norm_plate(pick(r, 'N_REG_NEW', 'N_REG', 'REG_NUM'))
        if not PLATE_RE.match(plate):
            continue
        year = pick(r, 'MAKE_YEAR')
        cap = pick(r, 'CAPACITY')
        batch.append((plate, pick(r, 'BRAND'), pick(r, 'MODEL'), int(year) if year.isdigit() else None, pick(r, 'COLOR'), pick(r, 'FUEL'),
                      int(float(cap)) if re.match(r'^\d+(\.\d+)?$', cap) else None, pick(r, 'BODY'), pick(r, 'KIND'), iso_date(pick(r, 'D_REG'))))
        if len(batch) >= 20000:
            kept += _flush(db, batch)
    kept += _flush(db, batch)
    return n, kept


def _flush(db, batch):
    if not batch:
        return 0
    # Для кожного номера — найсвіжіша реєстрація (номер міг перейти до іншого авто).
    db.executemany('''INSERT INTO vehicles VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(plate) DO UPDATE SET
        brand=excluded.brand, model=excluded.model, year=excluded.year, color=excluded.color, fuel=excluded.fuel,
        capacity=excluded.capacity, body=excluded.body, kind=excluded.kind, d_reg=excluded.d_reg
        WHERE excluded.d_reg >= vehicles.d_reg''', batch)
    db.commit()
    k = len(batch)
    batch.clear()
    return k


def import_file(db, path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            total = (0, 0)
            for name in z.namelist():
                if name.lower().endswith('.csv'):
                    with z.open(name) as raw:
                        n, k = import_rows(db, rows_from_text(text_stream(raw)))
                        total = (total[0] + n, total[1] + k)
            return total
    with open(path, 'rb') as raw:
        return import_rows(db, rows_from_text(text_stream(raw)))


def dataset_files(years):
    """Архіви з data.gov.ua: найсвіжіші за останні years років (за роком у назві)."""
    with urllib.request.urlopen(f'{CKAN}package_show?id={DATASET}', timeout=60) as r:
        res = json.loads(r.read())['result']['resources']
    now = time.localtime().tm_year
    out = []
    for x in res:
        url = x.get('url') or ''
        if not re.search(r'\.(zip|csv)(\?|$)', url, re.I):
            continue
        ys = [int(y) for y in re.findall(r'(20\d\d)', (x.get('name') or '') + ' ' + url)]
        if ys and max(ys) >= now - years:
            out.append((max(ys), url))
    return [u for _, u in sorted(out)]


def download(url, folder):
    path = os.path.join(folder, re.sub(r'[^A-Za-z0-9._-]', '_', url.rsplit('/', 1)[-1].split('?')[0]) or 'part.zip')
    with urllib.request.urlopen(url, timeout=600) as r, open(path, 'wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return path


def main():
    ap = argparse.ArgumentParser(description='Реєстр авто МВС для перевірки за держномером')
    ap.add_argument('--db', required=True, help='куди записати базу (напр. /var/lib/carcar/vehicles.db)')
    ap.add_argument('--years', type=int, default=5, help='за скільки останніх років брати реєстрації (типово 5)')
    ap.add_argument('--file', action='append', default=[], help='вже завантажений архів чи CSV (можна кілька)')
    a = ap.parse_args()
    tmp_db = a.db + '.new'
    if os.path.exists(tmp_db):
        os.remove(tmp_db)
    db = open_db(tmp_db)
    files = list(a.file)
    with tempfile.TemporaryDirectory() as folder:
        if not files:
            try:
                urls = dataset_files(a.years)
            except Exception as e:
                sys.exit(f'Не вдалося отримати перелік файлів з data.gov.ua: {e}. Завантажте архіви вручну й передайте --file.')
            if not urls:
                sys.exit('На data.gov.ua не знайдено архівів за ці роки.')
            for u in urls:
                print('Завантажую', u, flush=True)
                files.append(download(u, folder))
        total = 0
        for path in files:
            n, k = import_file(db, path)
            total += n
            print(f'{os.path.basename(path)}: рядків {n}, з номерами {k}', flush=True)
            if not a.file:
                os.remove(path)  # архіви великі — не тримаємо на диску
    db.execute("INSERT OR REPLACE INTO meta VALUES ('updated', ?)", (time.strftime('%Y-%m-%d'),))
    db.commit()
    count = db.execute('SELECT COUNT(*) FROM vehicles').fetchone()[0]
    db.close()
    if count == 0:
        os.remove(tmp_db)
        sys.exit('Жодного номера не імпортовано — базу не змінено.')
    os.replace(tmp_db, a.db)
    os.chmod(a.db, 0o644)
    print(f'Готово: {count} номерів у {a.db} (рядків опрацьовано: {total})')


if __name__ == '__main__':
    main()
