// Город и список автосервисов. Чтобы запустить приложение в своём городе,
// поменяйте CITY и замените PLACES на реальные мойки, шиномонтажи и СТО.
// Сейчас здесь демо-данные: названия, адреса и телефоны вымышлены.

export const CITY = {
  name: 'Ваш город',
  // Поиск в Яндекс Картах: к адресу точки добавляется название города.
  mapsSearch: 'https://yandex.ru/maps/?text=',
};

export const CATEGORIES = [
  { id: 'wash', name: 'Мойка', icon: '🫧' },
  { id: 'tires', name: 'Шиномонтаж', icon: '🛞' },
  { id: 'service', name: 'СТО', icon: '🔧' },
];

// Цена зависит от класса машины: [легковая, кроссовер, внедорожник/минивэн].
export const CAR_CLASSES = ['Легковая', 'Кроссовер', 'Внедорожник / минивэн'];

const WASH = {
  express: { name: 'Экспресс-мойка кузова', min: 20, price: [500, 600, 700] },
  complex: { name: 'Комплекс: кузов + салон', min: 60, price: [1300, 1600, 1900] },
  inside: { name: 'Уборка салона пылесосом', min: 25, price: [400, 500, 600] },
  wax: { name: 'Воск и полировка', min: 40, price: [900, 1100, 1300] },
  engine: { name: 'Мойка двигателя', min: 30, price: [800, 900, 1000] },
  dry: { name: 'Химчистка салона', min: 240, price: [7000, 8500, 10000] },
};

const TIRES = {
  change: { name: 'Сезонная переобувка (4 колеса)', min: 50, price: [2400, 2800, 3400] },
  balance: { name: 'Балансировка (4 колеса)', min: 30, price: [1000, 1200, 1500] },
  repair: { name: 'Ремонт прокола', min: 20, price: [500, 500, 600] },
  storage: { name: 'Хранение шин (сезон)', min: 10, price: [3000, 3500, 4000] },
  rolling: { name: 'Правка литого диска', min: 60, price: [1500, 1800, 2200] },
};

const SERVICE = {
  diag: { name: 'Компьютерная диагностика', min: 30, price: [1000, 1200, 1400] },
  oil: { name: 'Замена масла и фильтра', min: 40, price: [900, 1100, 1300] },
  brakes: { name: 'Замена тормозных колодок (ось)', min: 60, price: [1500, 1800, 2200] },
  align: { name: 'Развал-схождение', min: 45, price: [1800, 2000, 2500] },
  ac: { name: 'Заправка кондиционера', min: 40, price: [2000, 2200, 2500] },
  suspension: { name: 'Диагностика подвески', min: 30, price: [600, 700, 800] },
  battery: { name: 'Замена аккумулятора', min: 20, price: [500, 500, 600] },
};

const pick = (catalog, ids, k = 1) =>
  ids.map((id) => ({ id, ...catalog[id], price: catalog[id].price.map((p) => Math.round((p * k) / 50) * 50) }));

// hours: [открытие, закрытие] в часах; null — круглосуточно.
export const PLACES = [
  {
    id: 'blesk',
    name: 'Автомойка «Блеск»',
    cats: ['wash'],
    address: 'ул. Ленина, 45',
    district: 'Центр',
    phone: '+7 900 000-00-01',
    hours: [8, 22],
    rating: 4.8,
    reviews: 312,
    boxes: 4,
    tags: ['Кофе в зоне ожидания', 'Оплата картой'],
    services: pick(WASH, ['express', 'complex', 'inside', 'wax', 'engine', 'dry']),
  },
  {
    id: 'aqua24',
    name: 'Аква 24',
    cats: ['wash'],
    address: 'пр. Победы, 120',
    district: 'Северный',
    phone: '+7 900 000-00-02',
    hours: null,
    rating: 4.5,
    reviews: 189,
    boxes: 6,
    tags: ['Круглосуточно', 'Самообслуживание'],
    services: pick(WASH, ['express', 'complex', 'inside', 'engine'], 0.9),
  },
  {
    id: 'koleso',
    name: 'Шиномонтаж «Колесо»',
    cats: ['tires'],
    address: 'ул. Гагарина, 8',
    district: 'Заречный',
    phone: '+7 900 000-00-03',
    hours: [9, 21],
    rating: 4.7,
    reviews: 421,
    boxes: 3,
    tags: ['Хранение шин', 'Шины в наличии'],
    services: pick(TIRES, ['change', 'balance', 'repair', 'storage', 'rolling']),
  },
  {
    id: 'shinservis',
    name: 'ШинСервис',
    cats: ['tires', 'service'],
    address: 'Объездная дорога, 3',
    district: 'Промзона',
    phone: '+7 900 000-00-04',
    hours: [8, 20],
    rating: 4.4,
    reviews: 97,
    boxes: 2,
    tags: ['Грузовые шины', 'Развал-схождение 3D'],
    services: [...pick(TIRES, ['change', 'balance', 'repair'], 0.9), ...pick(SERVICE, ['align', 'suspension'])],
  },
  {
    id: 'motor',
    name: 'СТО «Мотор»',
    cats: ['service'],
    address: 'ул. Мира, 77',
    district: 'Южный',
    phone: '+7 900 000-00-05',
    hours: [9, 19],
    rating: 4.9,
    reviews: 256,
    boxes: 5,
    tags: ['Гарантия 1 год', 'Свои запчасти можно'],
    services: pick(SERVICE, ['diag', 'oil', 'brakes', 'align', 'ac', 'suspension', 'battery']),
  },
  {
    id: 'autodoc',
    name: 'Автодоктор',
    cats: ['service', 'tires'],
    address: 'ул. Садовая, 14',
    district: 'Центр',
    phone: '+7 900 000-00-06',
    hours: [8, 21],
    rating: 4.6,
    reviews: 143,
    boxes: 3,
    tags: ['Эвакуатор', 'Ожидание в кафе'],
    services: [...pick(SERVICE, ['diag', 'oil', 'brakes', 'battery'], 1.1), ...pick(TIRES, ['change', 'balance'], 1.05)],
  },
  {
    id: 'chisto',
    name: 'Чисто & Быстро',
    cats: ['wash', 'tires'],
    address: 'ул. Строителей, 31',
    district: 'Северный',
    phone: '+7 900 000-00-07',
    hours: [7, 23],
    rating: 4.3,
    reviews: 74,
    boxes: 3,
    tags: ['Мойка + переобувка за раз', 'Wi‑Fi'],
    services: [...pick(WASH, ['express', 'complex', 'inside'], 0.85), ...pick(TIRES, ['change', 'balance', 'repair'], 0.95)],
  },
];
