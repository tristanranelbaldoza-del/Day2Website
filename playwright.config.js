// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Tester.io site.
 *
 * Tests run against the live Node server (launchd-managed) on port 3000.
 * If the server isn't up, `webServer` will start `node server.js` for the
 * test run and tear it down afterwards.
 *
 * Docs: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',

  // Fail the CI build if you accidentally left test.only in source.
  forbidOnly: !!process.env.CI,

  // Retries only in CI — local runs should surface flakes immediately.
  retries: process.env.CI ? 2 : 0,

  // Parallelism: one worker per file by default. Set to 1 for debugging.
  workers: process.env.CI ? 1 : undefined,

  // HTML report on fail, plus the default list reporter to the terminal.
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['./tests/supabase-reporter.mjs'],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // One project per browser engine.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    // WebKit (Safari engine) is disabled on this machine because Playwright
    // no longer ships WebKit builds for macOS 12. Re-enable by removing
    // the comments below after upgrading to macOS 13+ and running:
    //   npx playwright install webkit
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    // Mobile viewports — uncomment when you're ready to test responsive UX.
    // { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    // { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],

  // If localhost:3000 isn't already running, Playwright starts it for us.
  // reuseExistingServer avoids clashing with the launchd-managed instance.
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
