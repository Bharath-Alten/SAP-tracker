# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.ts >> test
- Location: tests\login.spec.ts:6:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_TIMED_OUT at https://mylaunchpad.intra.corp/fiori#Shell-home
Call log:
  - navigating to "https://mylaunchpad.intra.corp/fiori#Shell-home", waiting until "load"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e6]:
    - heading "This site can’t be reached" [level=1] [ref=e7]
    - paragraph [ref=e8]:
      - strong [ref=e9]: mylaunchpad.intra.corp
      - text: took too long to respond.
    - generic [ref=e10]:
      - paragraph [ref=e11]: "Try:"
      - list [ref=e12]:
        - listitem [ref=e13]: Checking the connection
        - listitem [ref=e14]:
          - link "Checking the proxy and the firewall" [ref=e15] [cursor=pointer]:
            - /url: "#buttons"
        - listitem [ref=e16]:
          - link "Running Windows Network Diagnostics" [ref=e17] [cursor=pointer]:
            - /url: javascript:diagnoseErrors()
    - generic [ref=e18]: ERR_CONNECTION_TIMED_OUT
  - generic [ref=e19]:
    - button "Reload" [ref=e21] [cursor=pointer]
    - button "Details" [ref=e22] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { getFormFields, getGridRows, requireField } from './workbookData';
  3  | 
  4  | 
  5  | 
  6  | test('test', async ({ page }) => {
> 7  |   await page.goto('https://mylaunchpad.intra.corp/fiori#Shell-home');
     |              ^ Error: page.goto: net::ERR_CONNECTION_TIMED_OUT at https://mylaunchpad.intra.corp/fiori#Shell-home
  8  |   await page.goto('https://umssosptlspro.intra.corp/1S14/idp/SSO.saml2');
  9  |   await page.getByRole('link', { name: 'Login / Password' }).click();
  10 |   await page.getByRole('textbox', { name: 'Nom d\'utilisateur' }).fill('vcou9wtt');
  11 |   await page.getByRole('textbox', { name: 'Mot de passe' }).click();
  12 |   await page.getByRole('textbox', { name: 'Mot de passe' }).fill('Changeme2028');
  13 |   await page.getByRole('button', { name: 'Se connecter   >' }).click();
  14 |   await page.getByRole('button', { name: 'CP Control Plan' }).click();
  15 |   await page.goto('https://mylaunchpad.intra.corp/fiori#ZSO_1N31_CP-display&/CP_ID/A0/info');
  16 | });
```