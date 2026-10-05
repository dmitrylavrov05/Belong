import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Анімації вимкнено, щоб перевірки доступності й скриншоти не ловили проміжні кадри; рух перевіряє окремий тест.
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', locale: 'uk-UA', contextOptions: { reducedMotion: 'reduce' } },
  webServer: {
    command: `node scripts/serve.mjs app ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
