export type SheetRow = Record<string, string | number | boolean | null>;

// Points at one cell of ParsedWorkbook.sheets[sheet]: row index into the array, column key in that row.
export type CellRef = { row: number; key: string };

export type LayoutItem =
  | { type: 'field'; label: string; cell: CellRef; hint?: string }
  | { type: 'choice'; label: string; options: { label: string; cell: CellRef }[] }
  | { type: 'table'; columns: { key: string; label: string }[]; rows: number[] }
  | { type: 'note'; text: string };

export type LayoutSection = { title: string; items: LayoutItem[] };

// Form-style description of a sheet laid out like a document (e.g. CP Front Page).
export type SheetLayout = { title?: string; sections: LayoutSection[] };

export type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, SheetRow[]>;
  layouts?: Record<string, SheetLayout>;
  summary: {
    totalRows: number;
    totalSheets: number;
    sheetCounts: Record<string, number>;
  };
};

export type AutomationProgressEvent = {
  type: 'status' | 'log' | 'error' | 'result';
  step?: string;
  message?: string;
  timestamp?: string;
  success?: boolean;
  data?: Record<string, unknown>;
};

export type AutomationRunRequest = {
  fileName?: string;
  parsedData?: ParsedWorkbook;
};
