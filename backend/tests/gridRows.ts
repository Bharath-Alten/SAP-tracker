import type { Page } from '@playwright/test';

import { fetchCsrfToken, ODATA_SERVICE, SAP_CLIENT } from './sapLogin';

// Sends CP Grid rows to SAP the same way the CP screen does: one $batch per row, holding a
// changeset with (1) POST ETCPIRControlsSet with an EMPTY key and (2) MERGE on the plan header.
// That changeset is what attaches the row to the plan - a plain POST with CPID filled in is
// accepted by SAP but never shows up in the grid.
//
// Only the FIRST row is sent unless GRID_ROWS=all.

// SAP text field -> CP Grid column.
const GRID_MAP: Record<string, string> = {
  Name: 'Control name',
  Description: 'Activity Description',
  BuildProcessStepNo: 'Operation Number',
  BPSN: 'Process Step',
  OperationName: 'Operation Description',
  MachineToolingJig: 'Machinery (Tools, Device, Jigs, Equipmen',
  ReferenceMethod: 'Control Method',
  Mandatory: 'Mandatory',
  ProductProcessName: 'Characteristic designation',
  ProductProcessNo: 'Characteristic number',
  ProductProcessSourceRef: 'Characteristic Source Reference',
  AcceptCriteria: 'Acceptance criteria',
  ControlTarget: 'Nominal Value',
  ControlLower: 'Lower limit',
  ControlUpper: 'Upper limit',
  UnitMeasure: 'Unit of Measure',
  ControlDevice: 'Measurement System / Device',
  ControlActor: 'Minimal Delegation Required',
  Actor: 'Actor',
  MeasurePoints: 'Number of Points',
  ControlFreq: 'Sample Frequency',
  SampleSize: 'Sample size',
  ControlReduction: 'Justification for Control Reduction',
  ControlRemoval: 'Justification for Control Removal',
  ReactionPlan: 'Reaction plan',
  Ratio: 'Ratio',
  ParaDesc: 'Parameter Designation',
  ParaCode: 'Parameter Number',
  RecordSerialNumText: 'Record Metrological Serial Number'
};

// SAP stores several fields as a code, not as the text in the workbook. Codes seen in the
// screen's own requests; unknown values fall back to the text and are reported in the log.
const CODES: Record<string, { column: string; codes: Record<string, string> }> = {
  ProductProcessKey: { column: 'Product or Process', codes: { Product: '1', Process: '2' } },
  CriticalityKey: { column: 'Classification', codes: { 'Safety Critical': 'Y' } },
  ControlTypeKey: { column: 'Control Type', codes: { Qualitative: 'L', Quantitative: 'V' } },
  SubControlType: { column: 'Control Subtype', codes: { Basic: 'BAS' } },
  MPDefinition: { column: 'Measurement Points Definition', codes: { 'Qualitative Mandatory': 'LM' } },
  OperationStepKey: { column: 'Operation process step', codes: { 'In-process': 'P', 'End of process': 'E' } },
  ControlActorKey: { column: 'Minimal Delegation Required', codes: { L1: 'ACTR_001', L2: 'ACTR_002' } },
  MeDossierKey: { column: 'ME Dossier', codes: { ROUTING: 'DOSS_02N' } },
  RecordingCheckKey: { column: 'Execution system', codes: { QDC_SAP: 'QDC_SAP' } }
};

// Same shape as the screen's payload: keys empty, the row belongs to the plan through the changeset.
const EMPTY_ROW: Record<string, string> = {
  CPID: '', Issue: '', Plant: '', ControlID: '', Counter: '', ReferenceID: '', RefIDFilter: '',
  Name: '', IRDescription: '', Description: '', BuildProcessStepNo: '', BPSN: '', OperationNameKey: '',
  OperationName: '', MachineToolingJigKey: '', MachineToolingJig: '', ReferenceMethodKey: '',
  ReferenceMethod: '', CategoryKey: '', Category: '', Active: '', ActiveKey: 'X', Mandatory: '',
  ProductProcessKey: '', ProductProcess: '', ProductProcessName: '', ProductProcessNo: '',
  ProductProcessSourceRef: '', DisplayMode: '', CriticalityKey: '', Criticality: '', ControlTypeKey: '',
  ControlType: '', SubControlType: '', SubControlTypeDesc: '', AcceptCriteria: '', ControlTarget: '',
  ControlTargetInt: '0.00', ControlLower: '', ControlLowerInt: '0.00', ControlUpper: '',
  ControlUpperInt: '0.00', UnitMeasure: '', ControlDeviceKey: '', ControlDevice: '', RecordSerialNumber: '',
  ControlActorKey: '', ControlActor: '', MeasurePoints: '', ControlFreq: '', SampleSize: '', SpcFollowup: '',
  ControlReduction: '', ControlRemoval: '', InspectionPlan: '', ReactionPlan: '', MeDossierKey: '',
  MeDossier: '', RecordingCheckKey: '', RecordingCheck: '', Assign: 'C', DeleteInd: '', KCnT: '',
  QCRStatus: '', STOIDRef: '', Effectivity: '', Standard: '', DSDrawing: '', ToleranceID: '',
  TargetMax: '', TargetMin: '', FirstOfGroup: '', DraftCtrDBKey: '', AssignedQCProducts: '',
  ControlFlow: '', DrillState: '', HLevel: '', PNode: '', UnAssign: '', Node: '', TotalIR: '',
  TotalQC: '', TotalKCnTQC: '', RecordSerialNumText: '', ProgramKey: '', ProgramDesc: '', EnableUoM: '',
  WorkingLanguage: 'EN', SubConTypeCodeGrp: '', SubConTypeCatalog: '1', Ratio: '', MPDefinition: '',
  MPDefDesc: '', ParaCode: '', CPGridComment: '', ParaCatalog: '', ParaCodeGrp: '', OperationStepKey: '',
  OperationStep: '', Actor: '', ParaDesc: '', MandatoryDesc: ''
};

const CP_ID_PATTERN = /[A-Z0-9]{2,6}_[A-Z]_\d{4}_\d{3,5}/;
const CRLF = '\r\n';

/**
 * The control plan SAP just created: from CP_ID, else the page URL, else the page text.
 * Never falls back to the id in the workbook - that is a different, existing plan.
 */
export async function findControlPlanId(page: Page) {
  if (process.env.CP_ID) return { id: process.env.CP_ID, source: 'the CP_ID variable' };
  const fromUrl = decodeURIComponent(page.url()).match(CP_ID_PATTERN)?.[0];
  if (fromUrl) return { id: fromUrl, source: 'the page URL' };
  const fromPage = (await page.content()).match(CP_ID_PATTERN)?.[0];
  if (fromPage) return { id: fromPage, source: 'the saved page' };
  return { id: '', source: 'nowhere' };
}


export function rowBody(row: Record<string, string>, unknownCodes: string[]) {
  const body: Record<string, unknown> = { ...EMPTY_ROW };
  const value = (column: string) => (row[column] ?? '').trim();

  for (const [field, column] of Object.entries(GRID_MAP)) {
    if (value(column)) body[field] = value(column);
  }
  for (const [field, { column, codes }] of Object.entries(CODES)) {
    const text = value(column);
    if (!text) continue;
    const code = codes[text];
    if (code) body[field] = code;
    else {
      body[field] = text;
      unknownCodes.push(`${field}: no code known for "${text}" (${column})`);
    }
  }
  // Subtype travels as both the code and its code group, as the screen sends it.
  if (body.SubControlType) body.SubConTypeCodeGrp = body.SubControlType;
  body.__metadata = { type: 'Z_1N31_CP_SRV.ETCPIRControls' };
  return body;
}

// One $batch holding one changeset: create the row, then touch the header, exactly like the screen.
export function batchBody(row: Record<string, unknown>, cpId: string, issue: string, token: string, boundary: string, changeset: string) {
  const headerUri = `${ODATA_SERVICE}/ETCPHeaderInfoSet(CPID='${cpId}',Issue='${issue}')`;
  const rowJson = JSON.stringify(row);
  const headerJson = JSON.stringify({
    __metadata: { uri: headerUri, type: 'Z_1N31_CP_SRV.ETCPHeaderInfo' },
    Mode: 'U'
  });
  const common = [
    'sap-contextid-accept: header',
    'Accept: application/json',
    'Accept-Language: en',
    'DataServiceVersion: 2.0',
    'MaxDataServiceVersion: 2.0',
    `x-csrf-token: ${token}`,
    'Content-Type: application/json'
  ];

  return [
    `--${boundary}`,
    `Content-Type: multipart/mixed; boundary=${changeset}`,
    '',
    `--${changeset}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    `POST ETCPIRControlsSet?sap-client=${SAP_CLIENT} HTTP/1.1`,
    ...common,
    `Content-Length: ${Buffer.byteLength(rowJson)}`,
    '',
    rowJson,
    `--${changeset}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    `MERGE ETCPHeaderInfoSet(CPID='${cpId}',Issue='${issue}')?sap-client=${SAP_CLIENT} HTTP/1.1`,
    ...common,
    `Content-Length: ${Buffer.byteLength(headerJson)}`,
    '',
    headerJson,
    `--${changeset}--`,
    '',
    `--${boundary}--`,
    ''
  ].join(CRLF);
}

// A $batch always answers 202; the real outcome is in the parts.
function batchOutcome(text: string) {
  const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) => Number(match[1]));
  const failedStatus = statuses.find((status) => status >= 400);
  if (!failedStatus) return { ok: true, detail: statuses.join(', ') };
  const message = text.match(/"message"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/)?.[1]
    ?? text.match(/<message[^>]*>([^<]+)</)?.[1]
    ?? text.replace(/\s+/g, ' ').slice(0, 400);
  return { ok: false, detail: `HTTP ${failedStatus}: ${message}` };
}

export type GridResult = { sent: number; failed: number };

export async function addGridRows(
  page: Page,
  rows: Record<string, string>[],
  options: { product?: string; issue?: string; cpId?: string } = {}
): Promise<GridResult> {
  if (!rows.length) {
    console.log('GRID: the workbook has no grid rows, nothing to send.');
    return { sent: 0, failed: 0 };
  }

  // A caller that just created the plan knows its id; otherwise read it off the saved page.
  const { id: cpId, source } = options.cpId
    ? { id: options.cpId, source: 'the plan just created' }
    : await findControlPlanId(page);
  const issue = process.env.CP_ISSUE ?? options.issue ?? rows[0]['Issue'] ?? 'A0';
  if (!cpId) {
    throw new Error(
      'Could not find the control plan id SAP created after Save (it was not in the page or its URL). ' +
      'Set CP_ID to the new plan id to send the rows, e.g. CP_ID=AFM1_D_2026_0393.'
    );
  }

  const all = process.env.GRID_ROWS === 'all';
  const toSend = all ? rows : rows.slice(0, 1);
  console.log(`GRID: CPID='${cpId}' Issue='${issue}' (taken from ${source})`);
  console.log(`GRID: sending ${toSend.length} of ${rows.length} row(s)${all ? '' : ' (set GRID_ROWS=all for every row)'}`);

  const token = await fetchCsrfToken(page);
  const unknownCodes: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const [index, row] of toSend.entries()) {
    const label = `row ${index + 1}/${toSend.length} (${row['Control name'] || row['Control ID'] || 'unnamed'})`;
    const stamp = `${Date.now()}-${index}`;
    const boundary = `batch_${stamp}`;
    const changeset = `changeset_${stamp}`;
    const body = batchBody(rowBody(row, unknownCodes), cpId, issue, token, boundary, changeset);

    const response = await page.request.post(`${ODATA_SERVICE}/$batch?sap-client=${SAP_CLIENT}`, {
      headers: {
        'X-CSRF-Token': token,
        'Content-Type': `multipart/mixed;boundary=${boundary}`,
        Accept: 'multipart/mixed',
        DataServiceVersion: '2.0',
        MaxDataServiceVersion: '2.0'
      },
      data: body
    });

    const outcome = batchOutcome(await response.text());
    if (response.ok() && outcome.ok) {
      sent += 1;
      console.log(`GRID OK   ${label}`);
    } else {
      failed += 1;
      console.log(`GRID FAIL ${label} -> ${outcome.detail}`);
      break;
    }
  }

  for (const note of [...new Set(unknownCodes)]) console.log(`GRID NOTE ${note}`);

  // Read the plan back with the screen's own query, so the count is SAP's answer, not ours.
  const filter = encodeURIComponent(`CPID eq '${cpId}' and Issue eq '${issue}'`);
  const check = await page.request.get(
    `${ODATA_SERVICE}/ETCPIRControlsSet?sap-client=${SAP_CLIENT}&$filter=${filter}&$inlinecount=allpages&$top=5`,
    { headers: { Accept: 'application/json' } }
  );
  if (check.ok()) {
    const body = await check.json().catch(() => ({}));
    const results = body?.d?.results ?? [];
    console.log(`GRID: SAP reports ${body?.d?.__count ?? results.length} row(s) in ${cpId}/${issue}. First: ${results[0]?.Name ?? '(none)'}`);
  } else {
    console.log(`GRID: could not read the rows back -> HTTP ${check.status()}`);
  }

  console.log(`GRID: ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}
