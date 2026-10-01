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
    // Workbooks vary in case ("Basic" / "basic"), so match the code list loosely.
    const match = Object.keys(codes).find((key) => key.toLowerCase() === text.toLowerCase());
    const code = match ? codes[match] : undefined;
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

// One $batch carrying several rows: each row gets its own changeset, so SAP accepts or
// refuses them independently - one bad row no longer takes the others down with it.
function batchBodyForRows(rows: Record<string, unknown>[], cpId: string, issue: string, token: string, boundary: string) {
  const headerUri = `${ODATA_SERVICE}/ETCPHeaderInfoSet(CPID='${cpId}',Issue='${issue}')`;
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

  const lines: string[] = [];
  rows.forEach((row, index) => {
    const changeset = `changeset_${index}_${Date.now()}`;
    const rowJson = JSON.stringify(row);
    lines.push(
      `--${boundary}`,
      `Content-Type: multipart/mixed; boundary=${changeset}`,
      '',
      `--${changeset}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      `Content-ID: ${index * 2 + 1}`,
      '',
      `POST ETCPIRControlsSet?sap-client=${SAP_CLIENT} HTTP/1.1`,
      ...common,
      `Content-Length: ${Buffer.byteLength(rowJson)}`,
      '',
      rowJson,
      `--${changeset}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      `Content-ID: ${index * 2 + 2}`,
      '',
      `MERGE ETCPHeaderInfoSet(CPID='${cpId}',Issue='${issue}')?sap-client=${SAP_CLIENT} HTTP/1.1`,
      ...common,
      `Content-Length: ${Buffer.byteLength(headerJson)}`,
      '',
      headerJson,
      `--${changeset}--`,
      ''
    );
  });
  lines.push(`--${boundary}--`, '');
  return lines.join(CRLF);
}

/** The response parts, one per changeset, in the order they were sent. */
function splitBatchParts(text: string, contentType?: string) {
  const boundary = contentType?.match(/boundary=([^;]+)/)?.[1]?.trim().replace(/^"|"$/g, '');
  if (!boundary) return [text];
  return text
    .split(`--${boundary}`)
    .slice(1)
    .filter((part) => part.trim() && part.trim() !== '--');
}

// A $batch always answers 202; the real outcome is in the parts.
function batchOutcome(text: string) {
  // SAP can answer 201 Created and still refuse the row: the verdict is then in a
  // sap-message header with severity "error" (same trick as a duplicate plan name).
  const sapMessage = [...text.matchAll(/sap-message:\s*(\{.*?\})\s*$/gm)]
    .map((match) => match[1])
    .find((raw) => /"severity"\s*:\s*"error"/.test(raw));
  if (sapMessage) {
    const reason = sapMessage.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? sapMessage;
    return { ok: false, detail: `SAP refused it: ${reason}` };
  }

  const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) => Number(match[1]));
  const failedStatus = statuses.find((status) => status >= 400);
  if (!failedStatus) return { ok: true, detail: statuses.join(', ') };
  const message = text.match(/"message"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/)?.[1]
    ?? text.match(/<message[^>]*>([^<]+)</)?.[1]
    ?? text.replace(/\s+/g, ' ').slice(0, 800);
  return { ok: false, detail: `HTTP ${failedStatus}: ${message}` };
}

/** Control names already in the plan, so a second run does not duplicate them. */
async function existingControlNames(page: Page, cpId: string, issue: string) {
  const filter = encodeURIComponent(`CPID eq '${cpId}' and Issue eq '${issue}'`);
  const response = await page.request.get(
    `${ODATA_SERVICE}/ETCPIRControlsSet?sap-client=${SAP_CLIENT}&$filter=${filter}&$select=Name&$top=5000&$format=json`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok()) {
    console.log(`GRID: could not read the plan's rows (HTTP ${response.status()}); sending every row.`);
    return new Set<string>();
  }
  const results = await response.json().then((body) => body?.d?.results ?? []).catch(() => []);
  return new Set<string>(results.map((row: Record<string, string>) => (row.Name ?? '').trim()).filter(Boolean));
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

  console.log(`GRID: CPID='${cpId}' Issue='${issue}' (taken from ${source})`);

  // A plan that already holds a control keeps it: re-running must not double the rows.
  // Set GRID_DUPLICATES=allow to send every row regardless.
  let candidates = rows;
  if (process.env.GRID_DUPLICATES !== 'allow') {
    const already = await existingControlNames(page, cpId, issue);
    if (already.size) {
      candidates = rows.filter((row) => !already.has((row['Control name'] ?? '').trim()));
      console.log(`GRID: the plan already holds ${already.size} control(s); ${rows.length - candidates.length} workbook row(s) are already there.`);
    }
  }

  if (!candidates.length) {
    console.log('GRID: every row of the workbook is already in the plan, nothing to add.');
    return { sent: 0, failed: 0 };
  }

  const all = process.env.GRID_ROWS === 'all';
  const toSend = all ? candidates : candidates.slice(0, 1);
  console.log(`GRID: sending ${toSend.length} of ${candidates.length} row(s)${all ? '' : ' (set GRID_ROWS=all for every row)'}`);

  // The workbook template changes over time: a renamed column would silently stop filling its
  // SAP field, and a new column would go unnoticed. Say so once, before anything is sent.
  const columnsInFile = new Set(Object.keys(rows[0] ?? {}));
  const columnsUsed = new Set([
    ...Object.values(GRID_MAP),
    ...Object.values(CODES).map((entry) => entry.column),
    'Control name',
    'Control ID',
    'Issue',
    'Control plan ID'
  ]);
  const missing = [...columnsUsed].filter((column) => !columnsInFile.has(column));
  const extra = [...columnsInFile].filter((column) => !columnsUsed.has(column) && !/^C\d+$/.test(column));
  if (missing.length) console.log(`GRID COLUMNS: not in this workbook, so left empty in SAP: ${missing.join(', ')}`);
  if (extra.length) console.log(`GRID COLUMNS: in the workbook but not sent to SAP: ${extra.join(', ')}`);

  const token = await fetchCsrfToken(page);
  const unknownCodes: string[] = [];

  // Rows travel in groups: fewer round trips, and each row still answers for itself.
  // One row per request by default. SAP accepted only the first changeset when several
  // travelled together (the rest came back 500), so grouping stays opt-in: GRID_BATCH_SIZE.
  const groupSize = Math.max(1, Number(process.env.GRID_BATCH_SIZE ?? 1));
  const refusals: { label: string; reason: string }[] = [];
  const alreadyThere: string[] = [];
  let sent = 0;

  for (let start = 0; start < toSend.length; start += groupSize) {
    const group = toSend.slice(start, start + groupSize);
    const boundary = `batch_${Date.now()}_${start}`;
    const bodies = group.map((row) => rowBody(row, unknownCodes));

    const response = await page.request.post(`${ODATA_SERVICE}/$batch?sap-client=${SAP_CLIENT}`, {
      headers: {
        'X-CSRF-Token': token,
        'Content-Type': `multipart/mixed;boundary=${boundary}`,
        Accept: 'multipart/mixed',
        DataServiceVersion: '2.0',
        MaxDataServiceVersion: '2.0'
      },
      data: batchBodyForRows(bodies, cpId, issue, token, boundary)
    });

    const answer = await response.text();
    const parts = splitBatchParts(answer, response.headers()['content-type']);

    group.forEach((row, offset) => {
      const label = `row ${start + offset + 1}/${toSend.length} (${row['Control name'] || row['Control ID'] || 'unnamed'})`;
      const part = parts[offset];
      const outcome = part
        ? batchOutcome(part)
        : {
            ok: false,
            detail: response.ok()
              ? 'SAP sent no answer for this row.'
              : `HTTP ${response.status()} ${response.statusText()}: ${answer.replace(/\s+/g, ' ').slice(0, 800) || '(empty response)'}`
          };

      if (outcome.ok) {
        sent += 1;
        console.log(`GRID OK   ${label}`);
      } else if (/duplicat/i.test(outcome.detail)) {
        // SAP keeps control names unique per plant. The control is already there, which is
        // the same situation as a plan that already exists: keep it and carry on.
        alreadyThere.push(label);
        console.log(`GRID SKIP ${label} -> already in plant ${process.env.CP_PLANT ?? 'AFM1'}, left as it is`);
      } else {
        // Carry on with the rest: one refused row must not cost the other rows.
        refusals.push({ label, reason: outcome.detail });
        console.log(`GRID FAIL ${label} -> ${outcome.detail}`);
      }
    });
  }

  const failed = refusals.length;

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

  console.log(
    `GRID: ${sent} added, ${alreadyThere.length} already there, ${failed} refused, out of ${toSend.length} row(s) sent.`
  );

  if (failed) {
    // Group the refusals: thirteen rows usually share one reason, and that reason is the fix.
    const byReason = new Map<string, string[]>();
    for (const { label, reason } of refusals) {
      // "Duplicated control name X in plant AFM1" -> one group, not one per control name.
      const key = reason.replace(/name\s+\S+/i, 'name <name>');
      byReason.set(key, [...(byReason.get(key) ?? []), label]);
    }
    for (const [reason, labels] of byReason) {
      console.log(`GRID REASON (${labels.length} row(s)): ${reason}`);
      console.log(`GRID        ${labels.slice(0, 5).join(', ')}${labels.length > 5 ? `, +${labels.length - 5} more` : ''}`);
    }
    const summary = [...byReason.keys()][0] ?? 'see the GRID FAIL lines above';
    throw new Error(`${failed} of ${toSend.length} grid row(s) refused by SAP (${sent} added). First reason: ${summary}`);
  }

  return { sent, failed };
}
