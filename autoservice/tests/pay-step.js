// Екран оплати відкривається згори, внизу — «Усе вірно — до оплати». Тести, яким цей крок не важливий,
// натискають її так само, як людина, перш ніж оплатити (сам крок перевіряє client2.spec.js).
export async function payStep(page) {
  page.payNext = page.locator('[data-action="pay-next"]');
  await page.addLocatorHandler(page.payNext, (b) => b.click());
}
