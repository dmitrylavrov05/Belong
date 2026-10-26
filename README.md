# Gruzovoe-Kharkiv — сайт грузового такси

## Установка на сервер (Ubuntu 24.04, рядом с другими сайтами)
```bash
apt install -y git
git clone -b gruzovoe-kharkiv --single-branch https://github.com/dmitrylavrov05/belong.git /root/gruzovoe
cd /root/gruzovoe/deploy
BOT_TOKEN="токен_бота" ORDER_CHAT_ID="ваш_telegram_id" bash setup.sh
```
Сайт откроется на отдельном порту (по умолчанию 8654): `http://IP_СЕРВЕРА:8654`.

С доменом и HTTPS:
```bash
DOMAIN="ваш-домен.com.ua" EMAIL="почта" BOT_TOKEN="..." ORDER_CHAT_ID="..." bash setup.sh
```

## Обновление
```bash
cd /root/gruzovoe && git pull && cd deploy && bash update.sh
```

## Папки
- `deploy/` — готовый сайт (`site.zip`), приём заявок (`order_api.py`), скрипты `setup.sh` и `update.sh`
- `source/` — генератор сайта: `python3 build.py prod`
- `telegram-bot/` — бот для публикаций в чатах с разрешения админов
- `gruzovoe-kharkiv-server.zip` — всё для сервера одним архивом
