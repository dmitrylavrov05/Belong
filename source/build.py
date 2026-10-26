# -*- coding: utf-8 -*-
"""Генератор сайта. Запуск: python3 build.py [prod|preview]"""
import os, sys, json, html, shutil
from content import SERVICES, DISTRICTS, HOME, UI
from content_extra import SERVICES_EXTRA, DISTRICTS_EXTRA, GUIDES
CORE_SERVICES = list(SERVICES)
SERVICES = SERVICES + SERVICES_EXTRA
DISTRICTS = DISTRICTS + DISTRICTS_EXTRA
UI["uk"].update({"guides": "Корисне", "guides_h": "Корисне перед переїздом", "read": "Читати"})
UI["ru"].update({"guides": "Полезное", "guides_h": "Полезное перед переездом", "read": "Читать"})
ROUTE = {
 "uk": {"from": "Звідки", "to": "Куди", "from_ph": "Вулиця й будинок, звідки забрати", "to_ph": "Куди везти", "loaders": "Вантажники", "none": "Без вантажників",
  "km": "км", "min": "хв", "h": "год", "approx": "Орієнтовна вартість", "car": "Газель", "mileage": "Пробіг за містом", "ldr": "Вантажники",
  "calc": "Рахуємо маршрут…", "nores": "Нічого не знайдено. Спробуйте вказати вулицю й номер будинку.", "noroute": "Не вдалося побудувати маршрут. Диспетчер порахує ціну по телефону.",
  "ask": "Ціну на машину 3–5 т назве диспетчер", "err_addr": "Вкажіть обидві адреси зі списку підказок", "min2": "мін. 2 год", "fixed": "Ціна фіксується до виїзду",
  "h_from": "Почніть тут: звідки забрати?", "h_to": "Тепер — куди везти", "h_phone": "Залиште номер — і ця ціна ваша", "h_ready": "Усе готово, натисніть кнопку",
  "steps": ["Маршрут", "Ціна", "Телефон"], "nudge": "Ваша знижка −10% на перше замовлення чекає. Порахуйте ціну за 10 секунд", "nudge_btn": "Отримати знижку", "jump": "−10% · Порахувати ціну",
  "order_for": "Замовити за", "d_big": "−10%", "d_title": "на перше замовлення", "d_sub": "Знижка вже врахована в ціні на сайті", "d_row": "Знижка −10% (перше замовлення)", "d_strip": "Ваша знижка −10% на перше замовлення", "d_in": "вже в ціні", "d_save": "Ви економите", "trust": ["Ціна фіксується до виїзду", "Подача за 30–60 хвилин", "Розбирання й збирання меблів", "Оплата за фактичний пробіг"], "hook": "Краща ціна в Харкові ·", "from_word": "від", "per_h": "грн/год",
  "ex": ["вул. Сумська, 10", "просп. Науки, 45", "Салтівське шосе, 120", "просп. Героїв Харкова, 200", "Полтавський Шлях, 56"]},
 "ru": {"from": "Откуда", "to": "Куда", "from_ph": "Улица и дом, откуда забрать", "to_ph": "Куда везти", "loaders": "Грузчики", "none": "Без грузчиков",
  "km": "км", "min": "мин", "h": "ч", "approx": "Ориентировочная стоимость", "car": "Газель", "mileage": "Пробег за городом", "ldr": "Грузчики",
  "calc": "Считаем маршрут…", "nores": "Ничего не найдено. Попробуйте указать улицу и номер дома.", "noroute": "Не удалось построить маршрут. Диспетчер посчитает цену по телефону.",
  "ask": "Цену на машину 3–5 т назовёт диспетчер", "err_addr": "Укажите оба адреса из списка подсказок", "min2": "мин. 2 ч", "fixed": "Цена фиксируется до выезда",
  "h_from": "Начните здесь: откуда забрать?", "h_to": "Теперь — куда везти", "h_phone": "Оставьте номер — и эта цена ваша", "h_ready": "Всё готово, нажмите кнопку",
  "steps": ["Маршрут", "Цена", "Телефон"], "nudge": "Ваша скидка −10% на первый заказ ждёт. Посчитайте цену за 10 секунд", "nudge_btn": "Получить скидку", "jump": "−10% · Посчитать цену",
  "order_for": "Заказать за", "d_big": "−10%", "d_title": "на первый заказ", "d_sub": "Скидка уже учтена в цене на сайте", "d_row": "Скидка −10% (первый заказ)", "d_strip": "Ваша скидка −10% на первый заказ", "d_in": "уже в цене", "d_save": "Вы экономите", "trust": ["Цена фиксируется до выезда", "Подача за 30–60 минут", "Разборка и сборка мебели", "Оплата за фактический пробег"], "hook": "Лучшая цена в Харькове ·", "from_word": "от", "per_h": "грн/час",
  "ex": ["ул. Сумская, 10", "просп. Науки, 45", "Салтовское шоссе, 120", "просп. Героев Харькова, 200", "Полтавский Шлях, 56"]},
}
BEST = {
 "uk": {"eyebrow": "Чому в нас дешевше", "h": "Краща ціна на вантажне таксі в Харкові", "p": "Ми рахуємо чесно: фіксована ціна до виїзду, жодних доплат за затори чи очікування, а на перше замовлення ще й знижка.",
  "items": [["600", "грн/год", "Газель з водієм — мінімум 2 години"], ["−10%", "", "Знижка на перше замовлення"], ["0", "грн", "Накруток у дорозі — ціна фіксується до виїзду"], ["27", "грн/км", "За містом — лише фактичний пробіг"]], "cta": "Порахувати мою ціну"},
 "ru": {"eyebrow": "Почему у нас дешевле", "h": "Лучшая цена на грузовое такси в Харькове", "p": "Мы считаем честно: фиксированная цена до выезда, никаких доплат за пробки или ожидание, а на первый заказ ещё и скидка.",
  "items": [["600", "грн/час", "Газель с водителем — минимум 2 часа"], ["−10%", "", "Скидка на первый заказ"], ["0", "грн", "Накруток в дороге — цена фиксируется до выезда"], ["27", "грн/км", "За городом — только фактический пробег"]], "cta": "Посчитать мою цену"},
}
PRICE = {
 "uk": {"nav": "Ціни", "title": "Ціни на вантажне таксі у Харкові — Газель від 600 грн/год",
  "desc": "Ціни на вантажне таксі у Харкові: Газель від 600 грн/год, вантажники від 300 грн/год, мінімум 2 години. За містом від 27 грн/км. Калькулятор вартості.",
  "h1": "Ціни на вантажне таксі", "lead": "Ціна фіксується до виїзду й не змінюється в дорозі. Вкажіть адреси у формі, і ми одразу порахуємо вартість маршруту.",
  "h_cards": "Тарифи", "unit_h": "грн / год", "unit_km": "грн / км", "from": "від",
  "cards": [["Газель", "600", "h", ["Кузов 3,0 × 1,7 × 2,1 м", "Вантажопідйомність до 1,5 т", "Мінімальне замовлення — 2 години"]],
            ["За містом", "27", "km", ["Оплата за фактичний пробіг", "Фіксована ціна — без накруток у дорозі", "Область і вся Україна"]],
            ["Вантажники", "300", "h", ["Досвідчені й ввічливі", "Розбирання та збирання меблів", "Мінімальне замовлення — 2 години"]]],
  "calc_h": "Калькулятор вартості", "c_hours": "Годин роботи", "c_loaders": "Вантажників", "c_km": "Кілометрів за містом", "c_total": "Орієнтовно", "c_note": "Мінімум 2 години. Остаточну ціну диспетчер фіксує до виїзду.",
  "other_cars": "Машини на 3 і 5 тонн — ціну уточнюйте в диспетчера.",
  "faq": [["Як отримати знижку 10%?", "Знижка діє на перше замовлення й уже врахована в ціні, яку показує сайт. Диспетчер підтвердить її під час дзвінка."], ["Чому мінімальне замовлення 2 години?", "Дорога до вас і завантаження займають час навіть на маленькому замовленні. Два години вистачає на більшість малих переїздів по місту."], ["Чи зміниться ціна в дорозі?", "Ні. Ціну фіксуємо до виїзду, без накруток за затори чи очікування в дорозі."], ["Як рахується поїздка за місто?", "Час роботи в Харкові оплачується погодинно, а відстань за містом — від 27 грн за кожен фактичний кілометр."]]},
 "ru": {"nav": "Цены", "title": "Цены на грузовое такси в Харькове — Газель от 600 грн/час",
  "desc": "Цены на грузовое такси в Харькове: Газель от 600 грн/час, грузчики от 300 грн/час, минимум 2 часа. За городом от 27 грн/км. Калькулятор стоимости.",
  "h1": "Цены на грузовое такси", "lead": "Цена фиксируется до выезда и не меняется в дороге. Укажите адреса в форме, и мы сразу посчитаем стоимость маршрута.",
  "h_cards": "Тарифы", "unit_h": "грн / час", "unit_km": "грн / км", "from": "от",
  "cards": [["Газель", "600", "h", ["Кузов 3,0 × 1,7 × 2,1 м", "Грузоподъёмность до 1,5 т", "Минимальный заказ — 2 часа"]],
            ["За городом", "27", "km", ["Оплата за фактический пробег", "Фиксированная цена — без накруток в дороге", "Область и вся Украина"]],
            ["Грузчики", "300", "h", ["Опытные и вежливые", "Разборка и сборка мебели", "Минимальный заказ — 2 часа"]]],
  "calc_h": "Калькулятор стоимости", "c_hours": "Часов работы", "c_loaders": "Грузчиков", "c_km": "Километров за городом", "c_total": "Ориентировочно", "c_note": "Минимум 2 часа. Окончательную цену диспетчер фиксирует до выезда.",
  "other_cars": "Машины на 3 и 5 тонн — цену уточняйте у диспетчера.",
  "faq": [["Как получить скидку 10%?", "Скидка действует на первый заказ и уже учтена в цене, которую показывает сайт. Диспетчер подтвердит её во время звонка."], ["Почему минимальный заказ 2 часа?", "Дорога к вам и погрузка занимают время даже на маленьком заказе. Двух часов хватает на большинство малых переездов по городу."], ["Изменится ли цена в дороге?", "Нет. Цену фиксируем до выезда, без накруток за пробки или ожидание в дороге."], ["Как считается поездка за город?", "Время работы в Харькове оплачивается почасово, а расстояние за городом — от 27 грн за каждый фактический километр."]]},
}

# ====== НАСТРОЙКИ: замените на свои данные ======
CFG = {
    "domain": "https://gruzovoe-kharkiv.com.ua",   # ваш домен, без слэша в конце
    "phone": "+380 00 000 00 00",             # номер диспетчера, как показывать
    "phone_tel": "+380000000000",             # тот же номер без пробелов
    "telegram": "gruzovoe_kharkiv",        # username в Telegram без @
}
# ===============================================

MODE = sys.argv[1] if len(sys.argv) > 1 else "prod"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site_" + MODE)
esc = html.escape
LANGS = ["uk", "ru"]
SEG = {"svc": "poslugy", "dist": "rajony", "guide": "korysne"}

def path_of(lang, kind=None, slug=None):
    parts = [] if lang == "uk" else ["ru"]
    if kind == "price": parts += ["tsiny"]
    elif kind: parts += [SEG[kind], slug]
    return "/".join(parts)  # "" для главной uk

def file_of(p): return (p + "/index.html") if p else "index.html"

class Page:
    def __init__(self, p): self.p = p
    def href(self, target):
        if MODE == "prod": return "/" + (target + "/" if target else "")
        rel = os.path.relpath(file_of(target), os.path.dirname(file_of(self.p)) or ".")
        return rel
    def asset(self, name):
        if MODE == "prod": return "/" + name
        return os.path.relpath(name, os.path.dirname(file_of(self.p)) or ".")

def abs_url(p): return CFG["domain"] + "/" + (p + "/" if p else "")

ICONS = {
 "home": '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
 "office": '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>',
 "sofa": '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z"/><path d="M5 18v2M19 18v2"/>',
 "trash": '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
 "hands": '<path d="M3 17h4l3 2h6a2 2 0 0 0 0-4h-4"/><path d="M7 13l3-3a2 2 0 0 1 3 0l3 3"/><rect x="9" y="3" width="6" height="5" rx="1"/>',
 "road": '<path d="M8 3L4 21M16 3l4 18M12 5v2M12 11v2M12 17v2"/>',
 "truck": '<path d="M2 6h12v10H2zM14 9h4l4 4v3h-8z"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/>',
 "piano": '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 13h18M8 13v7M13 13v7M18 13v7"/>',
 "fridge": '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 9h14M8 5v2M8 12v3"/>',
 "bricks": '<path d="M3 7h18v5H3zM3 12h18v5H3zM9 7v5M15 12v5M7 17v0"/>',
 "tree": '<path d="M12 3l6 8h-3l4 6H5l4-6H6z"/><path d="M12 17v4"/>',
 "safe": '<rect x="3" y="3" width="18" height="16" rx="2"/><circle cx="12" cy="11" r="3.5"/><path d="M6 19v2M18 19v2M12 7.5v1"/>',
 "box": '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
 "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}
TRUCKS = [
 '<svg viewBox="0 0 64 36" aria-hidden="true"><path d="M6 10h30v16H6z" fill="var(--ink)"/><path d="M36 14h9l6 6v6H36z" fill="var(--ink)"/><path d="M39 16h5l4 4h-9z" fill="var(--surface)" opacity=".85"/><circle cx="14" cy="27" r="4" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"/><circle cx="43" cy="27" r="4" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"/></svg>',
 '<svg viewBox="0 0 64 36" aria-hidden="true"><path d="M3 6h36v20H3z" fill="var(--ink)"/><path d="M39 12h10l7 7v7H39z" fill="var(--ink)"/><path d="M42 14h6l5 5H42z" fill="var(--surface)" opacity=".85"/><circle cx="12" cy="27" r="4.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"/><circle cx="47" cy="27" r="4.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"/></svg>',
 '<svg viewBox="0 0 64 36" aria-hidden="true"><path d="M1 3h43v23H1z" fill="var(--ink)"/><path d="M44 10h10l8 8v8H44z" fill="var(--ink)"/><path d="M47 12h6l6 6H47z" fill="var(--surface)" opacity=".85"/><circle cx="9" cy="27" r="4.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"/><circle cx="20" cy="27" r="4.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"/><circle cx="53" cy="27" r="4.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"/></svg>',
]
TICKET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 15l6-6M9.5 9.5h0M14.5 14.5h0"/></svg>'
LOGO = '<span class="logo"><svg viewBox="3.6 2.6 16.8 18.4" aria-hidden="true"><path d="M12 3.6 19.4 7.3 12 11 4.6 7.3Z" fill="#fff"/><path d="M4.6 7.3 12 11v9L4.6 16.3Z" fill="#fff" fill-opacity=".78"/><path d="M19.4 7.3 12 11v9l7.4-3.7Z" fill="#fff" fill-opacity=".55"/><path d="M8.3 5.45 15.7 9.15v8.2" stroke="var(--deal1)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>'
PHONE_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>'
TG_IC = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.5 4.3L2.9 11.5c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.5zM9.6 14.4l8.6-7.6-6.9 8.5-.3 3.4z"/></svg>'
ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'

def jsonld(obj): return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False) + '</script>'

def business(lang):
    u = UI[lang]
    return {"@context": "https://schema.org", "@type": "MovingCompany", "name": u["brand"],
            "url": abs_url(path_of(lang)), "telephone": CFG["phone_tel"], "priceRange": "600–1500 ₴",
            "areaServed": {"@type": "City", "name": u["city"]},
            "address": {"@type": "PostalAddress", "addressLocality": u["city"], "addressCountry": "UA"},
            "openingHoursSpecification": {"@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], "opens": "00:00", "closes": "23:59"}}

def faq_ld(faq):
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}

def crumbs_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": abs_url(p)} for i, (n, p) in enumerate(items)]}

def head(pg, lang, title, desc, kind=None, slug=None, ld=()):
    alt = {l: path_of(l, kind, slug) for l in LANGS}
    title = title if "Gruzovoe-Kharkiv" in title else title + " | Gruzovoe-Kharkiv"
    tags = [f'<title>{esc(title)}</title>',
            f'<meta name="description" content="{esc(desc)}">',
            f'<link rel="canonical" href="{abs_url(alt[lang])}">']
    for l in LANGS: tags.append(f'<link rel="alternate" hreflang="{l}" href="{abs_url(alt[l])}">')
    tags.append(f'<link rel="alternate" hreflang="x-default" href="{abs_url(alt["uk"])}">')
    tags += [f'<meta property="og:type" content="website">', f'<meta property="og:title" content="{esc(title)}">',
             f'<meta property="og:description" content="{esc(desc)}">', f'<meta property="og:url" content="{abs_url(alt[lang])}">',
             f'<meta property="og:locale" content="{"uk_UA" if lang=="uk" else "ru_UA"}">',
             '<meta name="theme-color" content="#0c0d0e">',
             '<meta name="claude:viewport-fit-sides" content="cover">',
             '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
             '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap">',
             f'<link rel="stylesheet" href="{pg.asset("style.css")}">',
             f'<link rel="icon" href="{pg.asset("favicon.svg")}" type="image/svg+xml">']
    tags += [jsonld(x) for x in ld]
    return "\n".join(tags)

def header(pg, lang, kind=None, slug=None):
    u = UI[lang]
    other = {l: pg.href(path_of(l, kind, slug)) for l in LANGS}
    home = pg.href(path_of(lang))
    return f'''<header class="hdr"><div class="wrap">
<a class="brand" href="{home}" aria-label="Gruzovoe-Kharkiv">{LOGO}<span><span class="wm">Gruzovoe<em>-Kharkiv</em></span><small>{u["city"]} · {u["h24"]}</small></span></a>
<nav class="nav"><a href="{pg.href(path_of(lang,"price"))}">{PRICE[lang]["nav"]}</a><a href="{home}#poslugy">{u["services"]}</a><a href="{home}#rajony">{u["districts"]}</a><a href="{home}#korysne">{u["guides"]}</a></nav>
<div class="hdr-r"><div class="lang"><a href="{other["uk"]}" lang="uk" hreflang="uk"{' aria-current="page"' if lang=="uk" else ''}>UA</a><a href="{other["ru"]}" lang="ru" hreflang="ru"{' aria-current="page"' if lang=="ru" else ''}>RU</a></div>
<a class="tel" href="tel:{CFG["phone_tel"]}">{PHONE_IC}{CFG["phone"]}</a></div>
</div></header>'''

def order_form(lang, page_name):
    u = UI[lang]
    rides = "".join(f'''<label class="ride"><input type="radio" name="vehicle" value="{esc(c[0])} {esc(c[1])}"{" checked" if i==0 else ""}>{TRUCKS[i]}<span><b>{c[0]}</b><small>{c[2]}</small></span><span class="cap">{c[1].replace(" · ","<br>")}</span></label>''' for i, c in enumerate(u["cars"]))
    fail = u["fail"] + " " + CFG["phone"]
    R = ROUTE[lang]
    i18n = esc(json.dumps(R, ensure_ascii=False))
    return f'''<div class="order" data-i18n="{i18n}">
<form id="order" name="order" method="POST" data-netlify="true" netlify-honeypot="company" novalidate
 data-err-phone="{esc(u["err_phone"])}" data-ok-h="{esc(u["ok_h"])}" data-ok-p="{esc(u["ok_p"])}" data-again="{esc(u["again"])}" data-s1="{esc(u["s1"])}" data-fail="{esc(fail)}" style="display:grid;gap:16px">
<input type="hidden" name="form-name" value="order"><input type="hidden" name="page" value="{esc(page_name)}"><input type="hidden" name="lang" value="{lang}">
<p hidden><label>company <input name="company"></label></p>
<div class="oh"><h2>{u["order_h"]}</h2><span class="dstrip">{TICKET}{R["d_big"]}</span></div>
<ol class="prog" aria-hidden="true">{"".join(f'<li><i></i>{x}</li>' for x in R["steps"])}</ol>
<p class="hint" aria-live="polite">{R["h_from"]}</p>
<div class="route">
<div class="addr"><i class="a"></i><label class="sr" for="from">{R["from"]}</label><input id="from" name="from" type="text" autocomplete="off" placeholder="{R["from_ph"]}" required><ul class="sug" role="listbox" hidden></ul></div>
<div class="addr"><i class="b"></i><label class="sr" for="to">{R["to"]}</label><input id="to" name="to" type="text" autocomplete="off" placeholder="{R["to_ph"]}" required><ul class="sug" role="listbox" hidden></ul></div>
</div>
<div class="est" id="est" hidden></div>
<input type="hidden" name="route" id="routeInfo"><input type="hidden" name="price_estimate" id="priceInfo"><input type="hidden" name="discount" id="discInfo">
<input type="hidden" name="vehicle" value="Газель 1,5 т">
<div class="opt"><span>{R["loaders"]}</span><div class="step"><button type="button" data-d="-1" aria-label="−">−</button><output id="ldrOut">0</output><button type="button" data-d="1" aria-label="+">+</button></div><input type="hidden" name="loaders" id="ldr" value="0"></div>
<div style="display:grid;gap:8px"><label class="lbl" for="phone">{u["phone_l"]}</label>
<div class="field"><span class="cc"><i></i>+380</span><input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="67 123 45 67" maxlength="12" required></div></div>
<p class="err" hidden></p>
<button class="cta" type="submit"><span class="cl" data-def="{esc(u["submit"])}">{u["submit"]}</span> {ARROW}</button>
<p class="note">{u["note"]}</p>
</form></div>'''

def footer(pg, lang):
    u = UI[lang]
    s = "".join(f'<a href="{pg.href(path_of(lang,"svc",x["slug"]))}">{x[lang]["nav"]}</a>' for x in SERVICES)
    d = "".join(f'<a href="{pg.href(path_of(lang,"dist",x["slug"]))}">{x[lang]["nav"]}</a>' for x in DISTRICTS)
    g = "".join(f'<a href="{pg.href(path_of(lang,"guide",x["slug"]))}">{x[lang]["nav"]}</a>' for x in GUIDES)
    return f'''<footer class="ftr"><div class="wrap">
<div style="display:grid;gap:12px;align-content:start"><a class="brand" href="{pg.href(path_of(lang))}">{LOGO}<span><span class="wm">Gruzovoe<em>-Kharkiv</em></span><small>{u["city"]}</small></span></a>
<p class="muted">{u["foot"]}</p><p><a href="tel:{CFG["phone_tel"]}" style="font-weight:700;text-decoration:none">{CFG["phone"]}</a><br><a href="https://t.me/{CFG["telegram"]}" class="muted">Telegram</a></p></div>
<nav><b>{u["services"]}</b><a href="{pg.href(path_of(lang,"price"))}">{PRICE[lang]["nav"]}</a>{s}</nav><nav><b>{u["districts"]}</b>{d}</nav><nav><b>{u["guides"]}</b>{g}</nav>
</div></footer>
<div class="mbar"><a class="p" href="tel:{CFG["phone_tel"]}">{PHONE_IC}{u["call"]}</a><a class="t" href="https://t.me/{CFG["telegram"]}">{TG_IC}Telegram</a></div>'''

def faq_html(lang, faq):
    items = "".join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in faq)
    return f'<section class="sec"><div class="wrap"><div class="sec-h"><h2>{UI[lang]["faq_h"]}</h2></div><div class="faq">{items}</div></div></section>'

def doc(pg, lang, headtags, body):
    attrs = ' data-preview="1"' if MODE == "preview" else ''
    page = f'''{headtags}
{body}
<script src="{pg.asset("main.js")}" defer></script>'''
    if MODE == "preview" and pg.p == "":
        # главная страница превью: без собственной обёртки, её добавляет хостинг артефакта
        return page + '\n<script>document.body.dataset.preview="1"</script>'
    return f'''<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
{headtags}
</head><body{attrs}>
{body}
<script src="{pg.asset("main.js")}" defer></script>
</body></html>'''

def best_price(lang):
    B = BEST[lang]
    items = "".join(f'<li><span class="bn"><b>{esc(a)}</b>{(" <small>" + esc(b) + "</small>") if b else ""}</span><span class="bt">{esc(c)}</span></li>' for a, b, c in B["items"])
    return f'''<section class="best"><div class="wrap"><div class="best-h"><span class="eyebrow">{B["eyebrow"]}</span><h2>{B["h"]}</h2><p>{B["p"]}</p>
<a class="best-cta" href="#order" data-focus="from">{B["cta"]} <span aria-hidden="true">→</span></a></div><ul class="best-list">{items}</ul></div></section>'''

def coupon(lang, cls=""):
    R = ROUTE[lang]
    return f'''<div class="coupon {cls}"><div class="cp-l"><b>{R["d_big"]}</b></div><div class="cp-r"><strong>{R["d_title"]}</strong><span>{R["d_sub"]}</span></div><i class="shine" aria-hidden="true"></i></div>'''

def hero(lang, h1, lead, crumbs_html, page_name, map_on=True):
    u = UI[lang]; R = ROUTE[lang]
    trust = "".join(f'<li>{esc(x)}</li>' for x in R["trust"])
    return f'''<section class="hero">{'<canvas id="map" aria-hidden="true"></canvas>' if map_on else ''}<div class="wrap">
<div class="hero-txt">{crumbs_html}
<div class="offer"><span class="chip"><i></i>{u["all247"]}</span><span class="tag">{R["hook"]} <b>{R["from_word"]} 600</b> {R["per_h"]}</span></div>
<h1>{esc(h1)}</h1><p class="lead">{esc(lead)}</p>
{coupon(lang)}
<ul class="trust">{trust}</ul></div>
{order_form(lang, page_name)}
</div></section>'''

def svc_cards(pg, lang, exclude=None, items=None):
    out = []
    for s in (items or SERVICES):
        if s["slug"] == exclude: continue
        t = s[lang]
        out.append(f'<a class="svc" href="{pg.href(path_of(lang,"svc",s["slug"]))}"><span class="ic"><svg viewBox="0 0 24 24">{ICONS[s["icon"]]}</svg></span><h3>{t["nav"]}</h3><p>{esc(t["lead"])}</p><span class="go">{UI[lang]["more"]} <span>→</span></span></a>')
    return out[0] + '<div class="grid3">' + "".join(out[1:]) + '</div>'

def dist_links(pg, lang):
    return '<div class="dlist">' + "".join(f'<a href="{pg.href(path_of(lang,"dist",d["slug"]))}">{d[lang]["nav"]}</a>' for d in DISTRICTS) + '</div>'

def build_home(lang):
    p = path_of(lang); pg = Page(p); u = UI[lang]; h = HOME[lang]
    ld = [business(lang), faq_ld(h["faq"])]
    cars = "".join(f'<div class="car">{TRUCKS[i]}<h3>{c[0]}</h3><span class="cap">{c[1]}</span><p class="muted">{c[2]}</p></div>' for i, c in enumerate(u["cars"]))
    steps = "".join(f'<li><h3>{a}</h3><p class="muted">{b}</p></li>' for a, b in u["how"])
    body = header(pg, lang) + "<main>" + hero(lang, h["h1"], h["lead"], "", "home") + best_price(lang) + f'''
<section class="sec" id="poslugy"><div class="wrap"><div class="sec-h"><h2>{u["svc_h"]}</h2></div>{svc_cards(pg, lang, items=CORE_SERVICES)}{svc_mini(pg, lang)}</div></section>
<section class="sec" id="tsiny"><div class="wrap"><div class="sec-h"><h2>{PRICE[lang]["h1"]}</h2><p class="muted">{PRICE[lang]["lead"]}</p></div>{price_cards(lang)}</div></section>
<section class="sec"><div class="wrap"><div class="sec-h"><h2>{u["how_h"]}</h2></div><ol class="steps">{steps}</ol></div></section>
<section class="sec" id="rajony"><div class="wrap"><div class="sec-h"><h2>{u["dist_h"]}</h2></div>{dist_links(pg, lang)}</div></section>
<section class="sec" id="korysne"><div class="wrap"><div class="sec-h"><h2>{u["guides_h"]}</h2></div>{guide_cards(pg, lang)}</div></section>
{faq_html(lang, h["faq"])}</main>''' + footer(pg, lang)
    return p, doc(pg, lang, head(pg, lang, h["title"], h["desc"], ld=ld), body)

def price_cards(lang):
    P = PRICE[lang]; out = [coupon(lang, "wide")]
    for name, num, unit, pts in P["cards"]:
        u_ = P["unit_h"] if unit == "h" else P["unit_km"]
        li = "".join(f"<li>{esc(x)}</li>" for x in pts)
        out.append(f'<div class="price"><h3>{name}</h3><p class="amt"><small>{P["from"]}</small> <b>{num}</b> <span>{u_}</span></p><ul class="ticks">{li}</ul></div>')
    return out[0] + '<div class="grid3">' + "".join(out[1:]) + '</div>'

def calc_html(lang):
    P = PRICE[lang]
    return f'''<div class="calc" id="calc" data-unit="{P["unit_h"].split()[0]}">
<div class="calc-in">
<label class="crow"><span>{P["c_hours"]}<output id="oh">2</output></span><input id="ch" type="range" min="2" max="10" step="1" value="2"></label>
<label class="crow"><span>{P["c_loaders"]}<output id="ol">2</output></span><input id="cl" type="range" min="0" max="6" step="1" value="2"></label>
<label class="crow"><span>{P["c_km"]}<output id="ok">0</output></span><input id="ck" type="range" min="0" max="500" step="10" value="0"></label>
</div>
<div class="calc-out"><span class="lbl">{P["c_total"]}</span><b id="ctotal">2 400</b><span class="cur">грн</span><p class="muted" style="font-size:13px">{P["c_note"]}</p></div>
</div>'''

def build_price(lang):
    p = path_of(lang, "price"); pg = Page(p); u = UI[lang]; t = PRICE[lang]; home = path_of(lang)
    crumbs = f'<nav class="crumbs" aria-label="breadcrumbs"><a href="{pg.href(home)}">{u["home"]}</a><span>/</span><span>{t["nav"]}</span></nav>'
    offers = {"@context": "https://schema.org", "@type": "Service", "serviceType": t["h1"], "provider": business(lang), "areaServed": u["city"],
              "offers": [{"@type": "Offer", "name": n, "priceCurrency": "UAH", "priceSpecification": {"@type": "UnitPriceSpecification", "price": int(num), "priceCurrency": "UAH", "unitCode": "HUR" if unit == "h" else "KMT"}} for n, num, unit, _ in t["cards"]]}
    ld = [offers, faq_ld(t["faq"]), crumbs_ld([(u["home"], home), (t["nav"], p)])]
    body = header(pg, lang, "price") + "<main>" + hero(lang, t["h1"], t["lead"], crumbs, t["nav"]) + best_price(lang) + f'''
<section class="sec"><div class="wrap"><div class="sec-h"><h2>{t["h_cards"]}</h2></div>{price_cards(lang)}</div></section>
<section class="sec"><div class="wrap"><div class="sec-h"><h2>{u["svc_h"]}</h2></div>{svc_cards(pg, lang, items=CORE_SERVICES)}</div></section>
{faq_html(lang, t["faq"])}</main>''' + footer(pg, lang)
    return p, doc(pg, lang, head(pg, lang, t["title"], t["desc"], "price", None, ld), body)

def svc_mini(pg, lang):
    out = "".join(f'<a class="mini" href="{pg.href(path_of(lang,"svc",x["slug"]))}"><span class="ic"><svg viewBox="0 0 24 24">{ICONS[x["icon"]]}</svg></span><span>{x[lang]["nav"]}</span></a>' for x in SERVICES_EXTRA)
    return f'<div class="grid4">{out}</div>'

def guide_cards(pg, lang, exclude=None):
    out = []
    for g in GUIDES:
        if g["slug"] == exclude: continue
        t = g[lang]
        out.append(f'<a class="svc" href="{pg.href(path_of(lang,"guide",g["slug"]))}"><h3>{t["nav"]}</h3><p>{esc(t["lead"])}</p><span class="go">{UI[lang]["read"]} <span>→</span></span></a>')
    return out[0] + '<div class="grid3">' + "".join(out[1:]) + '</div>'

def table_html(rows):
    head_ = "".join(f"<th>{esc(c)}</th>" for c in rows[0])
    body_ = "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>" for r in rows[1:])
    return f'<div class="tbl"><table><thead><tr>{head_}</tr></thead><tbody>{body_}</tbody></table></div>'

def build_guide(lang, item):
    p = path_of(lang, "guide", item["slug"]); pg = Page(p); u = UI[lang]; t = item[lang]
    home = path_of(lang)
    crumbs = f'<nav class="crumbs" aria-label="breadcrumbs"><a href="{pg.href(home)}">{u["home"]}</a><span>/</span><a href="{pg.href(home)}#korysne">{u["guides"]}</a></nav>'
    art = {"@context": "https://schema.org", "@type": "Article", "headline": t["h1"], "description": t["desc"], "inLanguage": lang,
           "mainEntityOfPage": abs_url(p), "publisher": {"@type": "Organization", "name": u["brand"]}}
    ld = [art, faq_ld(t["faq"]), crumbs_ld([(u["home"], home), (t["nav"], p)])]
    prose = table_html(t["table"]) if "table" in t else ""
    for h2, items in t["sections"]:
        prose += f'<h2>{esc(h2)}</h2><ul class="ticks">' + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ul>"
    side = "".join(f'<a href="{pg.href(path_of(lang,"svc",x["slug"]))}">{x[lang]["nav"]}</a>' for x in CORE_SERVICES)
    body = header(pg, lang, "guide", item["slug"]) + "<main>" + hero(lang, t["h1"], t["lead"], crumbs, t["nav"]) + f'''
<section class="sec"><div class="wrap art"><div class="prose">{prose}</div>
<aside class="side"><div class="links"><b>{u["services"]}</b>{side}</div></aside></div></section>
<section class="sec"><div class="wrap"><div class="sec-h"><h2>{u["guides"]}</h2></div>{guide_cards(pg, lang, exclude=item["slug"])}</div></section>
{faq_html(lang, t["faq"])}</main>''' + footer(pg, lang)
    return p, doc(pg, lang, head(pg, lang, t["title"], t["desc"], "guide", item["slug"], ld), body)

def side_price(pg, lang):
    P = PRICE[lang]
    return f'<a class="sprice" href="{pg.href(path_of(lang,"price"))}"><span class="lbl">{P["nav"]}</span><span><b>{P["from"]} 600</b> {P["unit_h"]} · Газель</span><span><b>{P["from"]} 300</b> {P["unit_h"]} · {P["cards"][2][0]}</span><span class="muted">{P["cards"][0][3][2]}</span></a>'

def build_inner(lang, kind, item):
    p = path_of(lang, kind, item["slug"]); pg = Page(p); u = UI[lang]; t = item[lang]
    sect = u["services"] if kind == "svc" else u["districts"]
    anchor = "#poslugy" if kind == "svc" else "#rajony"
    home = path_of(lang)
    crumbs = f'<nav class="crumbs" aria-label="breadcrumbs"><a href="{pg.href(home)}">{u["home"]}</a><span>/</span><a href="{pg.href(home)}{anchor}">{sect}</a></nav>'
    ld = [business(lang), faq_ld(t["faq"]), crumbs_ld([(u["home"], home), (t["nav"], p)])]
    prose = ""
    if kind == "svc":
        prose += f'<h2>{u["incl"]}</h2><ul class="ticks">' + "".join(f"<li>{esc(x)}</li>" for x in t["points"]) + "</ul>"
    prose += "".join(f"<p>{esc(x)}</p>" for x in t["body"])
    if kind == "dist":
        prose += f'<h2>{u["in_district"]}</h2>' + svc_cards(pg, lang, items=CORE_SERVICES)
    side_items = (SERVICES if kind == "svc" else DISTRICTS)
    seg = "svc" if kind == "svc" else "dist"
    side = "".join(f'<a href="{pg.href(path_of(lang,seg,x["slug"]))}">{x[lang]["nav"]}</a>' for x in side_items if x["slug"] != item["slug"])
    side_title = u["other_svc"] if kind == "svc" else u["districts"]
    body = header(pg, lang, kind, item["slug"]) + "<main>" + hero(lang, t["h1"], t["lead"], crumbs, t["nav"]) + f'''
<section class="sec"><div class="wrap art"><div class="prose">{prose}</div>
<aside class="side">{side_price(pg, lang)}<div class="links"><b>{side_title}</b>{side}</div></aside></div></section>
{faq_html(lang, t["faq"])}</main>''' + footer(pg, lang)
    return p, doc(pg, lang, head(pg, lang, t["title"], t["desc"], kind, item["slug"], ld), body)

def write(rel, text):
    fp = os.path.join(OUT, rel); os.makedirs(os.path.dirname(fp) or OUT, exist_ok=True)
    with open(fp, "w", encoding="utf-8") as f: f.write(text)

def main():
    if os.path.exists(OUT): shutil.rmtree(OUT)
    os.makedirs(OUT)
    urls = []
    for lang in LANGS:
        pages = [build_home(lang)] + [build_inner(lang, "svc", s) for s in SERVICES] + [build_inner(lang, "dist", d) for d in DISTRICTS] + [build_guide(lang, g) for g in GUIDES] + [build_price(lang)]
        for p, text in pages:
            write(file_of(p), text); urls.append(p)
    src = os.path.dirname(os.path.abspath(__file__))
    for f in ["style.css", "main.js"]: shutil.copy(os.path.join(src, f), os.path.join(OUT, f))
    write("favicon.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0c0d0e"/><g transform="translate(12 12) scale(1.15) translate(-12 -11.8)"><path d="M12 3.6 19.4 7.3 12 11 4.6 7.3Z" fill="#fff"/><path d="M4.6 7.3 12 11v9L4.6 16.3Z" fill="#fff" fill-opacity=".78"/><path d="M19.4 7.3 12 11v9l7.4-3.7Z" fill="#fff" fill-opacity=".55"/><path d="M8.3 5.45 15.7 9.15v8.2" stroke="#05a357" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g></svg>')
    if MODE == "prod":
        sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
        for p in urls:
            base = p[3:] if p.startswith("ru") else p
            base = base.lstrip("/")
            sm.append(f"<url><loc>{abs_url(p)}</loc>" + "".join(
                f'<xhtml:link rel="alternate" hreflang="{l}" href="{abs_url(("ru/" + base).rstrip("/") if l=="ru" else base)}"/>' for l in LANGS) + "</url>")
        sm.append("</urlset>")
        write("sitemap.xml", "\n".join(sm))
        write("robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {CFG['domain']}/sitemap.xml\n")
        write("404.html", f'<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сторінку не знайдено</title><link rel="stylesheet" href="/style.css"></head><body><main class="wrap sec" style="display:grid;gap:16px"><h1>404</h1><p>Сторінку не знайдено. <a href="/">На головну</a></p><p><a class="tel" href="tel:{CFG["phone_tel"]}">{CFG["phone"]}</a></p></main></body></html>')
    print(MODE, len(urls), "pages ->", os.path.abspath(OUT))

main()
