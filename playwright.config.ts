import { defineConfig } from '@playwright/test';

// Set PW_CHANNEL=chrome to use an installed Chrome instead of Playwright's own browser.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173', channel: process.env.PW_CHANNEL },
  webServer: {
    command: 'npm run build -w @beautique/app && npm run preview -w @beautique/app -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
