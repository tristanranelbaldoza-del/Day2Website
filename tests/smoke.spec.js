// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Smoke tests — the bare minimum that verifies the site loads and the
 * contact form endpoint is alive. Run with:
 *   npm test                 # all three browsers
 *   npx playwright test --project=chromium
 */

test('landing page loads and shows the Tester.io brand', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Tester/i);
  // Body should contain the wordmark somewhere
  await expect(page.locator('body')).toContainText(/Tester/i);
});

test('contact form is on the landing page', async ({ page }) => {
  await page.goto('/#contact');
  await expect(page.locator('form#contact-form')).toBeVisible();
  await expect(page.locator('form#contact-form input[name="name"]')).toBeVisible();
  await expect(page.locator('form#contact-form input[name="email"]')).toBeVisible();
  await expect(page.locator('form#contact-form textarea[name="message"]')).toBeVisible();
});

test('api/health endpoint responds OK', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json).toEqual({ ok: true });
});

test('thank-you page renders', async ({ page }) => {
  await page.goto('/thank-you.html');
  await expect(page.locator('body')).toContainText(/thank|thanks/i);
});
