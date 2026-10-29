#!/usr/bin/env bash
# RocketBig bot — установка на Ubuntu одной командой:
#   curl -fsSL https://raw.githubusercontent.com/dmitrylavrov05/belong/rocketbig-bot/install.sh | sudo bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/dmitrylavrov05/belong.git}"
BRANCH="${BRANCH:-rocketbig-bot}"
APP_DIR="/opt/rocketbig-bot"
SERVICE="rocketbig"
APP_USER="rocketbig"

if [ "$(id -u)" -ne 0 ]; then echo "Запусти через sudo"; exit 1; fi

ask() {  # ask "Вопрос" "default" -> stdout
  local q="$1" def="${2:-}" ans
  if [ -n "$def" ]; then printf "%s [%s]: " "$q" "$def" > /dev/tty; else printf "%s: " "$q" > /dev/tty; fi
  read -r ans < /dev/tty || true
  echo "${ans:-$def}"
}

echo "==> Устанавливаю пакеты"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3 python3-venv python3-pip > /dev/null

echo "==> Скачиваю бота в $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git config --global --add safe.directory "$APP_DIR"
  git -C "$APP_DIR" pull -q origin "$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Настройка (данные сохранятся в $APP_DIR/.env)"
  TOKEN=$(ask "Токен бота от @BotFather")
  while [ -z "$TOKEN" ]; do TOKEN=$(ask "Токен не может быть пустым. Токен бота"); done
  ADMINS=$(ask "Telegram ID админов через запятую" "8979144494")
  URL_RU=$(ask "Реферальная ссылка (RU)" "https://r1wapac.com/?p=mhge")
  URL_PT=$(ask "Реферальная ссылка (Бразилия)" "https://r1wclcs.com/?p=7hra")
  PROMO=$(ask "Промокод" "BIGROCKET")
  cat > "$APP_DIR/.env" <<EOF
BOT_TOKEN=$TOKEN
ADMIN_IDS=$ADMINS
BONUS_URL_RU=$URL_RU
BONUS_URL_PT=$URL_PT
PROMO_CODE=$PROMO
EOF
  chmod 600 "$APP_DIR/.env"
else
  echo "==> .env уже есть, оставляю настройки"
fi

echo "==> Ставлю зависимости Python"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install -q --upgrade pip
"$APP_DIR/venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Создаю службу systemd"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=RocketBig Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/python bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"
sleep 3

if systemctl is-active -q "$SERVICE"; then
  echo ""
  echo "✅ Бот запущен и будет работать 24/7 (перезапускается сам после сбоя и перезагрузки)."
  echo "   Логи:        journalctl -u $SERVICE -f"
  echo "   Перезапуск:  systemctl restart $SERVICE"
  echo "   Настройки:   nano $APP_DIR/.env  (потом перезапуск)"
  echo "   Обновить:    повтори команду установки"
else
  echo "❌ Бот не запустился. Последние логи:"
  journalctl -u "$SERVICE" -n 30 --no-pager
  exit 1
fi
