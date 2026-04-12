import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Mock API endpoints so the app works without a backend
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uid: 'test-user',
        email: 'test@example.com',
        display_name: 'Test User',
        is_anonymous: false,
      }),
    }),
  );

  await page.route('**/api/sessions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.route('**/api/collections', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.route('**/api/agents', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
});

test('app loads and renders agent home', async ({ page }) => {
  await page.goto('/');

  // Agent home loads (the main page for authenticated users)
  await expect(page.locator('body')).toBeVisible();

  // Page should not show an error
  await expect(page.locator('text=Application error')).not.toBeVisible();
});

test('agents page renders', async ({ page }) => {
  await page.goto('/agents');

  // Page loads without error
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('text=Application error')).not.toBeVisible();
});
