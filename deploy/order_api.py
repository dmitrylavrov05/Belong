# -*- coding: utf-8 -*-
"""
Приём заявок с сайта Gruzovoe-Kharkiv.
POST /api/order (form-urlencoded) → сообщение в Telegram + строка в orders.csv.
Только стандартная библиотека Python, без зависимостей.

Переменные окружения:
  BOT_TOKEN      — токен бота от @BotFather
  ORDER_CHAT_ID  — кому слать заявки: ваш Telegram ID или ID группы диспетчеров
  ORDERS_CSV     — путь к журналу заявок (по умолчанию /var/lib/gruzovoe/orders.csv)
  PORT           — порт (по умолчанию 8081, слушает только 127.0.0.1)
"""
import os, csv, json, time, html, threading, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime
from zoneinfo import ZoneInfo

TOKEN = os.environ.get("BOT_TOKEN", "")
CHAT_ID = os.environ.get("ORDER_CHAT_ID", "")
CSV_PATH = os.environ.get("ORDERS_CSV", "/var/lib/gruzovoe/orders.csv")
PORT = int(os.environ.get("PORT", "8081"))
TZ = ZoneInfo("Europe/Kyiv")

FIELDS = ["phone", "from", "to", "route", "loaders", "vehicle", "price_estimate", "discount", "page", "lang"]
MAX_BODY = 8 * 1024
RATE_N, RATE_WINDOW = 5, 600          # не больше 5 заявок с одного IP за 10 минут
_hits, _lock = {}, threading.Lock()


def rate_ok(ip):
    now = time.time()
    with _lock:
        q = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        if len(q) >= RATE_N:
            _hits[ip] = q
            return False
        q.append(now)
        _hits[ip] = q
        return True


def save_csv(row):
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    new = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["time"] + FIELDS)
        w.writerow([row.get("time", "")] + [row.get(k, "") for k in FIELDS])


def send_telegram(row):
    if not TOKEN or not CHAT_ID:
        return False
    e = lambda k: html.escape(row.get(k, "") or "—")
    text = (f"🚚 <b>Нова заявка</b> · {e('time')}\n\n"
            f"📞 <b>{e('phone')}</b>\n"
            f"🅰️ {e('from')}\n🅱️ {e('to')}\n"
            f"👷 Вантажники: {e('loaders')}\n"
            f"💰 Ціна на сайті: <b>{e('price_estimate')}</b>\n"
            f"🎁 {e('discount')}\n"
            f"📄 Сторінка: {e('page')} ({e('lang')})")
    data = urllib.parse.urlencode({"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}).encode()
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{TOKEN}/sendMessage", data=data, timeout=10) as r:
            return r.status == 200
    except Exception as ex:
        print("telegram error:", ex, flush=True)
        return False


class H(BaseHTTPRequestHandler):
    def _reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.rstrip("/") != "/api/order":
            return self._reply(404, {"ok": False})
        ip = self.headers.get("X-Real-IP") or self.client_address[0]
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._reply(400, {"ok": False})
        form = urllib.parse.parse_qs(self.rfile.read(n).decode("utf-8", "replace"))
        get = lambda k: (form.get(k, [""])[0] or "").strip()[:300]
        if get("company"):                       # скрытое поле-ловушка для ботов
            return self._reply(200, {"ok": True})
        phone_digits = "".join(c for c in get("phone") if c.isdigit())
        if len(phone_digits) < 12:
            return self._reply(400, {"ok": False, "error": "phone"})
        if not rate_ok(ip):
            return self._reply(429, {"ok": False, "error": "rate"})
        row = {k: get(k) for k in FIELDS}
        row["time"] = datetime.now(TZ).strftime("%d.%m.%Y %H:%M")
        saved = True
        try:
            save_csv(row)
        except Exception as ex:
            print("csv error:", ex, flush=True)
            saved = False
        sent = send_telegram(row)
        print(f"order {row['time']} {row['phone']} tg={sent} csv={saved}", flush=True)
        return self._reply(200 if (sent or saved) else 502, {"ok": sent or saved})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"order api on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
