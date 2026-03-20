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
});

test('app loads and renders 3-panel layout', async ({ page }) => {
  await page.goto('/');

  // App shell loads
  await expect(page.getByTestId('app-shell')).toBeVisible();

  // 3 panels render
  await expect(page.getByTestId('sessions-panel')).toBeVisible();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
});

test('welcome screen renders with chat input', async ({ page }) => {
  await page.goto('/');

  // Welcome screen is visible (no messages yet)
  await expect(page.getByTestId('welcome-screen')).toBeVisible();

  // Chat input is functional
  const input = page.getByTestId('chat-input');
  await expect(input).toBeVisible();
  await input.fill('test message');
  await expect(input).toHaveValue('test message');
});
