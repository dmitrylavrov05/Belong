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
apt-get install -y nginx git ufw curl
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

echo "==> Сервер спільних даних (усі пристрої бачать ті самі записи)"
cat > /etc/systemd/system/carcar-sync.service <<UNIT
[Unit]
Description=CARCAR: спільні дані для всіх пристроїв
After=network.target

[Service]
ExecStart=/usr/bin/python3 $DIR/deploy/server/carcar_sync.py --host 127.0.0.1 --port 8090 --db /var/lib/carcar/data.db
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
ExecStart=/bin/sh -c 'old=\$\$(git -C $DIR rev-parse HEAD:deploy/server/carcar_sync.py 2>/dev/null); git -C $DIR fetch --depth 1 origin $BRANCH && git -C $DIR reset --hard FETCH_HEAD && chmod -R a+rX $DIR; [ "\$\$old" = "\$\$(git -C $DIR rev-parse HEAD:deploy/server/carcar_sync.py)" ] || systemctl restart carcar-sync'
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

SCHEME=$([[ $HTTPS -eq 1 ]] && echo https || echo http)
echo
echo "Готово:"
echo "  Клієнт:          $SCHEME://$DOMAIN/"
echo "  CarCar Business: $SCHEME://$DOMAIN/pro.html"
echo "  Адмінка:         $SCHEME://$DOMAIN/admin.html"
echo "Оновлення з гілки $BRANCH — кожні 5 хв (оновити зараз: sudo systemctl start carcar-update)."
echo "Спільні дані: /var/lib/carcar/data.db (резервна копія — просто скопіюйте файл). Стан: systemctl status carcar-sync"
