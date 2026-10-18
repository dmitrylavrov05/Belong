"""Дані про мийку з карт: назва, адреса, координати, телефон, графік, рейтинг і фото — для адмінки.

Google Places API (New) за ключем із конфігурації ("google_places_key") — найповніші дані (як у Google Картах).
Без ключа — OpenStreetMap (Nominatim): адреса й координати, а якщо є в OSM — телефон і графік.
Посилання на Google Карти (maps.app.goo.gl/…, google.com/maps/place/…) розбираємо: назва й координати точки.
"""
import base64
import json
import re
import urllib.parse
import urllib.request

UA = 'CARCAR/1.0 (car wash marketplace admin)'
GOOGLE = 'https://places.googleapis.com/v1'
NOMINATIM = 'https://nominatim.openstreetmap.org'
FIELDS = ','.join('places.' + f for f in ('id', 'displayName', 'formattedAddress', 'shortFormattedAddress', 'location', 'nationalPhoneNumber',
                                         'internationalPhoneNumber', 'regularOpeningHours', 'rating', 'userRatingCount', 'websiteUri',
                                         'googleMapsUri', 'photos', 'addressComponents', 'editorialSummary'))
DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']


def _get(url, headers=None, data=None, timeout=12):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.geturl(), r.read(), r.headers.get('Content-Type', '')


def parse_maps_link(text, fetch=_get):
    """Назва й координати з посилання на Google Карти (коротке посилання розгортаємо)."""
    url = text.strip()
    if not re.match(r'^https?://', url):
        return None
    try:
        final, _, _ = fetch(url)
    except Exception:
        final = url
    name = None
    m = re.search(r'/place/([^/@?]+)', final)
    if m:
        name = urllib.parse.unquote_plus(m.group(1)).strip()
    m = re.search(r'!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)', final) or re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', final) \
        or re.search(r'[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)', final)
    loc = (float(m.group(1)), float(m.group(2))) if m else None
    if not name:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(final).query)
        name = (q.get('q') or q.get('query') or [None])[0]
        if name and re.match(r'^-?\d+\.\d+,\s*-?\d+\.\d+$', name):
            name = None
    return {'name': name, 'loc': loc, 'url': final}


def _week_from_google(oh):
    """regularOpeningHours.periods (0 — неділя) → тиждень з понеділка в хвилинах: [від, до] або None."""
    periods = (oh or {}).get('periods') or []
    if not periods:
        return None
    week = [None] * 7
    for p in periods:
        o, c = p.get('open') or {}, p.get('close')
        day = (int(o.get('day', 0)) + 6) % 7
        start = int(o.get('hour', 0)) * 60 + int(o.get('minute', 0))
        if c is None:  # цілодобово
            return [[0, 24 * 60]] * 7
        end = int(c.get('hour', 0)) * 60 + int(c.get('minute', 0))
        if c.get('day') != o.get('day') or end <= start:
            end = 24 * 60  # працює за північ — до кінця доби
        week[day] = [start, end] if week[day] is None else [min(week[day][0], start), max(week[day][1], end)]
    return week


def _week_from_osm(text):
    """Прості графіки OSM: «24/7», «Mo-Fr 08:00-20:00; Sa,Su 09:00-18:00», «Mo-Su 08:00-22:00»."""
    t = (text or '').strip()
    if not t:
        return None
    if t == '24/7':
        return [[0, 24 * 60]] * 7
    week = [None] * 7
    ok = False
    for part in t.split(';'):
        m = re.match(r'^\s*([A-Za-z,\- ]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$', part)
        if not m:
            continue
        days = set()
        for chunk in m.group(1).replace(' ', '').split(','):
            if '-' in chunk:
                a, b = chunk.split('-', 1)
                if a in DAYS and b in DAYS:
                    i, j = DAYS.index(a), DAYS.index(b)
                    days.update(range(i, j + 1) if i <= j else list(range(i, 7)) + list(range(0, j + 1)))
            elif chunk in DAYS:
                days.add(DAYS.index(chunk))
        start = int(m.group(2)) * 60 + int(m.group(3))
        end = int(m.group(4)) * 60 + int(m.group(5))
        end = 24 * 60 if end <= start else end
        for d in days:
            week[d] = [start, end]
            ok = True
    return week if ok else None


def _city(components):
    for c in components or []:
        if 'locality' in (c.get('types') or []):
            return c.get('longText') or c.get('shortText')
    return None


def _short_address(full, city):
    """«вулиця Хрещатик, 1, Київ, Україна, 02000» → «вулиця Хрещатик, 1»."""
    parts = [p.strip() for p in (full or '').split(',')]
    cut = [p for p in parts if p and p != city and p not in ('Україна', 'Ukraine') and not re.match(r'^\d{5}$', p) and 'область' not in p]
    return ', '.join(cut[:3])


def google_search(key, query, loc=None, base=GOOGLE, fetch=_get):
    body = {'textQuery': query, 'languageCode': 'uk', 'regionCode': 'UA', 'maxResultCount': 5}
    if loc:
        body['locationBias'] = {'circle': {'center': {'latitude': loc[0], 'longitude': loc[1]}, 'radius': 300.0}}
    _, raw, _ = fetch(f'{base}/places:searchText', {'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS},
                      json.dumps(body).encode())
    out = []
    for p in json.loads(raw).get('places') or []:
        city = _city(p.get('addressComponents'))
        loc = p.get('location') or {}
        out.append({
            'source': 'google', 'googleId': p.get('id'), 'googleUrl': p.get('googleMapsUri') or '',
            'name': (p.get('displayName') or {}).get('text') or '', 'city': city,
            'address': p.get('shortFormattedAddress') or _short_address(p.get('formattedAddress'), city), 'fullAddress': p.get('formattedAddress') or '',
            'lat': loc.get('latitude'), 'lng': loc.get('longitude'),
            'phone': p.get('internationalPhoneNumber') or p.get('nationalPhoneNumber') or '',
            'week': _week_from_google(p.get('regularOpeningHours')),
            'hoursText': (p.get('regularOpeningHours') or {}).get('weekdayDescriptions') or [],
            'rating': p.get('rating'), 'ratingCount': p.get('userRatingCount'), 'website': p.get('websiteUri') or '',
            'about': ((p.get('editorialSummary') or {}).get('text') or ''),
            'photos': [ph.get('name') for ph in (p.get('photos') or [])[:6] if ph.get('name')],
        })
    return out


def google_photo(key, name, base=GOOGLE, fetch=_get):
    """Фото місця як data: URL (до 1000 px), щоб зберегти в профіль мийки."""
    if not re.match(r'^places/[A-Za-z0-9_\-]+/photos/[A-Za-z0-9_\-]+$', name or ''):
        raise ValueError('bad photo name')
    _, raw, ctype = fetch(f'{base}/{name}/media?maxWidthPx=1000&key={urllib.parse.quote(key)}', timeout=20)
    if len(raw) > 2_500_000:
        raise ValueError('photo too large')
    return f"data:{(ctype or 'image/jpeg').split(';')[0]};base64,{base64.b64encode(raw).decode()}"


def osm_search(query, loc=None, base=NOMINATIM, fetch=_get):
    params = {'format': 'jsonv2', 'addressdetails': 1, 'extratags': 1, 'limit': 5, 'countrycodes': 'ua', 'accept-language': 'uk'}
    if query:
        params['q'] = query
        url = f'{base}/search?{urllib.parse.urlencode(params)}'
        if loc:
            d = 0.01
            url += '&' + urllib.parse.urlencode({'viewbox': f'{loc[1] - d},{loc[0] + d},{loc[1] + d},{loc[0] - d}', 'bounded': 0})
    else:
        url = f"{base}/reverse?{urllib.parse.urlencode({**params, 'lat': loc[0], 'lon': loc[1]})}"
    _, raw, _ = fetch(url)
    items = json.loads(raw)
    items = items if isinstance(items, list) else [items] if isinstance(items, dict) and items.get('lat') else []
    out = []
    for x in items:
        a = x.get('address') or {}
        tags = x.get('extratags') or {}
        city = a.get('city') or a.get('town') or a.get('village')
        street = ', '.join(v for v in (a.get('road'), a.get('house_number')) if v)
        out.append({
            'source': 'osm', 'name': x.get('name') or (x.get('display_name') or '').split(',')[0], 'city': city,
            'address': street or _short_address(x.get('display_name'), city), 'fullAddress': x.get('display_name') or '',
            'lat': float(x['lat']), 'lng': float(x['lon']), 'phone': tags.get('phone') or tags.get('contact:phone') or '',
            'week': _week_from_osm(tags.get('opening_hours')), 'hoursText': [tags['opening_hours']] if tags.get('opening_hours') else [],
            'website': tags.get('website') or '', 'photos': [],
        })
    return out


def lookup(cfg, text, fetch=_get):
    """Пошук місця за назвою чи посиланням. Повертає (результати, джерело)."""
    link = parse_maps_link(text, fetch)
    query = (link or {}).get('name') or ('' if link else text.strip())
    loc = (link or {}).get('loc')
    key = cfg.get('google_places_key')
    if key:
        return google_search(key, query or (f'{loc[0]},{loc[1]}' if loc else ''), loc, cfg.get('google_places_url') or GOOGLE, fetch), 'google'
    if not query and not loc:
        return [], 'osm'
    return osm_search(query, loc, cfg.get('nominatim_url') or NOMINATIM, fetch), 'osm'
