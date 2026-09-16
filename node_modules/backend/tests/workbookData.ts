import fs from 'fs';
import path from 'path';

// Gives tests the values of the workbook that was imported in the app.
//
//   import { getFormFields, getGridRows } from './workbookData';
//   const form = getFormFields();
//   await page.fill('#someField', form['Control Plan Number']);
//
// When the app starts a run it writes the edited workbook to a JSON file and passes its path in
// WORKBOOK_DATA_PATH. Running the spec from a terminal instead falls back to the most recent run.

type Row = Record<string, string | number | boolean | null>;
type CellRef = { row: number; key: string };
type LayoutItem =
  | { type: 'field'; label: string; cell: CellRef; hint?: string }
  | { type: 'choice'; label: string; options: { label: string; cell: CellRef }[] }
  | { type: 'table'; columns: { key: string; label: string }[]; rows: number[] }
  | { type: 'note'; text: string };
type Workbook = {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, Row[]>;
  layouts?: Record<string, { title?: string; sections: { title: string; items: LayoutItem[] }[] }>;
};

const FORM_SHEETS = ['cp front page', 'front page'];
const GRID_SHEETS = ['cp grid (tool)', 'cp grid', 'grid'];
// Works whether the spec is started from the backend folder or from the project root.
const artifactsDirs = [
  path.join(process.cwd(), 'uploads', 'artifacts'),
  path.join(process.cwd(), 'backend', 'uploads', 'artifacts')
];

function text(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function latestRunFile() {
  const files = artifactsDirs
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => fs.readdirSync(dir).map((run) => path.join(dir, run, 'workbook-data.json')))
    .filter((file) => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

export function loadWorkbook(): Workbook {
  const file = process.env.WORKBOOK_DATA_PATH || latestRunFile();
  if (!file) {
    throw new Error('No workbook data found. Import a file in the app and click Run automation, or set WORKBOOK_DATA_PATH.');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Workbook;
}

function findSheet(workbook: Workbook, names: string[]) {
  return workbook.sheetNames.find((sheet) => names.includes(sheet.trim().toLowerCase()))
    ?? workbook.sheetNames.find((sheet) => names.some((name) => sheet.trim().toLowerCase().includes(name)));
}

/**
 * Every value of the first sheet (CP Front Page) by its label, e.g.
 * { 'Control Plan Number': 'CP_MOB...', 'Issue': 'A0', 'Status': 'In Progress', 'ME': 'Wengel Yohannes' }
 * Section names are also available as prefixed keys: 'Control Plan Identification · Issue'.
 */
export function getFormFields(workbook: Workbook = loadWorkbook()): Record<string, string> {
  const sheetName = findSheet(workbook, FORM_SHEETS) ?? workbook.sheetNames[0];
  const rows = workbook.sheets[sheetName] ?? [];
  const fields: Record<string, string> = {};
  const set = (label: string, value: string, section?: string) => {
    if (!label) return;
    if (!(label in fields)) fields[label] = value;
    if (section) fields[`${section} · ${label}`] = value;
  };

  const layout = workbook.layouts?.[sheetName];
  if (layout) {
    for (const section of layout.sections) {
      for (const item of section.items) {
        if (item.type === 'field') {
          set(item.label, text(rows[item.cell.row]?.[item.cell.key]), section.title);
        } else if (item.type === 'choice') {
          const chosen = item.options.find((option) => /^x$/i.test(text(rows[option.cell.row]?.[option.cell.key])));
          set(item.label, chosen?.label ?? '', section.title);
        } else if (item.type === 'table') {
          // First row of a table (e.g. the latest revision): its columns become fields too.
          const first = item.rows[0];
          if (first !== undefined) {
            for (const column of item.columns) set(column.label, text(rows[first]?.[column.key]), section.title);
          }
        }
      }
    }
    return fields;
  }

  // Fallback for workbooks without detected sections: "Label :" followed by its value.
  for (const row of rows) {
    const values = Object.entries(row).filter(([key]) => key !== '__row').map(([, value]) => text(value)).filter(Boolean);
    const [label, value] = values;
    if (label?.endsWith(':')) set(label.replace(/\s*:\s*$/, ''), value ?? '');
  }
  return fields;
}

/** One entry per row of the second sheet (CP Grid), keyed by column name. */
export function getGridRows(workbook: Workbook = loadWorkbook()): Record<string, string>[] {
  const sheetName = findSheet(workbook, GRID_SHEETS) ?? workbook.sheetNames[1];
  return (workbook.sheets[sheetName] ?? []).map((row) => {
    const entry: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) if (key !== '__row') entry[key] = text(value);
    return entry;
  });
}

/** Same as getFormFields()[label] but fails with a clear message when the field is missing or empty. */
export function requireField(label: string, workbook: Workbook = loadWorkbook()): string {
  const value = getFormFields(workbook)[label];
  if (!value) throw new Error(`Field "${label}" is empty or missing in the imported workbook.`);
  return value;
}
