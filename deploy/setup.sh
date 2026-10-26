#!/usr/bin/env bash
# Установка сайта Gruzovoe-Kharkiv на Ubuntu 24.04 РЯДОМ с другими сайтами.
# Ничего не удаляет и не меняет в чужих конфигурациях.
#
# Без домена (сайт на отдельном порту):
#   BOT_TOKEN="123:ABC" ORDER_CHAT_ID="123456789" bash setup.sh
#   → http://IP_СЕРВЕРА:8654   (порт можно задать: SITE_PORT=9000)
#
# С доменом (обычные 80/443 по имени домена, другие сайты не мешают):
#   DOMAIN="gruzovoe-kharkiv.com.ua" EMAIL="you@mail.com" BOT_TOKEN=... ORDER_CHAT_ID=... bash setup.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEB=/var/www/gruzovoe
APP=/opt/gruzovoe
DATA=/var/lib/gruzovoe
CONF=/etc/nginx/sites-available/gruzovoe
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
BOT_TOKEN="${BOT_TOKEN:-}"
ORDER_CHAT_ID="${ORDER_CHAT_ID:-}"
SITE_PORT="${SITE_PORT:-8654}"
API_PORT="${API_PORT:-18654}"

if [ "$(id -u)" != "0" ]; then echo "Запустите от root: sudo bash setup.sh"; exit 1; fi
if [ -z "$BOT_TOKEN" ] || [ -z "$ORDER_CHAT_ID" ]; then
  echo "⚠️  BOT_TOKEN/ORDER_CHAT_ID не заданы — заявки будут только в $DATA/orders.csv"
fi

# --- свободный порт: если занят не нами, берём следующий ---
port_busy() { ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q .; }
our_port()  { [ -f "$CONF" ] && grep -q "listen $1" "$CONF"; }
pick_port() { local p=$1; while port_busy "$p" && ! our_port "$p"; do p=$((p+1)); done; echo "$p"; }

echo "==> Проверяю nginx"
NGINX_WAS_INSTALLED=0
dpkg -s nginx >/dev/null 2>&1 && NGINX_WAS_INSTALLED=1
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx python3 unzip iproute2
if [ "$NGINX_WAS_INSTALLED" = "0" ]; then
  # nginx только что поставлен нами — его демо-страница никому не нужна
  rm -f /etc/nginx/sites-enabled/default
fi

# Порт 80 занят чем-то кроме nginx (например Apache)? Тогда работаем только через отдельный порт.
PORT80_OTHER=0
if port_busy 80 && ! ss -ltnpH "( sport = :80 )" 2>/dev/null | grep -q nginx; then PORT80_OTHER=1; fi

SITE_PORT=$(pick_port "$SITE_PORT")
# порт API проверяем, игнорируя нашу же работающую службу
systemctl stop gruzovoe-orders 2>/dev/null || true
API_PORT=$(pick_port "$API_PORT")
echo "   Порт сайта: $SITE_PORT, внутренний порт заявок: $API_PORT"

echo "==> Копирую сайт в $WEB"
mkdir -p "$WEB"
rm -rf "${WEB:?}"/*
unzip -oq "$HERE/site.zip" -d "$WEB"
chown -R www-data:www-data "$WEB"

echo "==> Приём заявок"
id gruzovoe >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin gruzovoe
mkdir -p "$APP" "$DATA"
cp "$HERE/order_api.py" "$APP/"
chown -R gruzovoe:gruzovoe "$DATA"
cat > /etc/gruzovoe.env <<EOF
BOT_TOKEN=$BOT_TOKEN
ORDER_CHAT_ID=$ORDER_CHAT_ID
ORDERS_CSV=$DATA/orders.csv
PORT=$API_PORT
EOF
chmod 600 /etc/gruzovoe.env
cat > /etc/systemd/system/gruzovoe-orders.service <<'EOF'
[Unit]
Description=Gruzovoe-Kharkiv order API
After=network-online.target

[Service]
EnvironmentFile=/etc/gruzovoe.env
ExecStart=/usr/bin/python3 /opt/gruzovoe/order_api.py
User=gruzovoe
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/gruzovoe
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable gruzovoe-orders >/dev/null
systemctl restart gruzovoe-orders

echo "==> Конфигурация nginx (только свой файл)"
LISTEN="    listen $SITE_PORT;
    listen [::]:$SITE_PORT;"
NAMES="_"
if [ -n "$DOMAIN" ] && [ "$PORT80_OTHER" = "0" ]; then
  LISTEN="$LISTEN
    listen 80;
    listen [::]:80;"
  NAMES="$DOMAIN www.$DOMAIN"
fi
BACKUP=""
[ -f "$CONF" ] && BACKUP="$(mktemp)" && cp "$CONF" "$BACKUP"
cat > "$CONF" <<EOF
limit_req_zone \$binary_remote_addr zone=gruzovoe_orders:10m rate=6r/m;

server {
$LISTEN
    server_name $NAMES;
    root $WEB;
    index index.html;
    charset utf-8;

    gzip on;
    gzip_types text/css application/javascript image/svg+xml application/xml text/plain;
    gzip_min_length 512;
    add_header X-Content-Type-Options nosniff always;

    location = /api/order {
        limit_req zone=gruzovoe_orders burst=3 nodelay;
        client_max_body_size 8k;
        proxy_pass http://127.0.0.1:$API_PORT;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
    }

    location ~* \.(css|js|svg|png|jpg|jpeg|webp|woff2)$ {
        expires 7d;
        add_header Cache-Control "public";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ =404;
    }

    error_page 404 /404.html;
}
EOF
ln -sf "$CONF" /etc/nginx/sites-enabled/gruzovoe
if ! nginx -t; then
  echo "❌ Ошибка в конфигурации nginx — откатываю свой файл, ваши сайты не затронуты."
  if [ -n "$BACKUP" ]; then cp "$BACKUP" "$CONF"; else rm -f "$CONF" /etc/nginx/sites-enabled/gruzovoe; fi
  exit 1
fi
systemctl enable nginx >/dev/null
systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> Открываю порт $SITE_PORT в ufw"
  ufw allow "$SITE_PORT/tcp"
fi

if [ -n "$DOMAIN" ]; then
  if [ "$PORT80_OTHER" = "1" ]; then
    echo "⚠️  Порт 80 занят другим веб-сервером (не nginx). Домен через 80/443 настроить автоматически нельзя —"
    echo "   сайт доступен на порту $SITE_PORT. Напишите, какой сервер у вас стоит, и я дам инструкцию."
  else
    echo "==> HTTPS-сертификат для $DOMAIN"
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
    if [ -n "$EMAIL" ]; then MAILOPT="-m $EMAIL"; else MAILOPT="--register-unsafely-without-email"; fi
    certbot --nginx --cert-name gruzovoe -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos $MAILOPT --redirect \
      || echo "⚠️  Сертификат не получен. Проверьте A-записи $DOMAIN и www.$DOMAIN → этот сервер и запустите скрипт ещё раз."
  fi
fi

IP=$(hostname -I | awk '{print $1}')
echo
echo "✅ Готово. Другие сайты не затронуты."
echo "   Сайт: http://$IP:$SITE_PORT"
[ -n "$DOMAIN" ] && [ "$PORT80_OTHER" = "0" ] && echo "   По домену: https://$DOMAIN"
echo "   Заявки: Telegram + $DATA/orders.csv"
echo "   Логи заявок: journalctl -u gruzovoe-orders -f"
