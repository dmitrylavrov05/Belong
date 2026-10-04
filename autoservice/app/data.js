// Місто та список автосервісів. Щоб додати реальні мийки, шиномонтажі й СТО,
// замініть PLACES на справжні точки.
// Зараз тут демо-дані: назви, номери будинків і телефони вигадані.

export const CITY = {
  name: 'Київ',
  // Маршрут у Google Maps: до адреси точки додається назва міста.
  mapsSearch: 'https://www.google.com/maps/search/?api=1&query=',
};

export const CATEGORIES = [
  { id: 'wash', name: 'Мийка', icon: '🫧' },
  { id: 'tires', name: 'Шиномонтаж', icon: '🛞' },
  { id: 'service', name: 'СТО', icon: '🔧' },
];

// Ціна залежить від класу авто: [легкове, кросовер, позашляховик/мінівен], у гривнях.
export const CAR_CLASSES = ['Легкове', 'Кросовер', 'Позашляховик / мінівен'];

const WASH = {
  express: { name: 'Експрес-мийка кузова', min: 20, price: [250, 300, 350] },
  complex: { name: 'Комплекс: кузов + салон', min: 60, price: [550, 650, 750] },
  inside: { name: 'Прибирання салону пилососом', min: 25, price: [200, 250, 300] },
  wax: { name: 'Віск і полірування', min: 40, price: [400, 500, 600] },
  engine: { name: 'Мийка двигуна', min: 30, price: [400, 450, 500] },
  dry: { name: 'Хімчистка салону', min: 240, price: [3500, 4200, 5000] },
};

const TIRES = {
  change: { name: 'Сезонне перевзування (4 колеса)', min: 50, price: [900, 1100, 1400] },
  balance: { name: 'Балансування (4 колеса)', min: 30, price: [400, 500, 600] },
  repair: { name: 'Ремонт проколу', min: 20, price: [200, 200, 250] },
  storage: { name: 'Зберігання шин (сезон)', min: 10, price: [1200, 1400, 1600] },
  rolling: { name: 'Рихтування литого диска', min: 60, price: [600, 700, 900] },
};

const SERVICE = {
  diag: { name: 'Компʼютерна діагностика', min: 30, price: [500, 600, 700] },
  oil: { name: 'Заміна оливи та фільтра', min: 40, price: [400, 500, 600] },
  brakes: { name: 'Заміна гальмівних колодок (вісь)', min: 60, price: [600, 700, 900] },
  align: { name: 'Розвал-сходження', min: 45, price: [700, 800, 1000] },
  ac: { name: 'Заправка кондиціонера', min: 40, price: [900, 1000, 1200] },
  suspension: { name: 'Діагностика підвіски', min: 30, price: [300, 350, 400] },
  battery: { name: 'Заміна акумулятора', min: 20, price: [150, 150, 200] },
};

const pick = (catalog, ids, k = 1) =>
  ids.map((id) => ({ id, ...catalog[id], price: catalog[id].price.map((p) => Math.round((p * k) / 10) * 10) }));

// hours: [відкриття, закриття] у годинах; null — цілодобово.
export const PLACES = [
  {
    id: 'blysk',
    name: 'Автомийка «Блиск»',
    cats: ['wash'],
    address: 'вул. Велика Васильківська, 45',
    district: 'Печерський',
    phone: '+380 44 000 00 01',
    hours: [8, 22],
    rating: 4.8,
    reviews: 312,
    boxes: 4,
    tags: ['Кава в зоні очікування', 'Генератор: працює під час відключень'],
    services: pick(WASH, ['express', 'complex', 'inside', 'wax', 'engine', 'dry']),
  },
  {
    id: 'aqua24',
    name: 'Аква 24',
    cats: ['wash'],
    address: 'просп. Степана Бандери, 20',
    district: 'Оболонський',
    phone: '+380 44 000 00 02',
    hours: null,
    rating: 4.5,
    reviews: 189,
    boxes: 6,
    tags: ['Цілодобово', 'Самообслуговування'],
    services: pick(WASH, ['express', 'complex', 'inside', 'engine'], 0.9),
  },
  {
    id: 'koleso',
    name: 'Шиномонтаж «Колесо»',
    cats: ['tires'],
    address: 'Харківське шосе, 58',
    district: 'Дарницький',
    phone: '+380 44 000 00 03',
    hours: [9, 21],
    rating: 4.7,
    reviews: 421,
    boxes: 3,
    tags: ['Зберігання шин', 'Шини в наявності'],
    services: pick(TIRES, ['change', 'balance', 'repair', 'storage', 'rolling']),
  },
  {
    id: 'shynservis',
    name: 'ШинСервіс',
    cats: ['tires', 'service'],
    address: 'просп. Берестейський, 120',
    district: 'Святошинський',
    phone: '+380 44 000 00 04',
    hours: [8, 20],
    rating: 4.4,
    reviews: 97,
    boxes: 2,
    tags: ['Вантажні шини', 'Розвал-сходження 3D'],
    services: [...pick(TIRES, ['change', 'balance', 'repair'], 0.9), ...pick(SERVICE, ['align', 'suspension'])],
  },
  {
    id: 'motor',
    name: 'СТО «Мотор»',
    cats: ['service'],
    address: 'вул. Кирилівська, 77',
    district: 'Подільський',
    phone: '+380 44 000 00 05',
    hours: [9, 19],
    rating: 4.9,
    reviews: 256,
    boxes: 5,
    tags: ['Гарантія 1 рік', 'Можна свої запчастини'],
    services: pick(SERVICE, ['diag', 'oil', 'brakes', 'align', 'ac', 'suspension', 'battery']),
  },
  {
    id: 'avtodoktor',
    name: 'Автодоктор',
    cats: ['service', 'tires'],
    address: 'просп. Валерія Лобановського, 14',
    district: 'Солом’янський',
    phone: '+380 44 000 00 06',
    hours: [8, 21],
    rating: 4.6,
    reviews: 143,
    boxes: 3,
    tags: ['Евакуатор', 'Генератор: працює під час відключень'],
    services: [...pick(SERVICE, ['diag', 'oil', 'brakes', 'battery'], 1.1), ...pick(TIRES, ['change', 'balance'], 1.05)],
  },
  {
    id: 'chysto',
    name: 'Чисто і швидко',
    cats: ['wash', 'tires'],
    address: 'просп. Червоної Калини, 31',
    district: 'Деснянський',
    phone: '+380 44 000 00 07',
    hours: [7, 23],
    rating: 4.3,
    reviews: 74,
    boxes: 3,
    tags: ['Мийка + перевзування за раз', 'Wi‑Fi'],
    services: [...pick(WASH, ['express', 'complex', 'inside'], 0.85), ...pick(TIRES, ['change', 'balance', 'repair'], 0.95)],
  },
];

// Правила оплати («як на FunPay»): клієнт не платить комісію, гроші утримуються
// до виконання роботи, а комісія з точки утримується під час виведення коштів.
export const PAYMENT = {
  commission: 0.07, // частка, яку платформа утримує з точки під час виведення
  autoReleaseHours: 24, // якщо клієнт мовчить після «Виконано», гроші йдуть точці
  freeCancelHours: 2, // безкоштовне скасування не пізніше ніж за N годин
  lateCancelShare: 0.5, // частка точці при пізньому скасуванні
  noShowShare: 0.5, // частка точці, якщо клієнт не приїхав
};

// Нагадування сервісної книжки.
export const MAINTENANCE = {
  oilKm: 10000, // заміна оливи кожні N км
  oilMonths: 12, // або раз на N місяців
  oilWarnKm: 1000, // попереджати, коли до заміни лишилося менше
  insuranceWarnDays: 30, // попереджати про кінець поліса за N днів
};
