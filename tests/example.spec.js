// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Example tests — patterns to copy when writing new tests.
 * Delete once you're comfortable with the Playwright API.
 */

test.describe('example patterns', () => {
  test('page navigation + title assertion', async ({ page }) => {
    await page.goto('/product.html');
    await expect(page).toHaveTitle(/.+/); // title is non-empty
  });

  test('locating elements by role + text', async ({ page }) => {
    await page.goto('/');
    // Prefer user-visible queries over CSS selectors when possible.
    const nav = page.getByRole('navigation').first();
    await expect(nav).toBeVisible();
  });

  test('screenshot of a specific element', async ({ page }, testInfo) => {
    await page.goto('/');
    const hero = page.locator('section.glow-hero').first();
    const buf = await hero.screenshot();
    await testInfo.attach('hero', { body: buf, contentType: 'image/png' });
  });

  test('mobile viewport override per-test', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await ctx.close();
  });
});
