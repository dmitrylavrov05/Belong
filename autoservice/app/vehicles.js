// Перевірка авто за держномером: формат номера, регіон реєстрації й дані з реєстру.
// У прототипі реєстр — кілька вигаданих демо-номерів. У робочій версії сервер звертається
// до відкритих даних МВС про реєстрацію транспортних засобів і до бази полісів МТСБУ.

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
  AA1234BB: { make: 'Skoda', model: 'Octavia', year: 2019, color: 'сірий', fuel: 'бензин', engine: '1,4 л', cls: 0, insurance: { until: '2027-03-12' } },
  KA0001AA: { make: 'Toyota', model: 'RAV4', year: 2021, color: 'білий', fuel: 'гібрид', engine: '2,5 л', cls: 1, insurance: { until: '2026-09-20' } },
  AI7777KE: { make: 'Volkswagen', model: 'Passat', year: 2016, color: 'чорний', fuel: 'дизель', engine: '2,0 л', cls: 0, insurance: null },
};

// Результат перевірки: регіон, дані авто (якщо знайдено) і стан поліса ОСЦПВ на сьогодні.
export function lookupPlate(raw, today) {
  const plate = normPlate(raw);
  if (!plateValid(plate)) return { plate, error: 'Номер має вигляд AA1234BB: дві літери, чотири цифри, дві літери' };
  const car = DEMO_PLATES[plate] ?? null;
  const ins = car?.insurance;
  return {
    plate, region: plateRegion(plate), car,
    insurance: !car ? null : !ins ? { state: 'none' } : ins.until >= today ? { state: 'ok', until: ins.until } : { state: 'expired', until: ins.until },
  };
}
