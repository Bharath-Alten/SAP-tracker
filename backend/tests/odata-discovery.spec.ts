import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';

import { loginToSap, ODATA_SERVICE, SAP_CLIENT } from './sapLogin';
import { getFormFields, getGridRows } from './workbookData';

// Step 1 of the OData approach: log in, ask SAP what fields exist, read one existing control plan,
// and suggest which workbook label matches which SAP field by comparing values.
//
// Run it (from the backend folder), after importing a workbook in the app at least once:
//   npx playwright test tests/odata-discovery.spec.ts
//
// Pick the plan to read with:  set CP_ID=AFM1_D_2026_0366 & set CP_ISSUE=A0
// Everything it downloads is written to backend/odata/.

const outDir = path.join(process.cwd(), 'odata');

function save(name: string, content: string) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, content);
  console.log(`SAVED ${file} (${content.length} bytes)`);
}

test('discover the CP service', async ({ page }) => {
  test.setTimeout(180_000);
  await loginToSap(page);

  // 1. Which entities does the service expose? (header set, grid/item set, ...)
  const root = await page.request.get(`${ODATA_SERVICE}/?sap-client=${SAP_CLIENT}&$format=json`, { headers: { Accept: 'application/json' } });
  const rootBody = await root.text();
  save('service-root.json', rootBody);
  console.log('ENTITY SETS:', [...rootBody.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).join(', '));

  // 2. The full contract: every field, its type, length and whether it is mandatory.
  const metadata = await page.request.get(`${ODATA_SERVICE}/$metadata?sap-client=${SAP_CLIENT}`);
  const metadataXml = await metadata.text();
  save('metadata.xml', metadataXml);
  for (const [, entity] of metadataXml.matchAll(/<EntityType Name="([^"]+)"/g)) console.log('ENTITY TYPE:', entity);

  // 3. Read one control plan that also exists as an Excel file.
  const grid = getGridRows();
  const cpId = process.env.CP_ID ?? grid[0]?.['Control plan ID'] ?? '';
  const issue = process.env.CP_ISSUE ?? grid[0]?.['Issue'] ?? 'A0';
  console.log(`READING CPID='${cpId}' Issue='${issue}'`);
  const header = await page.request.get(
    `${ODATA_SERVICE}/ETCPHeaderInfoSet(CPID='${cpId}',Issue='${issue}')?sap-client=${SAP_CLIENT}&$format=json`,
    { headers: { Accept: 'application/json' } }
  );
  const headerBody = await header.text();
  save('cp-header.json', headerBody);
  if (!header.ok()) {
    console.log(`HEADER READ FAILED: HTTP ${header.status()} — check CP_ID/CP_ISSUE or the entity name.`);
    return;
  }

  // 4. Suggest the mapping by comparing SAP values with the workbook values.
  const sapRecord: Record<string, unknown> = JSON.parse(headerBody).d ?? {};
  // Plain labels only; "Section · Label" keys are duplicates.
  const workbook = Object.fromEntries(
    Object.entries({ ...getFormFields(), ...grid[0] }).filter(([label]) => !label.includes(' · '))
  );
  const normalise = (value: unknown) => String(value ?? '').trim().replace(/^0+(?=\d)/, '').toLowerCase();

  const map: Record<string, string> = {};
  console.log('\n--- SUGGESTED MAPPING (workbook label -> SAP field) ---');
  for (const [sapField, sapValue] of Object.entries(sapRecord)) {
    if (sapField === '__metadata' || !normalise(sapValue)) continue;
    const match = Object.entries(workbook).find(([, value]) => normalise(value) === normalise(sapValue));
    if (match) {
      map[match[0]] = sapField;
      console.log(`'${match[0]}': '${sapField}',    // ${sapValue}`);
    }
  }
  console.log('--- SAP FIELDS WITH NO MATCH (fill these in by hand) ---');
  for (const [sapField, sapValue] of Object.entries(sapRecord)) {
    if (sapField !== '__metadata' && !Object.values(map).includes(sapField)) console.log(`${sapField} = ${JSON.stringify(sapValue)}`);
  }
  save('field-map.suggested.json', JSON.stringify(map, null, 2));
});
