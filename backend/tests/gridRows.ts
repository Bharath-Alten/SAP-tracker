import type { Page } from '@playwright/test';

import { ODATA_SERVICE, SAP_CLIENT } from './sapLogin';

// Sends the CP Grid rows to SAP through the OData service the CP screen itself uses
// (POST ETCPIRControlsSet), reusing the session Playwright already signed in with.
//
// By default only the FIRST row is sent, and SAP's answer is printed. Once that works,
// set GRID_ROWS=all to send every row.

// SAP field -> CP Grid column. Left side comes from the captured POST payload,
// right side from the workbook. Add or correct pairs here as we learn the screen.
const GRID_MAP: Record<string, string> = {
  Name: 'Control name',
  Description: 'Activity Description',
  BPSN: 'Process Step',
  OperationName: 'Operation Description',
  MachineToolingJig: 'Machinery (Tools, Device, Jigs, Equipmen',
  ReferenceMethod: 'Control Method',
  AcceptCriteria: 'Acceptance criteria',
  ControlTarget: 'Nominal Value',
  ControlLower: 'Lower limit',
  ControlUpper: 'Upper limit',
  UnitMeasure: 'Unit of Measure',
  ControlDevice: 'Measurement System / Device',
  ControlActor: 'Actor',
  MeasurePoints: 'Number of Points',
  ControlFreq: 'Sample Frequency',
  SampleSize: 'Sample size',
  ControlReduction: 'Justification for Control Reduction',
  ControlRemoval: 'Justification for Control Removal',
  ReactionPlan: 'Reaction plan',
  MeDossier: 'ME Dossier',
  RecordingCheck: 'Record Keeping Means / Data Charts',
  Mandatory: 'Mandatory',
  Criticality: 'Classification',
  ControlType: 'Control Type',
  SubControlTypeDesc: 'Control Subtype',
  ProductProcess: 'Product or Process',
  ProductProcessName: 'Characteristic designation',
  ProductProcessNo: 'Characteristic number',
  ProductProcessSourceRef: 'Characteristic Source Reference',
  ParaDesc: 'Parameter Designation',
  ParaCode: 'Parameter Number',
  Ratio: 'Ratio',
  MPDefDesc: 'Measurement Points Definition',
  RecordSerialNumText: 'Record Metrological Serial Number',
  OperationStep: 'Operation process step'
};

// Every field the SAP screen sends, so the body has the same shape. Values are filled from
// GRID_MAP; the rest stay empty, exactly as the captured request had them.
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
  MeDossier: '', RecordingCheck: '', Assign: 'C', DeleteInd: '', KCnT: '', QCRStatus: '', STOIDRef: '',
  Effectivity: '', Standard: '', DSDrawing: '', ToleranceID: '', TargetMax: '', TargetMin: '',
  FirstOfGroup: '', DraftCtrDBKey: '', AssignedQCProducts: '', ControlFlow: '', DrillState: '', HLevel: '',
  PNode: '', UnAssign: '', Node: '', TotalIR: '', TotalQC: '', TotalKCnTQC: '', RecordSerialNumText: '',
  ProgramKey: '', ProgramDesc: '', EnableUoM: '', WorkingLanguage: 'EN', SubConTypeCodeGrp: '',
  SubConTypeCatalog: '', Ratio: '', MPDefinition: '', MPDefDesc: '', ParaCode: '', CPGridComment: '',
  ParaCatalog: '', ParaCodeGrp: '', OperationStepKey: '', OperationStep: '', Actor: '', ParaDesc: '',
  MandatoryDesc: ''
};

const CP_ID_PATTERN = /[A-Z0-9]{2,6}_[A-Z]_\d{4}_\d{3,5}/;

/**
 * The control plan SAP just created: from CP_ID, else the page URL, else the page text.
 * Never falls back to the id in the workbook — that is a different, existing plan, and
 * writing rows into it would corrupt real data.
 */
export async function findControlPlanId(page: Page) {
  if (process.env.CP_ID) return { id: process.env.CP_ID, source: 'the CP_ID variable' };
  const fromUrl = decodeURIComponent(page.url()).match(CP_ID_PATTERN)?.[0];
  if (fromUrl) return { id: fromUrl, source: 'the page URL' };
  const fromPage = (await page.content()).match(CP_ID_PATTERN)?.[0];
  if (fromPage) return { id: fromPage, source: 'the saved page' };
  return { id: '', source: 'nowhere' };
}

async function csrfToken(page: Page) {
  const response = await page.request.get(`${ODATA_SERVICE}/?sap-client=${SAP_CLIENT}`, {
    headers: { 'X-CSRF-Token': 'Fetch', Accept: 'application/json' }
  });
  const token = response.headers()['x-csrf-token'];
  if (!token) throw new Error(`Could not get a CSRF token from SAP (HTTP ${response.status()}).`);
  return token;
}

function bodyForRow(row: Record<string, string>, cpId: string, issue: string, product: string) {
  const body: Record<string, unknown> = { ...EMPTY_ROW, CPID: cpId, Issue: issue, AssignedQCProducts: product };
  for (const [sapField, column] of Object.entries(GRID_MAP)) {
    const value = (row[column] ?? '').trim();
    if (value && value !== '-') body[sapField] = value;
  }
  body.__metadata = { type: 'Z_1N31_CP_SRV.ETCPIRControls' };
  return body;
}

export type GridResult = { sent: number; failed: number };

export async function addGridRows(
  page: Page,
  rows: Record<string, string>[],
  options: { product?: string; issue?: string } = {}
): Promise<GridResult> {
  if (!rows.length) {
    console.log('GRID: the workbook has no grid rows, nothing to send.');
    return { sent: 0, failed: 0 };
  }

  const { id: cpId, source } = await findControlPlanId(page);
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
  console.log(`GRID: sending ${toSend.length} of ${rows.length} row(s)${all ? '' : " (set GRID_ROWS=all for every row)"}`);

  const token = await csrfToken(page);
  let sent = 0;
  let failed = 0;

  for (const [index, row] of toSend.entries()) {
    const label = `row ${index + 1}/${toSend.length} (${row['Control name'] || row['Control ID'] || 'unnamed'})`;
    const response = await page.request.post(`${ODATA_SERVICE}/ETCPIRControlsSet?sap-client=${SAP_CLIENT}`, {
      headers: {
        'X-CSRF-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        DataServiceVersion: '2.0',
        MaxDataServiceVersion: '2.0'
      },
      data: bodyForRow(row, cpId, issue, options.product ?? '')
    });

    if (response.ok()) {
      sent += 1;
      console.log(`GRID OK   ${label} -> HTTP ${response.status()}`);
    } else {
      failed += 1;
      // SAP explains exactly what it disliked; print it so the run panel shows the reason.
      const text = (await response.text()).replace(/\s+/g, ' ').slice(0, 600);
      console.log(`GRID FAIL ${label} -> HTTP ${response.status()}: ${text}`);
      break;
    }
  }

  console.log(`GRID: ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}
