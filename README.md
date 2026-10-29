# RocketBig Telegram-бот

## Что умеет
- **/start**: выбор языка 🇷🇺 / 🇧🇷, затем приветствие с логотипом, бонусом +500%, промокодом `ROCKETBIG` (копируется нажатием) и кнопкой «Забрать бонус».
- **Кнопка «Забрать бонус»**: засчитывает клик в статистику и выдаёт кнопку-ссылку на 1win.
- **/lang**: сменить язык.
- **Админ-команды** (работают только для ID из `ADMIN_IDS`):
  - `/stats`: всего пользователей, активные, новые за сегодня, RU/PT, клики, конверсия.
  - `/broadcast текст`: рассылка всем.
  - `/broadcast ru текст` или `/broadcast pt текст`: рассылка по языку.
  - Ответить `/broadcast` на любое своё сообщение (фото, видео, текст с кнопками): бот скопирует его всем.
  - Перед отправкой всегда спрашивает подтверждение. Тех, кто заблокировал бота, помечает неактивными.
  - `/admin`: список команд.

## Установка на Ubuntu одной командой
```bash
curl -fsSL https://raw.githubusercontent.com/dmitrylavrov05/belong/rocketbig-bot/install.sh | sudo bash
```
Скрипт спросит токен, твой Telegram ID, ссылку и промокод. Потом он сам поставит всё нужное и запустит бота как службу, которая работает 24/7.

- Логи: `journalctl -u rocketbig -f`
- Перезапуск: `sudo systemctl restart rocketbig`
- Поменять настройки: `sudo nano /opt/rocketbig-bot/.env`, потом сделать перезапуск
- Обновить бота: повторить команду установки (настройки сохранятся)

## Ручной запуск (Windows / любой ПК)

### 1. Создай бота
1. Открой @BotFather, отправь `/newbot` и задай имя и username (например `RocketBig_bot`).
2. Скопируй токен вида `123456789:AA...`.
3. Свой Telegram ID узнай у @userinfobot.

### 2. Настрой
Переименуй `.env.example` в `.env` и заполни:
```
BOT_TOKEN=токен_от_BotFather
ADMIN_IDS=твой_id
BONUS_URL=твоя_партнёрская_ссылка_1win
PROMO_CODE=ROCKETBIG
```

### 3. Запусти
Нужен Python 3.10 или новее.

- **Windows**: дважды щёлкни `start.bat`.
- **Linux / Mac / сервер**: выполни `./start.sh`.

Скрипт сам создаст окружение, поставит зависимости и запустит бота. Пока окно открыто, бот работает.

### Чтобы бот работал 24/7 на сервере (Ubuntu)
```bash
sudo nano /etc/systemd/system/rocketbig.service
```
```
[Unit]
Description=RocketBig bot
After=network.target

[Service]
WorkingDirectory=/home/USER/rocketbig_bot
ExecStart=/home/USER/rocketbig_bot/venv/bin/python bot.py
Restart=always

[Install]
WantedBy=multi-user.target
```
Перед этим один раз запусти `./start.sh`, чтобы создалось окружение `venv`. Потом выполни:
```bash
sudo systemctl enable --now rocketbig
sudo systemctl status rocketbig
```

## Файлы
- `bot.py`: код бота. Тексты на обоих языках лежат в словаре `T` в начале файла, их можно править.
- `logo.png`: картинка в приветствии.
- `bot.db`: база пользователей и кликов, создаётся автоматически.
