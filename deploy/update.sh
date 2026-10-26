#!/usr/bin/env bash
# Обновить только файлы сайта (после пересборки): bash update.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
rm -rf /var/www/gruzovoe/*
unzip -oq "$HERE/site.zip" -d /var/www/gruzovoe
chown -R www-data:www-data /var/www/gruzovoe
cp "$HERE/order_api.py" /opt/gruzovoe/ && systemctl restart gruzovoe-orders
echo "✅ Сайт обновлён"
