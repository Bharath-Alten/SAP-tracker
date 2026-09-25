import { test } from '@playwright/test';

import { sapCredentials, warmUpService } from './sapLogin';
import { getFormFields, getGridRows } from './workbookData';
import { createHeader } from './createHeader';
import { addGridRows } from './gridRows';

// Sign in through the browser (SSO needs it), then do everything else through SAP's own
// OData service: create the control plan header and add the CP Grid rows.
//
// Choose this flow by putting this line in backend/.env:
//   PLAYWRIGHT_SPEC=tests/api-flow.spec.ts
// Remove it to go back to the screen-by-screen flow in login.spec.ts.

test('create control plan via API', async ({ page }) => {
  test.setTimeout(300_000);

  const form = getFormFields();
  const rows = getGridRows();
  const { user, password } = sapCredentials();
  const buildProcess = form['Build Process Number & Issue'] ?? '';
  const productNumber = buildProcess.replace(/\s*issue\b.*$/i, '').trim();

  // 1. Log in on screen; the session cookies are then used by the API calls below.
  await page.goto('https://mylaunchpad.intra.corp/fiori#Shell-home');
  await page.getByRole('link', { name: 'Login / Password' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill(user);
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign On   >' }).click();
  await page.waitForLoadState('load');

  // Opening the CP tile first is what the working screen flow did; the OData service only
  // accepts calls once the browser has been through it (otherwise it answers 401).
  await page.getByRole('button', { name: 'CP Control Plan' }).click().catch(() => {
    console.log('LOGIN: CP tile not found, continuing with the service call directly');
  });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await warmUpService(page);
  console.log('LOGIN: signed in, switching to the OData service');

  // 2. The header, in one call instead of a screenful of fields.
  const { cpId, issue } = await createHeader(page, form, form['Issue'] || 'A0');

  // 3. The grid rows, into the plan SAP just created.
  await addGridRows(page, rows, { product: productNumber, issue, cpId });

  console.log(`DONE: control plan ${cpId} / ${issue}`);
});
