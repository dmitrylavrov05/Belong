// Зручності для тестів: навчання з Кар Каричем у CarCar Business позначаємо пройденим, щоб воно не закривало екран
// (саме навчання перевіряє окремий тест у pro.spec.js). page.payNext лишається для сумісності.
export async function payStep(page) {
  page.payNext = page.locator('[data-action="pay-next"]');
  await page.context().addInitScript(() => { try { localStorage.getItem('carcar.biz.tour') ?? localStorage.setItem('carcar.biz.tour', 'true'); } catch { /* */ } });
}
