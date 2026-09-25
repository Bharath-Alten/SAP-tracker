import type { Page } from '@playwright/test';

import { fetchCsrfToken, ODATA_SERVICE, SAP_CLIENT } from './sapLogin';

// Creates the control plan header with the same OData call the CP screen sends when Save is
// pressed: POST ETCPHeaderInfoSet with CPID set to the placeholder "CP_ID". SAP generates the
// real id (e.g. AFM1_D_2026_0406) and returns it.

const CRLF = '\r\n';
const NAME_MAX = 50; // the screen cuts the name at this length

// Fixed choices the screen makes. Override any of them through backend/.env if a plan needs other values.
const DEFAULTS = {
  targetSystem: process.env.CP_TARGET_SYSTEM ?? 'ARP',
  granularity: process.env.CP_GRANULARITY ?? 'R', // Routing
  maturity: process.env.CP_MATURITY ?? 'B',
  plant: process.env.CP_PLANT ?? 'AFM1',
  program: process.env.CP_PROGRAM ?? 'D', // A320_Family_CEO/NEO
  mft: process.env.CP_MFT ?? 'A320 FAL MOB [MINOR]',
  effectivity: process.env.CP_EFFECTIVITY ?? 'Effectively'
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
    Name: planNumber.slice(0, NAME_MAX),
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
