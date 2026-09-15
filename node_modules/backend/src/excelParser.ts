import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

import { buildSheetLayout } from './sheetLayout.js';
import type { ParsedWorkbook, SheetLayout, SheetRow } from './types.js';

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

export function parseCsvFile(filePath: string, fileName: string): ParsedWorkbook {
  const file = fs.readFileSync(filePath, 'utf8');
  const rows = file
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    throw new Error('CSV file is empty.');
  }

  const headers = parseCsvLine(rows[0]).map((header) => header.replace(/^"|"$/g, '').trim());
  const data = rows.slice(1).map((row) => {
    const values = parseCsvLine(row);
    return headers.reduce((acc, header, index) => {
      acc[header] = (values[index] ?? '').replace(/^"|"$/g, '').trim();
      return acc;
    }, {} as Record<string, string>);
  });

  return {
    fileName,
    sheetNames: ['Sheet1'],
    sheets: {
      Sheet1: data as SheetRow[]
    },
    summary: {
      totalRows: data.length,
      totalSheets: 1,
      sheetCounts: { Sheet1: data.length }
    }
  };
}

function normalizeSheetRows(rows: unknown[][]): SheetRow[] {
  if (!rows.length) {
    return [];
  }
  // detect if the first row is a header row:
  // require that a reasonable number of columns in the first row are non-empty
  const firstRow = rows[0] ?? [];
  const maxColumns = Math.max(...rows.map((row) => row.length));

  const nonEmptyInFirst = firstRow.filter((cell) => cell !== undefined && cell !== null && String(cell).trim() !== '').length;
  // consider it a header only if at least half the columns (or at least 2) are non-empty
  const headerPresent = nonEmptyInFirst >= Math.max(2, Math.ceil(maxColumns / 2));

  if (headerPresent) {
    const headers = firstRow.map((cell, i) => {
      let raw = cell === undefined || cell === null ? '' : String(cell).trim();
      // sanitize header: collapse whitespace and remove newlines
      raw = raw.replace(/\s+/g, ' ').replace(/\r?\n/g, ' ').trim();
      return raw === '' ? `C${i + 1}` : raw;
    });

    // map remaining rows using the header names
    const dataRows = rows.slice(1);
    return dataRows.map((row, rowIndex) => {
      const normalized: Record<string, string | number | boolean | null> = {
        __row: rowIndex + 2 // original worksheet row number (1-based), +1 for header
      };

      for (let index = 0; index < headers.length; index += 1) {
        const value = row[index];
        const key = headers[index];

        if (value === undefined || value === null || value === '') {
          normalized[key] = null;
          continue;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          normalized[key] = value;
        } else {
          normalized[key] = String(value);
        }
      }

      return normalized;
    });
  }

  
  return rows.map((row, rowIndex) => {
    const normalized: Record<string, string | number | boolean | null> = {
      __row: rowIndex + 1
    };

    for (let index = 0; index < maxColumns; index += 1) {
      const value = row[index];
      const key = `C${index + 1}`;

      if (value === undefined || value === null) {
        normalized[key] = null;
        continue;
      }

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        normalized[key] = value;
      } else {
        normalized[key] = String(value);
      }
    }

    return normalized;
  });
}

export function parseWorkbook(filePath: string, fileName: string): ParsedWorkbook {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === '.csv') {
    return parseCsvFile(filePath, fileName);
  }

  const fileBuffer = fs.readFileSync(filePath);
  // cellStyles lets sheetLayout recognise section headings by their fill colour.
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellStyles: true });
  const sheetNames = workbook.SheetNames;

  const sheets: Record<string, SheetRow[]> = {};
  const layouts: Record<string, SheetLayout> = {};
  const sheetCounts: Record<string, number> = {};

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, blankrows: false, defval: '' }) as unknown[][];
    const normalizedRows = normalizeSheetRows(rows);

    sheets[sheetName] = normalizedRows;
    sheetCounts[sheetName] = normalizedRows.length;

    // Only sheets without a header row are document-style (a header row starts data at __row 2).
    if (normalizedRows[0]?.__row === 1) {
      const layout = buildSheetLayout(worksheet, rows);
      if (layout) layouts[sheetName] = layout;
    }
  }

  const totalRows = Object.values(sheetCounts).reduce((sum, count) => sum + count, 0);

  return {
    fileName,
    sheetNames,
    sheets,
    layouts,
    summary: {
      totalRows,
      totalSheets: sheetNames.length,
      sheetCounts
    }
  };
}
