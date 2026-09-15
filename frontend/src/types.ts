export type WorkbookRow = Record<string, string | number | boolean | null>;

// Mirrors backend/src/types.ts
export type CellRef = { row: number; key: string };

export type LayoutItem =
  | { type: 'field'; label: string; cell: CellRef; hint?: string }
  | { type: 'choice'; label: string; options: { label: string; cell: CellRef }[] }
  | { type: 'table'; columns: { key: string; label: string }[]; rows: number[] }
  | { type: 'note'; text: string };

export type LayoutSection = { title: string; items: LayoutItem[] };

export type SheetLayout = { title?: string; sections: LayoutSection[] };

export type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, WorkbookRow[]>;
  layouts?: Record<string, SheetLayout>;
  summary: {
    totalRows: number;
    totalSheets: number;
    sheetCounts: Record<string, number>;
  };
};

export type LogEvent = {
  type: 'status' | 'log' | 'error' | 'result';
  step?: string;
  message?: string;
  timestamp?: string;
  success?: boolean;
};
