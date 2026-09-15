import { test, expect } from '@playwright/test';

test('demo login test', async ({ page }) => {
  await page.goto('https://the-internet.herokuapp.com/login');
  await page.fill('input[name="username"]', 'tomsmith');
  await page.fill('input[name="password"]', 'SuperSecretPassword!');
  await page.click('button[type="submit"]');
  const flash = page.locator('#flash');
  await expect(flash).toContainText('You logged into a secure area!');
});
