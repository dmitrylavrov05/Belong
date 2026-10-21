// Зручності для тестів, яким ці кроки не важливі (самі кроки перевіряють окремі тести):
// - екран оплати відкривається згори, внизу — «Усе вірно — до оплати»: натискаємо її, як людина, перш ніж оплатити;
// - навчання з Кар Каричем у CarCar Business позначаємо пройденим, щоб воно не закривало екран.
export async function payStep(page) {
  page.payNext = page.locator('[data-action="pay-next"]');
  await page.addLocatorHandler(page.payNext, (b) => b.click());
  await page.context().addInitScript(() => { try { localStorage.getItem('carcar.biz.tour') ?? localStorage.setItem('carcar.biz.tour', 'true'); } catch { /* */ } });
}
