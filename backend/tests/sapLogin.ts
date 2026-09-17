import type { Page } from '@playwright/test';

// SSO login, shared by the specs. Credentials come from the environment when set:
//   set SAP_USER=... & set SAP_PASSWORD=...
export const SAP_BASE = process.env.SAP_BASE ?? 'https://mylaunchpad.intra.corp';
export const SAP_CLIENT = process.env.SAP_CLIENT ?? '001';
export const ODATA_SERVICE = `${SAP_BASE}/sap/opu/odata/sap/Z_1N31_CP_SRV`;

export function sapCredentials() {
  const user = process.env.SAP_USER;
  const password = process.env.SAP_PASSWORD;
  if (!user || !password) {
    throw new Error('Set SAP_USER and SAP_PASSWORD before running (they must never be written in the code).');
  }
  return { user, password };
}

export async function loginToSap(page: Page) {
  const { user, password } = sapCredentials();
  await page.goto(`${SAP_BASE}/fiori#Shell-home`);
  await page.getByRole('link', { name: 'Login / Password' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill(user);
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign On   >' }).click();
  await page.waitForLoadState('load');
}

/** Token SAP requires on every write (MERGE/POST). Reuses the browser's SSO session. */
export async function fetchCsrfToken(page: Page) {
  const response = await page.request.get(`${ODATA_SERVICE}/?sap-client=${SAP_CLIENT}`, {
    headers: { 'X-CSRF-Token': 'Fetch', Accept: 'application/json' }
  });
  const token = response.headers()['x-csrf-token'];
  if (!token) throw new Error(`No CSRF token returned (HTTP ${response.status()}). Is the service name correct?`);
  return token;
}
