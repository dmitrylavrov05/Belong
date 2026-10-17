// Перевірка авто за держномером: формат номера, регіон реєстрації й дані з реєстру.
// На сервері CARCAR — дані МВС: онлайн-сервіс перевірки номерів (baza-gai.com.ua за ключем API) або власна копія
// відкритого реєстру (deploy/server/vehicles_import.py). Без сервера — кілька вигаданих демо-номерів.

// Кириличні літери, що пишуться так само, як латинські (на номерах використовують лише їх).
const VEH_LOOKALIKE = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X' };
export const normPlate = (s) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/[АВСЕНІКМОРТХ]/g, (c) => VEH_LOOKALIKE[c]);
export const plateValid = (p) => /^[A-Z]{2}\d{4}[A-Z]{2}$/.test(normPlate(p));

// Перші дві літери — регіон реєстрації (старі й нові серії).
const VEH_REGIONS = {
  'Київ': ['AA', 'KA'], 'Київська обл.': ['AI', 'KI'], 'Вінницька обл.': ['AB', 'KB'], 'Волинська обл.': ['AC', 'KC'],
  'Дніпропетровська обл.': ['AE', 'KE'], 'Донецька обл.': ['AH', 'KH'], 'Житомирська обл.': ['AM', 'KM'], 'Закарпатська обл.': ['AO', 'KO'],
  'Запорізька обл.': ['AP', 'KP'], 'Івано-Франківська обл.': ['AT', 'KT'], 'Кіровоградська обл.': ['BA', 'HA'], 'Луганська обл.': ['BB', 'HB'],
  'Львівська обл.': ['BC', 'HC'], 'Миколаївська обл.': ['BE', 'HE'], 'Одеська обл.': ['BH', 'HH'], 'Полтавська обл.': ['BI', 'HI'],
  'Рівненська обл.': ['BK', 'HK'], 'Сумська обл.': ['BM', 'HM'], 'Тернопільська обл.': ['BO', 'HO'], 'Харківська обл.': ['AX', 'KX'],
  'Херсонська обл.': ['BT', 'HT'], 'Хмельницька обл.': ['BX', 'HX'], 'Черкаська обл.': ['CA', 'IA'], 'Чернігівська обл.': ['CB', 'IB'],
  'Чернівецька обл.': ['CE', 'IE'], 'АР Крим': ['AK', 'KK'], 'Севастополь': ['CH', 'IH'],
};
export function plateRegion(p) {
  const code = normPlate(p).slice(0, 2);
  return Object.entries(VEH_REGIONS).find(([, codes]) => codes.includes(code))?.[0] ?? null;
}

// Демо-реєстр: вигадані авто для показу, як працюватиме перевірка.
export const DEMO_PLATES = {
  AA1234BB: { make: 'Skoda', model: 'Octavia', year: 2019, color: 'сірий', fuel: 'бензин', engine: '1,4 л', cls: 0 },
  KA0001AA: { make: 'Toyota', model: 'RAV4', year: 2021, color: 'білий', fuel: 'гібрид', engine: '2,5 л', cls: 1 },
  AI7777KE: { make: 'Volkswagen', model: 'Passat', year: 2016, color: 'чорний', fuel: 'дизель', engine: '2,0 л', cls: 0 },
};

// Перевірка в реєстрі МВС через сервер. registry: false — реєстр на сервері ще не завантажено.
export async function lookupPlateOnline(raw, api) {
  const local = lookupPlate(raw);
  if (local.error) return local;
  const r = await api(`vehicle?plate=${encodeURIComponent(local.plate)}`);
  if (!r.ok) return { ...local, car: null, failed: r.data.error || 'Не вдалося перевірити номер' };
  return { ...local, car: r.data.car ?? null, registry: !!r.data.registry, online: true, failed: r.data.error ?? null };
}

// Результат перевірки: регіон і дані авто (якщо знайдено).
export function lookupPlate(raw) {
  const plate = normPlate(raw);
  if (!plateValid(plate)) return { plate, error: 'Номер має вигляд AA1234BB: дві літери, чотири цифри, дві літери' };
  const car = DEMO_PLATES[plate] ?? null;
  return {
    plate, region: plateRegion(plate), car,
  };
}
