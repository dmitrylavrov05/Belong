#!/usr/bin/env bash
# Розгортання CARCAR на власному сервері Ubuntu 24.04 замість Netlify.
# Статичні файли з autoservice/app віддає nginx, HTTPS — безкоштовний сертифікат Let's Encrypt,
# оновлення — кожні 5 хвилин з гілки GitHub (як автодеплой на Netlify, але без кредитів).
#
# Запуск на сервері (від root або через sudo):
#   sudo bash setup.sh --domain carcar.example.com --email you@example.com
#   sudo bash setup.sh                      # без домену: <IP сервера>.sslip.io
# Необовʼязково:
#   --branch <гілка>   (типово claude/car-wash-tire-service-app-npsdxv)
#   --repo <url>       (типово https://github.com/dmitrylavrov05/Belong.git;
#                       для приватного репозиторію: https://<token>@github.com/dmitrylavrov05/Belong.git)
#   --no-https         без сертифіката (лише для перевірки: мікрофон, сповіщення й офлайн без HTTPS не працюють)
#
# Налаштування сервера — у /etc/carcar/config.json (Telegram-бот, LiqPay, TURN, пароль адмінки).
# Скрипт можна запускати повторно: він нічого не перезаписує з того, що ви туди вже внесли.
set -euo pipefail

DOMAIN=""
EMAIL=""
BRANCH="claude/car-wash-tire-service-app-npsdxv"
REPO="https://github.com/dmitrylavrov05/Belong.git"
HTTPS=1
DIR=/opt/carcar

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --no-https) HTTPS=0; shift ;;
    *) echo "Невідомий параметр: $1" >&2; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then echo "Запустіть через sudo" >&2; exit 1; fi
# Без домену: безкоштовне імʼя <IP>.sslip.io саме вказує на IP сервера, на нього видається сертифікат.
if [[ -z "$DOMAIN" ]]; then
  IP=$(curl -4 -s --max-time 5 https://api.ipify.org || true)
  [[ -z "$IP" ]] && { echo "Вкажіть --domain (наприклад, 185.166.155.225.sslip.io)" >&2; exit 1; }
  DOMAIN="$IP.sslip.io"
  echo "Домен не вказано — використовуємо $DOMAIN"
fi

echo "==> Пакети"
apt-get update -y
apt-get install -y nginx git ufw curl python3 python3-cryptography coturn openssl
[[ $HTTPS -eq 1 ]] && apt-get install -y certbot python3-certbot-nginx

echo "==> Код застосунку в $DIR"
if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" remote set-url origin "$REPO"
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
chmod -R a+rX "$DIR"

echo "==> nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$(dirname "$0")/nginx.conf" > /etc/nginx/sites-available/carcar
ln -sf /etc/nginx/sites-available/carcar /etc/nginx/sites-enabled/carcar
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> Брандмауер"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

if [[ $HTTPS -eq 1 ]]; then
  echo "==> HTTPS (Let's Encrypt, продовжується автоматично)"
  if [[ -n "$EMAIL" ]]; then MAIL=(-m "$EMAIL"); else MAIL=(--register-unsafely-without-email); fi
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos "${MAIL[@]}" --redirect
fi

SCHEME=$([[ $HTTPS -eq 1 ]] && echo https || echo http)
CFG=/etc/carcar/config.json
mkdir -p /etc/carcar
chmod 700 /etc/carcar
[[ -f "$CFG" ]] || echo '{}' > "$CFG"
chmod 600 "$CFG"

echo "==> Пароль адмінки"
ADMIN_PASS=""
if ! grep -q admin_password_hash "$CFG"; then
  ADMIN_PASS=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)
  python3 "$DIR/deploy/server/carcar_sync.py" --config "$CFG" --set-admin-password "$ADMIN_PASS" >/dev/null
  echo "$ADMIN_PASS" > /root/carcar-admin-password.txt
  chmod 600 /root/carcar-admin-password.txt
fi

echo "==> TURN-сервер для дзвінків (coturn): голос проходить навіть через мобільний інтернет"
PUBLIC_IP=$(curl -4 -s --max-time 5 https://api.ipify.org || true)
TURN_SECRET=$(python3 - "$CFG" "$DOMAIN" <<'PY'
import json, secrets, sys
path, domain = sys.argv[1], sys.argv[2]
cfg = json.load(open(path))
turn = cfg.get('turn') or {}
turn.setdefault('secret', secrets.token_hex(24))
turn['host'] = turn.get('host') or domain
cfg['turn'] = turn
json.dump(cfg, open(path, 'w'), ensure_ascii=False, indent=2)
print(turn['secret'])
PY
)
cat > /etc/turnserver.conf <<CONF
# Створено setup.sh CARCAR. Паролі тимчасові: їх видає сервер CARCAR (/api/ice) за спільним секретом.
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$DOMAIN
${PUBLIC_IP:+external-ip=$PUBLIC_IP}
min-port=49160
max-port=49200
total-quota=200
stale-nonce=600
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
# Не пускаємо ретрансляцію у внутрішні мережі сервера.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
CONF
chmod 640 /etc/turnserver.conf
chgrp turnserver /etc/turnserver.conf 2>/dev/null || true
[[ -f /etc/default/coturn ]] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn
systemctl restart coturn
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 49160:49200/udp

echo "==> Сервер CARCAR (спільні дані, вхід, сповіщення, оплата)"
cat > /etc/systemd/system/carcar-sync.service <<UNIT
[Unit]
Description=CARCAR: спільні дані для всіх пристроїв
After=network.target

[Service]
ExecStart=/usr/bin/python3 $DIR/deploy/server/carcar_sync.py --host 127.0.0.1 --port 8090 --db /var/lib/carcar/data.db --config %d/config.json --public-url $SCHEME://$DOMAIN
# Конфігурація з ключами доступна лише цьому сервісу (копія /etc/carcar/config.json).
LoadCredential=config.json:$CFG
DynamicUser=yes
StateDirectory=carcar
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now carcar-sync
systemctl restart carcar-sync

echo "==> Автооновлення з GitHub кожні 5 хвилин"
cat > /etc/systemd/system/carcar-update.service <<UNIT
[Unit]
Description=Оновити CARCAR з GitHub
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'old=\$\$(git -C $DIR rev-parse HEAD:deploy/server 2>/dev/null); git -C $DIR fetch --depth 1 origin $BRANCH && git -C $DIR reset --hard FETCH_HEAD && chmod -R a+rX $DIR; [ "\$\$old" = "\$\$(git -C $DIR rev-parse HEAD:deploy/server)" ] || systemctl restart carcar-sync'
UNIT
cat > /etc/systemd/system/carcar-update.timer <<UNIT
[Unit]
Description=Оновлювати CARCAR кожні 5 хвилин

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now carcar-update.timer

echo "==> Щоденна резервна копія бази (/var/backups/carcar, 14 днів)"
cat > /etc/systemd/system/carcar-backup.service <<UNIT
[Unit]
Description=Резервна копія даних CARCAR

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $DIR/deploy/ubuntu/backup.py /var/lib/carcar/data.db /var/backups/carcar
UNIT
cat > /etc/systemd/system/carcar-backup.timer <<UNIT
[Unit]
Description=Щодня о 04:00 — резервна копія CARCAR

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now carcar-backup.timer

echo
echo "Готово:"
echo "  Клієнт:          $SCHEME://$DOMAIN/"
echo "  CarCar Business: $SCHEME://$DOMAIN/pro.html"
echo "  Адмінка:         $SCHEME://$DOMAIN/admin.html"
echo "Оновлення з гілки $BRANCH — кожні 5 хв (оновити зараз: sudo systemctl start carcar-update)."
echo "Дані: /var/lib/carcar/data.db, копії щодня в /var/backups/carcar. Стан: systemctl status carcar-sync"
if [[ -n "$ADMIN_PASS" ]]; then
  echo
  echo "Пароль адмінки: $ADMIN_PASS   (збережено в /root/carcar-admin-password.txt)"
fi
echo
echo "Налаштування: $CFG — Telegram-бот, LiqPay (див. deploy/ubuntu/README.md)."
echo "Після змін у ньому: sudo systemctl restart carcar-sync"
