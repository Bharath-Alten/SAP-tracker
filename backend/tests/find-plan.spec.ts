import { test } from '@playwright/test';

import { SAP_BASE, SAP_CLIENT, ODATA_SERVICE, warmUpService } from './sapLogin';
import { getFormFields } from './workbookData';
import { planName } from './createHeader';

// Finds which OData entity set can look up a control plan by its name, so a run can reuse an
// existing plan instead of asking for CP_ID.
//
// Run it (from the backend folder) after importing a workbook in the app once:
//   npx playwright test tests/find-plan.spec.ts
// Search for a different name with:  set PLAN_NAME=CP_MOB_...
// Add other services to try with:    set EXTRA_SERVICES=Z_1N31_MY_ACTVT_SRV,Z_C1DC_SHARED_MODEL_SRV

const SERVICES = [
  ODATA_SERVICE,
  ...(process.env.EXTRA_SERVICES ?? 'Z_1N31_MY_ACTVT_SRV')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `${SAP_BASE}/sap/opu/odata/sap/${name}`)
];

test('find a searchable plan list', async ({ page }) => {
  test.setTimeout(600_000);

  const wanted = process.env.PLAN_NAME || planName(getFormFields()['Control Plan Number'] ?? '');
  console.log(`FIND: looking for a plan named "${wanted}"`);

  await page.goto(`${SAP_BASE}/fiori#Shell-home`);
  await page.getByRole('link', { name: 'Login / Password' }).click().catch(() => undefined);
  console.log('FIND: sign in in the browser window, this waits up to 5 minutes');
  await page.getByRole('button', { name: 'CP Control Plan' }).waitFor({ state: 'visible', timeout: 300_000 });
  await page.getByRole('button', { name: 'CP Control Plan' }).click().catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await warmUpService(page);

  for (const service of SERVICES) {
    console.log(`\nFIND: === ${service.split('/').pop()} ===`);

    const metadata = await page.request.get(`${service}/$metadata?sap-client=${SAP_CLIENT}`);
    if (!metadata.ok()) {
      console.log(`FIND: no metadata (HTTP ${metadata.status()}) — skipping this service`);
      continue;
    }
    const xml = await metadata.text();
    const sets = [...xml.matchAll(/<EntitySet Name="([^"]+)"/g)].map((match) => match[1]);
    console.log(`FIND: ${sets.length} entity set(s): ${sets.join(', ')}`);

    // Only the sets that plausibly hold control plans, to keep this quick.
    const candidates = sets.filter((name) => /cp|plan|header|activity|control/i.test(name));

    for (const set of candidates) {
      const probe = await page.request.get(`${service}/${set}?sap-client=${SAP_CLIENT}&$top=1&$format=json`, {
        headers: { Accept: 'application/json' }
      });
      if (!probe.ok()) {
        console.log(`FIND: ${set} — not readable (HTTP ${probe.status()})`);
        continue;
      }
      const first = await probe.json().then((body) => body?.d?.results?.[0] ?? body?.d ?? {}).catch(() => ({}));
      const fields = Object.keys(first).filter((key) => key !== '__metadata');
      // My Activities filters on CPName (seen in its filter bar), so try that name first.
      const nameField = ['CPName', 'Name', 'PlanName', 'ControlPlanName', 'Description']
        .find((key) => fields.some((field) => field.toLowerCase() === key.toLowerCase()));
      const idField = ['CPID', 'CPNumber', 'PlanID', 'ControlPlanID']
        .find((key) => fields.some((field) => field.toLowerCase() === key.toLowerCase()));
      console.log(`FIND: ${set} — readable, ${fields.length} field(s)${idField ? `, id: ${idField}` : ''}${nameField ? `, name: ${nameField}` : ''}`);

      if (!nameField) {
        console.log(`FIND:   no name-like field here (${fields.slice(0, 12).join(', ')}${fields.length > 12 ? ', ...' : ''})`);
        continue;
      }

      const filter = encodeURIComponent(`${nameField} eq '${wanted.replace(/'/g, "''")}'`);
      const search = await page.request.get(`${service}/${set}?sap-client=${SAP_CLIENT}&$filter=${filter}&$top=5&$format=json`, {
        headers: { Accept: 'application/json' }
      });
      if (!search.ok()) {
        console.log(`FIND:   filtering by ${nameField} is refused (HTTP ${search.status()})`);
        continue;
      }
      const rows = await search.json().then((body) => body?.d?.results ?? []).catch(() => []);
      const describe = (row: Record<string, string>) =>
        `${idField ? row[idField] : JSON.stringify(row).slice(0, 80)} (${row.Issue ?? '?'})`;
      console.log(`FIND:   >>> ${set} answers a ${nameField} filter: ${rows.length} match(es)` +
        (rows.length ? ` -> ${rows.map(describe).join(', ')}` : ''));
    }
  }

  console.log('\nFIND: done. The line starting with ">>>" is the entity set the app should use.');
});
