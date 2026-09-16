# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.ts >> demo login test
- Location: tests\login.spec.ts:3:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('input[name="username"]')

```

# Page snapshot

```yaml
- iframe [ref=e2]:
  - generic [ref=f1e1]:
    - generic [ref=f1e2]:
      - generic [ref=f1e5]: Application error
      - paragraph [ref=f1e6]:
        - text: An error occurred in the application and your page could not be served. If you are the application owner,
        - link "check your logs for details" [ref=f1e7] [cursor=pointer]:
          - /url: https://devcenter.heroku.com/articles/logging#view-logs?utm_source=error-pages&utm_content=application-error
        - text: . You can do this from the Heroku CLI with the command
        - code [ref=f1e8]: heroku logs --tail
    - link [ref=f1e15] [cursor=pointer]:
      - /url: https://devcenter.heroku.com/articles/logging#view-logs?utm_source=error-pages&utm_content=application-error
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('demo login test', async ({ page }) => {
  4  |   await page.goto('https://the-internet.herokuapp.com/login');
> 5  |   await page.fill('input[name="username"]', 'tomsmith');
     |              ^ Error: page.fill: Test timeout of 30000ms exceeded.
  6  |   await page.fill('input[name="password"]', 'SuperSecretPassword!');
  7  |   await page.click('button[type="submit"]');
  8  |   const flash = page.locator('#flash');
  9  |   await expect(flash).toContainText('You logged into a secure area!');
  10 | });
  11 | 
```