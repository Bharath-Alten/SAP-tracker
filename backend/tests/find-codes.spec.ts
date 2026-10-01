import { test } from '@playwright/test';

import { ODATA_SERVICE, SAP_BASE, SAP_CLIENT, warmUpService } from './sapLogin';

// Asks SAP itself which codes a dropdown accepts, so the CODES table in gridRows.ts can be
// filled with real values instead of guesses. Needed whenever a run prints
//   GRID NOTE OperationStepKey: no code known for "Final"
//
// Run it (from the backend folder) and sign in when the window opens:
//   npx playwright test tests/find-codes.spec.ts
// Narrow it to one list with:  set CODE_LIST=ControlActorKey
//
// Read-only: it never writes anything to SAP.

const SET = process.env.CODE_ENTITY ?? 'ETDomainValueSet';

test('list the codes SAP accepts', async ({ page }) => {
  test.setTimeout(600_000);

  await page.goto(`${SAP_BASE}/fiori#Shell-home`);
  await page.getByRole('link', { name: 'Login / Password' }).click().catch(() => undefined);
  console.log('CODES: sign in in the browser window, this waits up to 5 minutes');
  const tile = page.getByRole('button', { name: 'CP Control Plan' });
  await tile.waitFor({ state: 'visible', timeout: 300_000 });
  await tile.click().catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await warmUpService(page);

  // Which properties the entity has: the names differ between services (Domain/Code/Text,
  // Domname/Valuelow/Ddtext, ...), so print one row raw before filtering.
  const probe = await page.request.get(
    `${ODATA_SERVICE}/${SET}?sap-client=${SAP_CLIENT}&$top=1&$format=json`,
    { headers: { Accept: 'application/json' } }
  );
  if (!probe.ok()) {
    console.log(`CODES: ${SET} answered HTTP ${probe.status()}. Try another entity with CODE_ENTITY=...`);
    const sets = await page.request
      .get(`${ODATA_SERVICE}/?sap-client=${SAP_CLIENT}&$format=json`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((b) => (b?.d?.EntitySets ?? []).join(', '))
      .catch(() => '(could not read the service root)');
    console.log(`CODES: the service offers: ${sets}`);
    return;
  }

  const first = await probe.json().then((b) => b?.d?.results?.[0]).catch(() => undefined);
  if (!first) {
    console.log(`CODES: ${SET} is readable but empty.`);
    return;
  }
  const columns = Object.keys(first).filter((key) => key !== '__metadata');
  console.log(`CODES: ${SET} columns: ${columns.join(', ')}`);
  console.log(`CODES: first row: ${JSON.stringify(first)}`);

  // Everything, so the pairs can be copied into CODES. $filter is not used: the column that
  // names the list is unknown until the line above has been read once.
  const all = await page.request.get(
    `${ODATA_SERVICE}/${SET}?sap-client=${SAP_CLIENT}&$top=2000&$format=json`,
    { headers: { Accept: 'application/json' } }
  );
  const rows: Record<string, string>[] = await all.json().then((b) => b?.d?.results ?? []).catch(() => []);
  console.log(`CODES: ${rows.length} row(s)`);

  const wanted = (process.env.CODE_LIST ?? '').toLowerCase();
  for (const row of rows) {
    const line = columns.map((key) => `${key}=${row[key]}`).join('  ');
    if (!wanted || line.toLowerCase().includes(wanted)) console.log(`CODES  ${line}`);
  }
});
