import { defineConfig, devices, type ReporterDescription } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

/** Teams Adaptive Card only when TEAMS_NOTIFY=1 (npm run test:teams:stg:usa:23005). */
function buildReporters(): ReporterDescription[] {
  const reporters: ReporterDescription[] = [
    ['list'],
    ['html', { open: 'never' }],
    ['allure-playwright'],
  ];

  if (process.env.TEAMS_NOTIFY === '1') {
    reporters.push(['./reporters/teamsDetailReporter.ts']);
  }

  return reporters;
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: buildReporters(),
  use: {
    actionTimeout: 0,
    screenshot: 'on',
    video: 'on',
    trace: 'on',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
