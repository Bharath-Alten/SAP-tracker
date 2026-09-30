import type { Page } from '@playwright/test';

import { fetchCsrfToken, ODATA_SERVICE, SAP_BASE, SAP_CLIENT } from './sapLogin';

// Creates the control plan header with the same OData call the CP screen sends when Save is
// pressed: POST ETCPHeaderInfoSet with CPID set to the placeholder "CP_ID". SAP generates the
// real id (e.g. AFM1_D_2026_0406) and returns it.

const CRLF = '\r\n';
const NAME_MAX = 50; // SAP's limit for the plan name

// The plan name has to fit NAME_MAX, so long words in the designation are shortened:
// CP_MOB_ATA25_1322_D256-79839-002-00_INST.BRACKET 72X10 -> ..._INST.BCK 72X10
// Add or change pairs here, or set CP_NAME_SHORTCUTS="BRACKET=BCK,SUPPORT=SUP" in backend/.env.
const NAME_SHORTCUTS: Record<string, string> = { BRACKET: 'BCK' };

function shortcutsFromEnv() {
  const pairs = (process.env.CP_NAME_SHORTCUTS ?? '')
    .split(',')
    .map((entry) => entry.split('='))
    .filter((parts): parts is [string, string] => parts.length === 2 && Boolean(parts[0].trim()));
  return Object.fromEntries(pairs.map(([word, short]) => [word.trim(), short.trim()]));
}

export function planName(planNumber: string) {
  const shortcuts = { ...NAME_SHORTCUTS, ...shortcutsFromEnv() };
  let name = planNumber;
  for (const [word, short] of Object.entries(shortcuts)) {
    name = name.replace(new RegExp(word, 'gi'), short);
  }
  return name.slice(0, NAME_MAX);
}

// Fixed choices the screen makes. Override any of them through backend/.env if a plan needs other values.
const DEFAULTS = {
  targetSystem: process.env.CP_TARGET_SYSTEM ?? 'ARP',
  granularity: process.env.CP_GRANULARITY ?? 'R', // Routing
  maturity: process.env.CP_MATURITY ?? 'B',
  plant: process.env.CP_PLANT ?? 'AFM1',
  program: process.env.CP_PROGRAM ?? 'D', // A320_Family_CEO/NEO
  mft: process.env.CP_MFT ?? 'A320 FAL MOB [MINOR]',
  effectivity: process.env.CP_EFFECTIVITY ?? '' // the client wants this left empty
};

const pad = (value: number) => String(value).padStart(2, '0');
const ddMMyyyy = (date: Date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
const yyyyMMdd = (date: Date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;

export function headerBody(form: Record<string, string>, issue: string) {
  const planNumber = form['Control Plan Number'] ?? '';
  const buildProcess = form['Build Process Number & Issue'] ?? '';
  const productNumber = buildProcess.replace(/\s*issue\b.*$/i, '').trim();
  const engineeringProduct = (form['Definition Dossier Number & Issue'] ?? '').split(/[\s(]/)[0];
  const standard = (form['Program designation'] ?? '').match(/\(([^)]+)\)/)?.[1] ?? '';
  const poe = (form['Point of Embodiment'] ?? '').replace(/\D/g, '');
  const now = new Date();
  const due = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);

  return {
    CPID: 'CP_ID', // placeholder: SAP assigns the real id
    Issue: issue,
    Status: (form['Status'] ?? 'In Progress').replace(/^in progress$/i, 'In progress'),
    Name: planName(planNumber),
    Description: planNumber,
    TargetSystem: DEFAULTS.targetSystem,
    TargetSystemRFC: DEFAULTS.targetSystem,
    Granularity: DEFAULTS.granularity,
    Maturity: DEFAULTS.maturity,
    Plant: DEFAULTS.plant,
    Program: DEFAULTS.program,
    Area: form['Area'] ?? '',
    POE: poe,
    DOE: '',
    ContentRevision: form['Content of Revision'] ?? '',
    Effectivity: DEFAULTS.effectivity,
    Standard: standard,
    MFT: DEFAULTS.mft,
    DueImplDate: ddMMyyyy(due),
    CreateDate: yyyyMMdd(now),
    RequestRelease: '',
    BuildProcessNumber: buildProcess,
    DFMEA: form['D-FMEAs Number & Issue'] || 'N/A',
    PFMEA: form['P-FMEAs Number & Issue'] ?? '',
    AssignedProduct: productNumber ? `${productNumber}+AODS/` : '',
    PlanProdAssign: engineeringProduct ? `${engineeringProduct}:$:` : '',
    __metadata: { type: 'Z_1N31_CP_SRV.ETCPHeaderInfo' }
  };
}

function batchBody(header: Record<string, unknown>, token: string, boundary: string, changeset: string) {
  const json = JSON.stringify(header);
  return [
    `--${boundary}`,
    `Content-Type: multipart/mixed; boundary=${changeset}`,
    '',
    `--${changeset}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    `POST ETCPHeaderInfoSet?sap-client=${SAP_CLIENT} HTTP/1.1`,
    'sap-contextid-accept: header',
    'Accept: application/json',
    'Accept-Language: en',
    'DataServiceVersion: 2.0',
    'MaxDataServiceVersion: 2.0',
    `x-csrf-token: ${token}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(json)}`,
    '',
    json,
    `--${changeset}--`,
    '',
    `--${boundary}--`,
    ''
  ].join(CRLF);
}


/**
 * Looks for a plan already in SAP with this name. The CP service cannot list plans
 * (ETCPHeaderInfoSet answers 501), but the My Activities service can: ETMyActivitySet
 * filters on CPName and carries the plan number in ControlPlanID.
 */
export async function findPlanByName(page: Page, name: string, issue: string) {
  const service = process.env.MY_ACTIVITY_SERVICE ?? `${SAP_BASE}/sap/opu/odata/sap/Z_1N31_MY_ACTVT_SRV`;
  const filter = encodeURIComponent(`CPName eq '${name.replace(/'/g, "''")}'`);
  const response = await page.request.get(
    `${service}/ETMyActivitySet?sap-client=${SAP_CLIENT}&$filter=${filter}&$top=50&$format=json`,
    { headers: { Accept: 'application/json' } }
  );

  if (!response.ok()) {
    console.log(`HEADER: could not search for an existing plan (HTTP ${response.status()}); treating it as new.`);
    return '';
  }

  const results: Record<string, string>[] = await response.json()
    .then((body) => body?.d?.results ?? [])
    .catch(() => []);
  if (!results.length) return '';

  // Keep the rows for this issue when the list reports one; several plans can share a name,
  // in which case the newest number is the one the user is working on.
  const forIssue = results.filter((row) => !row.Issue || row.Issue === issue);
  const ids = (forIssue.length ? forIssue : results)
    .map((row) => row.ControlPlanID)
    .filter(Boolean)
    .sort();
  if (ids.length > 1) console.log(`HEADER: ${ids.length} plans share this name (${ids.join(', ')}); using the newest.`);
  return ids[ids.length - 1] ?? '';
}

/**
 * Uses the plan that already exists for this workbook, or creates it. Either way the grid rows
 * that follow go into the same plan.
 */
export async function ensurePlan(page: Page, form: Record<string, string>, issue = 'A0') {
  if (process.env.CP_ID) {
    console.log(`HEADER: using ${process.env.CP_ID} / ${issue} (from the CP_ID setting)`);
    return { cpId: process.env.CP_ID, issue, created: false };
  }

  const name = planName(form['Control Plan Number'] ?? '');
  const existing = await findPlanByName(page, name, issue);
  if (existing) {
    console.log(`HEADER: "${name}" already exists as ${existing} / ${issue} — keeping it, adding the grid rows.`);
    return { cpId: existing, issue, created: false };
  }

  const created = await createHeader(page, form, issue);
  return { cpId: created.cpId, issue: created.issue, created: true };
}

/** Creates the plan and returns the id SAP generated. */
export async function createHeader(page: Page, form: Record<string, string>, issue = 'A0') {
  const token = await fetchCsrfToken(page);
  const stamp = String(Date.now());
  const boundary = `batch_${stamp}`;
  const changeset = `changeset_${stamp}`;
  const body = headerBody(form, issue);

  console.log(`HEADER: creating "${body.Name}" (Issue ${issue}, Plant ${body.Plant}, Area ${body.Area})`);
  const response = await page.request.post(`${ODATA_SERVICE}/$batch?sap-client=${SAP_CLIENT}`, {
    headers: {
      'X-CSRF-Token': token,
      'Content-Type': `multipart/mixed;boundary=${boundary}`,
      Accept: 'multipart/mixed',
      DataServiceVersion: '2.0',
      MaxDataServiceVersion: '2.0'
    },
    data: batchBody(body, token, boundary, changeset)
  });

  const text = await response.text();

  // SAP answers 201 even when it refused: the real verdict is in the sap-message header,
  // e.g. "Duplicated control plan name ... in plant AFM1." with severity "error".
  const sapMessage = text.match(/sap-message:\s*(\{.*?\})\s*$/m)?.[1];
  if (sapMessage && /"severity"\s*:\s*"error"/.test(sapMessage)) {
    const reason = sapMessage.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? sapMessage;
    if (/duplicat/i.test(reason)) {
      throw new Error(
        `${reason} The plan is already in SAP, but this service does not return its number. ` +
        'Open it in SAP, then run again with CP_ID=<that plan number> in backend/.env to add the grid rows to it.'
      );
    }
    throw new Error(`SAP refused the control plan: ${reason}`);
  }

  const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) => Number(match[1]));
  const failed = statuses.find((status) => status >= 400);
  if (!response.ok() || failed) {
    const message = text.match(/"message"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/)?.[1]
      ?? text.replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(`Creating the control plan failed (HTTP ${failed ?? response.status()}): ${message}`);
  }

  // SAP echoes the created plan, including the id it generated.
  const cpId = text.match(/"CPID"\s*:\s*"([^"]+)"/)?.[1];
  if (!cpId || cpId === 'CP_ID') {
    throw new Error('SAP accepted the plan but did not return its id; see the trace for the full response.');
  }
  console.log(`HEADER: SAP created ${cpId} / ${issue}`);
  return { cpId, issue, name: body.Name };
}
