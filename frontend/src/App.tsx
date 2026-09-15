import { ChangeEvent, DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import type { LayoutItem, LogEvent, ParsedWorkbook, WorkbookRow } from './types';

const API_BASE = '/api';
type Stage = 'Import' | 'Data';
type DataTab = 'header' | 'grid';
type Sheets = Record<string, WorkbookRow[]>;
type Notice = { tone: 'success' | 'error'; text: string };
type RunResult = { success: boolean; message: string; summary?: Record<string, unknown>; snapshotUrl?: string };
type RunHistoryEntry = { id: number; time: string; state: 'success' | 'failed'; detail: string };

const preferredSheets = ['CP Front Page', 'CP Grid (Tool)', 'CP Grid'];
const HEADER_ROW_LIMIT = 36;
const X_MARK = /^x$/i;
const POLL_INTERVAL_MS = 1200;
const MAX_POLL_FAILURES = 5;

// User-facing automation phases. A phase is reached when a non-error log step contains one of its keywords
// (step names come from backend/src/index.ts and backend/src/playwright/mockAutomation.ts).
const RUN_PHASES = [
  { label: 'Prepare data', keywords: ['snapshot', 'file uploaded', 'excel data'] },
  { label: 'Read sheets', keywords: ['front page', 'grid data'] },
  { label: 'Browser & login', keywords: ['navigation', 'credentials', 'login'] },
  { label: 'Enter data', keywords: ['artifact', 'demo actions', 'rows added', 'created'] },
  { label: 'Finish', keywords: [] as string[] }
];

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
}

function cellText(value: string | number | boolean | null | undefined) {
  return value === null || value === undefined ? '' : String(value);
}

function tagForLog(entry: LogEvent) {
  if (entry.type === 'error') return 'ERR';
  if (entry.type === 'status') return 'OK';
  return 'RUN';
}

function errorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) return error.response?.data?.error ?? error.message;
  return error instanceof Error ? error.message : fallback;
}

function cloneSheets(sheets: Sheets): Sheets {
  return JSON.parse(JSON.stringify(sheets)) as Sheets;
}

function isChanged(original: WorkbookRow | undefined, current: WorkbookRow, column: string) {
  return cellText(original?.[column]) !== cellText(current[column]);
}

function countChanges(base: Sheets | null | undefined, current: Sheets | null) {
  if (!base || !current) return 0;
  let count = 0;
  for (const [sheet, rows] of Object.entries(current)) {
    const baseRows = base[sheet] ?? [];
    rows.forEach((row, rowIndex) => {
      for (const column of Object.keys(row)) {
        if (column !== '__row' && isChanged(baseRows[rowIndex], row, column)) count += 1;
      }
    });
  }
  return count;
}

function phasesReached(logs: LogEvent[]) {
  let reached = 0;
  for (const entry of logs) {
    if (entry.type === 'error') continue;
    const step = (entry.step ?? '').toLowerCase();
    RUN_PHASES.forEach((phase, index) => {
      if (phase.keywords.some((keyword) => step.includes(keyword))) reached = Math.max(reached, index + 1);
    });
  }
  return Math.min(reached, RUN_PHASES.length - 1);
}

function humanizeKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
}

type GridRowProps = {
  row: WorkbookRow;
  original?: WorkbookRow;
  rowIndex: number;
  columns: string[];
  onEdit: (rowIndex: number, column: string, value: string) => void;
};

// Memoised so editing one cell only re-renders its own row, which keeps large grids responsive.
const GridRow = memo(function GridRow({ row, original, rowIndex, columns, onEdit }: GridRowProps) {
  return (
    <tr>
      <td className="row-number">{row.__row ?? rowIndex + 1}</td>
      {columns.map((column) => (
        <td className={isChanged(original, row, column) ? 'modified-cell' : ''} key={column}>
          <input
            value={cellText(row[column])}
            onChange={(event) => onEdit(rowIndex, column, event.target.value)}
            aria-label={`${column}, row ${rowIndex + 1}`}
          />
        </td>
      ))}
    </tr>
  );
});

function App() {
  const [parsedData, setParsedData] = useState<ParsedWorkbook | null>(null);
  const [importedSheets, setImportedSheets] = useState<Sheets | null>(null);
  const [editedSheets, setEditedSheets] = useState<Sheets | null>(null);
  const [activeStage, setActiveStage] = useState<Stage>('Import');
  const [dataTab, setDataTab] = useState<DataTab>('header');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [runNumber, setRunNumber] = useState(0);
  const [runEditedCells, setRunEditedCells] = useState(0);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [showAbout, setShowAbout] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const pollFailuresRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const stopPolling = () => {
    if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  // Keep the newest log line in view without scrolling the rest of the drawer.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs.length, drawerOpen]);

  const dataSheets = useMemo(() => {
    if (!parsedData) return [];
    const preferred = preferredSheets.filter((sheet) => parsedData.sheetNames.includes(sheet));
    const fallback = parsedData.sheetNames.filter((sheet) => !preferred.includes(sheet));
    return [...preferred, ...fallback].slice(0, 2);
  }, [parsedData]);

  const headerSheet = dataSheets[0] ?? null;
  const gridSheet = dataSheets[1] ?? null;
  const headerRows = headerSheet && editedSheets ? editedSheets[headerSheet] ?? [] : [];
  const gridRows = gridSheet && editedSheets ? editedSheets[gridSheet] ?? [] : [];
  const originalHeaderRows = headerSheet && importedSheets ? importedSheets[headerSheet] ?? [] : [];
  const originalGridRows = gridSheet && importedSheets ? importedSheets[gridSheet] ?? [] : [];

  // Columns and header layout come from the imported workbook so they stay stable while the user edits
  // (clearing a value must not make its field disappear).
  const gridColumns = useMemo(
    () => (originalGridRows[0] ? Object.keys(originalGridRows[0]).filter((column) => column !== '__row') : []),
    [originalGridRows]
  );
  // Sectioned form built by the backend (backend/src/sheetLayout.ts); falls back to row-by-row fields.
  const sheetLayout = headerSheet ? parsedData?.layouts?.[headerSheet] : undefined;
  const headerFallbackRows = useMemo(() => originalHeaderRows.slice(0, HEADER_ROW_LIMIT).map((row, rowIndex) => ({
    rowIndex,
    columns: Object.entries(row)
      .filter(([column, value]) => column !== '__row' && cellText(value).trim() !== '')
      .map(([column]) => column)
  })).filter((row) => row.columns.length > 0), [originalHeaderRows]);

  const editedCellCount = useMemo(() => countChanges(importedSheets, editedSheets), [importedSheets, editedSheets]);
  const unsavedCount = useMemo(() => countChanges(parsedData?.sheets, editedSheets), [parsedData, editedSheets]);

  const updateCell = useCallback((sheet: string, rowIndex: number, column: string, value: string) => {
    setEditedSheets((current) => current && {
      ...current,
      [sheet]: current[sheet].map((row, index) => index === rowIndex ? { ...row, [column]: value } : row)
    });
    setNotice(null);
  }, []);

  const editGridCell = useCallback((rowIndex: number, column: string, value: string) => {
    if (gridSheet) updateCell(gridSheet, rowIndex, column, value);
  }, [gridSheet, updateCell]);

  const selectedOption = (rows: WorkbookRow[], item: Extract<LayoutItem, { type: 'choice' }>) =>
    item.options.findIndex((option) => X_MARK.test(cellText(rows[option.cell.row]?.[option.cell.key]).trim()));

  // Choice lists are stored as an X next to the chosen option, exactly like the workbook.
  const selectOption = (sheet: string, item: Extract<LayoutItem, { type: 'choice' }>, chosen: number) => {
    setEditedSheets((current) => {
      if (!current) return current;
      const rows = current[sheet].slice();
      item.options.forEach((option, index) => {
        rows[option.cell.row] = { ...rows[option.cell.row], [option.cell.key]: index === chosen ? 'X' : '' };
      });
      return { ...current, [sheet]: rows };
    });
    setNotice(null);
  };

  const renderLayoutItem = (sheet: string, item: LayoutItem, key: string) => {
    if (item.type === 'note') return <p className="form-note" key={key}>{item.text}</p>;

    if (item.type === 'choice') {
      const selected = selectedOption(headerRows, item);
      const original = selectedOption(originalHeaderRows, item);
      const changed = selected !== original;
      return (
        <div className="header-data-row" key={key}>
          <span className="header-label">{item.label}</span>
          <div className="header-values">
            <label className={`form-field compact ${changed ? 'changed' : ''}`}>
              <select value={selected} onChange={(event) => selectOption(sheet, item, Number(event.target.value))} aria-label={item.label}>
                {selected === -1 && <option value={-1}>Not set</option>}
                {item.options.map((option, index) => <option value={index} key={option.label}>{option.label}</option>)}
              </select>
              {changed && (
                <small>
                  Changed · used by automation
                  <button type="button" className="revert-link" onClick={() => selectOption(sheet, item, original)}>revert</button>
                </small>
              )}
            </label>
          </div>
        </div>
      );
    }

    if (item.type === 'table') {
      return (
        <div className="form-table-scroll" key={key}>
          <table className="prototype-grid form-table">
            <thead>
              <tr>{item.columns.map((column) => <th key={column.key} title={column.label}>{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {item.rows.map((rowIndex) => (
                <tr key={rowIndex}>
                  {item.columns.map((column) => (
                    <td className={isChanged(originalHeaderRows[rowIndex], headerRows[rowIndex], column.key) ? 'modified-cell' : ''} key={column.key}>
                      <input
                        value={cellText(headerRows[rowIndex]?.[column.key])}
                        onChange={(event) => updateCell(sheet, rowIndex, column.key, event.target.value)}
                        aria-label={column.label}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    const { row, key: column } = item.cell;
    const current = headerRows[row];
    const changed = current ? isChanged(originalHeaderRows[row], current, column) : false;
    return (
      <div className="header-data-row" key={key}>
        <span className="header-label">{item.label}</span>
        <div className="header-values">
          <label className={`form-field compact ${changed ? 'changed' : ''}`}>
            <input value={cellText(current?.[column])} onChange={(event) => updateCell(sheet, row, column, event.target.value)} aria-label={item.label} />
            {(changed || item.hint) && (
              <small>
                {changed ? (
                  <>
                    Changed · used by automation
                    <button type="button" className="revert-link" onClick={() => updateCell(sheet, row, column, cellText(originalHeaderRows[row]?.[column]))}>revert</button>
                  </>
                ) : item.hint}
              </small>
            )}
          </label>
        </div>
      </div>
    );
  };

  const reset = () => {
    if (editedCellCount > 0 && !window.confirm('Discard the loaded workbook and your edits?')) return;
    stopPolling();
    activeJobRef.current = null;
    setParsedData(null);
    setImportedSheets(null);
    setEditedSheets(null);
    setActiveStage('Import');
    setDataTab('header');
    setImportError(null);
    setNotice(null);
    setLogs([]);
    setIsRunning(false);
    setResult(null);
    setDrawerOpen(false);
  };

  const importFile = async (selectedFile: File) => {
    setImportError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const response = await axios.post(`${API_BASE}/upload`, formData);
      const data = response.data as ParsedWorkbook;
      setParsedData(data);
      setImportedSheets(cloneSheets(data.sheets));
      setEditedSheets(cloneSheets(data.sheets));
      setLogs([]);
      setResult(null);
      setDrawerOpen(false);
      setDataTab('header');
      setActiveStage('Data');
      setNotice(data.sheetNames.length < 2
        ? { tone: 'error', text: 'This workbook has only one sheet. A Header sheet and a Grid sheet are required to run automation.' }
        : null);
    } catch (error) {
      setImportError(errorMessage(error, 'Upload failed'));
    } finally {
      setIsUploading(false);
      setIsDragging(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = '';
    if (selectedFile) await importFile(selectedFile);
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const selectedFile = event.dataTransfer.files?.[0];
    if (selectedFile) await importFile(selectedFile);
  };

  const saveChanges = async () => {
    if (!parsedData || !editedSheets || isSaving) return;
    setIsSaving(true);
    try {
      await axios.post(`${API_BASE}/workbook/save`, { ...parsedData, sheets: editedSheets });
      setParsedData({ ...parsedData, sheets: editedSheets });
      setNotice({ tone: 'success', text: 'Changes saved.' });
    } catch (error) {
      setNotice({ tone: 'error', text: `Save failed: ${errorMessage(error, 'could not save changes')}` });
    } finally {
      setIsSaving(false);
    }
  };

  const finishRun = (runResult: RunResult, runId: number, completedAt?: string) => {
    stopPolling();
    activeJobRef.current = null;
    setResult(runResult);
    setIsRunning(false);
    setRunHistory((current) => [
      { id: runId, time: formatTime(completedAt ?? new Date().toISOString()), state: runResult.success ? 'success' : 'failed', detail: runResult.message },
      ...current
    ]);
  };

  const pollJobStatus = async (jobId: string, runId: number) => {
    try {
      const { data } = await axios.get(`${API_BASE}/automation/status/${jobId}`);
      if (activeJobRef.current !== jobId) return;
      pollFailuresRef.current = 0;
      setLogs(data.logs ?? []);
      if (data.result) {
        finishRun({
          success: Boolean(data.result.success),
          message: data.result.message || 'Automation finished.',
          summary: data.result.summary,
          snapshotUrl: data.artifacts?.snapshot
        }, runId, data.completedAt);
      }
    } catch (error) {
      if (activeJobRef.current !== jobId) return;
      pollFailuresRef.current += 1;
      const notFound = axios.isAxiosError(error) && error.response?.status === 404;
      if (notFound || pollFailuresRef.current >= MAX_POLL_FAILURES) {
        finishRun({
          success: false,
          message: notFound
            ? 'The automation job is no longer available. The server may have restarted.'
            : `Lost contact with the automation service: ${errorMessage(error, 'status check failed')}`
        }, runId);
      }
    }
  };

  const runAutomation = async () => {
    if (!parsedData || !editedSheets || isRunning) return;
    if (dataSheets.length < 2) {
      setNotice({ tone: 'error', text: 'Automation needs a Header sheet and a Grid sheet. Import a workbook that contains both.' });
      return;
    }

    const runId = runNumber + 1;
    setRunNumber(runId);
    setRunEditedCells(editedCellCount);
    setIsRunning(true);
    setResult(null);
    setNotice(null);
    setDrawerOpen(true);
    setLogs([{ type: 'status', step: 'Starting', message: 'Starting automation job...', timestamp: new Date().toISOString() }]);
    pollFailuresRef.current = 0;

    try {
      // The edited sheets (including unsaved edits) are what the automation consumes.
      const response = await axios.post(`${API_BASE}/automation/run`, {
        fileName: parsedData.fileName,
        parsedData: { ...parsedData, sheets: editedSheets }
      });
      const jobId = response.data.jobId as string;
      activeJobRef.current = jobId;
      stopPolling();
      pollIntervalRef.current = window.setInterval(() => void pollJobStatus(jobId, runId), POLL_INTERVAL_MS);
      void pollJobStatus(jobId, runId);
    } catch (error) {
      const message = errorMessage(error, 'Automation failed to start');
      setLogs((current) => [...current, { type: 'error', step: 'Automation failed', message, timestamp: new Date().toISOString() }]);
      finishRun({ success: false, message }, runId);
    }
  };

  const openRunPanel = () => {
    setActiveStage('Data');
    setDrawerOpen(true);
  };

  const reached = phasesReached(logs);
  const runState = isRunning ? 'running' : result?.success ? 'success' : result ? 'failed' : 'idle';
  const progress = result?.success
    ? 100
    : isRunning
      ? Math.max(6, Math.min(92, (reached / RUN_PHASES.length) * 100))
      : result ? (reached / RUN_PHASES.length) * 100 : 0;
  const latestLog = logs[logs.length - 1];
  // 'result' events repeat the final outcome, which the result card already shows.
  const visibleLogs = logs.filter((entry) => entry.type !== 'result');
  const summaryEntries = Object.entries(result?.summary ?? {}).filter(([key]) => key !== 'error');

  const actionStatus = (() => {
    if (notice) return <span className={`status-text ${notice.tone}`}>{notice.text}</span>;
    if (isRunning) return <span className="status-text running"><i className="pulse" />Automation running · {RUN_PHASES[reached].label}</span>;
    if (unsavedCount > 0) return <span className="status-text">{unsavedCount} unsaved change{unsavedCount === 1 ? '' : 's'} · edits are included when you run</span>;
    if (result && !drawerOpen) return <span className={`status-text ${result.success ? 'success' : 'error'}`}>Last run: {result.message}</span>;
    return <span className="status-text">Review the header and grid, then run automation.</span>;
  })();

  return (
    <div className="app-shell">
      <header className="prototype-topbar">
        <div className="brand-lockup">
          <span className="brand-title">Control-Plan Automation</span>
          <span className="brand-file">{parsedData?.fileName ?? 'No workbook loaded'}</span>
        </div>
        <nav className="topbar-actions" aria-label="Main">
          {([
            { label: 'Import', active: activeStage === 'Import', disabled: false, onClick: () => setActiveStage('Import') },
            { label: 'Data', active: activeStage === 'Data' && !drawerOpen, disabled: !parsedData, onClick: () => { setActiveStage('Data'); setDrawerOpen(false); } },
            { label: 'Run', active: activeStage === 'Data' && drawerOpen, disabled: !parsedData, onClick: openRunPanel }
          ]).map((item, index) => (
            <div className="step-wrap" key={item.label}>
              {index > 0 && <span className="step-line" />}
              <button
                type="button"
                className={`step-chip ${item.active ? 'active' : ''} ${item.label === 'Run' && result?.success ? 'complete' : ''} ${item.label === 'Run' && isRunning ? 'running' : ''}`}
                disabled={item.disabled}
                aria-current={item.active ? 'page' : undefined}
                onClick={item.onClick}
              >
                {item.label}
              </button>
            </div>
          ))}
          <button className="reset-link" type="button" onClick={reset} disabled={isRunning} title={isRunning ? 'Available when the automation run has finished' : undefined}>Reset</button>
          <button className="about-link" type="button" onClick={() => setShowAbout(true)}>About</button>
        </nav>
      </header>

      {activeStage === 'Import' && (
        <main className="import-view">
          <div className="import-stack">
            <label
              className={`drop-zone ${isDragging ? 'dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => void handleDrop(event)}
            >
              <input ref={fileInputRef} type="file" accept=".xlsx" onChange={(event) => void handleFileChange(event)} />
              <strong>{isUploading ? 'Importing control plan...' : 'Drop the control plan file'}</strong>
              <span>.xlsx only · Header and Grid sheets required</span>
              <button type="button" className="dark-button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>Choose a file</button>
            </label>
            {importError && (
              <div className="import-error" role="alert">
                <strong>Import failed</strong>
                <span>{importError}</span>
                <button type="button" className="danger-button" onClick={() => fileInputRef.current?.click()}>Choose another file</button>
              </div>
            )}
            {parsedData && !importError && (
              <div className="import-loaded">
                <div>
                  <strong>{parsedData.fileName}</strong>
                  <span>{dataSheets.join(' · ')} · {parsedData.summary.totalRows} rows</span>
                </div>
                <button type="button" className="outline-button" onClick={() => setActiveStage('Data')}>Open data</button>
              </div>
            )}
          </div>
        </main>
      )}

      {activeStage === 'Data' && parsedData && editedSheets && (
        <main className="data-view">
          <div className="data-toolbar">
            <div className="view-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={dataTab === 'header'} className={dataTab === 'header' ? 'selected' : ''} onClick={() => setDataTab('header')}>
                Header <span className="required-dot">*</span>
              </button>
              <button type="button" role="tab" aria-selected={dataTab === 'grid'} className={dataTab === 'grid' ? 'selected' : ''} onClick={() => setDataTab('grid')} disabled={!gridSheet}>
                Grid <span className="tab-count">{gridRows.length}</span>
              </button>
            </div>
          </div>

          <div className="data-body">
            {dataTab === 'header' && (
              <div className="form-scroll">
                {headerSheet && sheetLayout ? (
                  <div className="form-editor">
                    <div className="sheet-caption">
                      <span>{sheetLayout.title ?? 'Control plan header'}</span>
                      <small>{headerSheet}</small>
                    </div>
                    {sheetLayout.sections.map((section, sectionIndex) => (
                      <section className="form-section" key={`${section.title}-${sectionIndex}`}>
                        <h3 className="form-section-title">{section.title}</h3>
                        <div className="form-section-body">
                          {section.items.map((item, itemIndex) => renderLayoutItem(headerSheet, item, `${sectionIndex}-${itemIndex}`))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                <div className="form-editor">
                  <div className="sheet-caption">
                    <span>Control plan header</span>
                    <small>{headerSheet}</small>
                  </div>
                  {headerFallbackRows.length === 0 && <div className="empty-editor">No populated header data was found in the first {HEADER_ROW_LIMIT} rows.</div>}
                  {headerSheet && headerFallbackRows.map(({ rowIndex, columns }) => {
                    const hasLabel = columns.length > 1;
                    const fields = hasLabel ? columns.slice(1) : columns;
                    return (
                      <div className={`header-data-row ${hasLabel ? '' : 'single'}`} key={`${headerSheet}-${rowIndex}`}>
                        {hasLabel && <span className="header-label">{cellText(originalHeaderRows[rowIndex][columns[0]])}</span>}
                        <div className="header-values">
                          {fields.map((column) => {
                            const original = cellText(originalHeaderRows[rowIndex][column]);
                            const current = headerRows[rowIndex];
                            const changed = isChanged(originalHeaderRows[rowIndex], current, column);
                            return (
                              <label className={`form-field compact ${changed ? 'changed' : ''}`} key={column}>
                                {!hasLabel && <span>{original.length > 80 ? 'Content' : `Row ${rowIndex + 1}`}<b>*</b></span>}
                                <input
                                  value={cellText(current[column])}
                                  onChange={(event) => updateCell(headerSheet, rowIndex, column, event.target.value)}
                                  aria-label={`${headerSheet} row ${rowIndex + 1}`}
                                />
                                <small>
                                  {changed ? (
                                    <>
                                      Changed · used by automation
                                      <button type="button" className="revert-link" onClick={() => updateCell(headerSheet, rowIndex, column, original)}>revert</button>
                                    </>
                                  ) : `Row ${rowIndex + 1}`}
                                </small>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            )}

            {dataTab === 'grid' && (
              <div className="grid-editor">
                <div className="grid-title">
                  <span>Control plan grid</span>
                  <small>{gridSheet} · {gridRows.length} rows</small>
                </div>
                <div className="grid-scroll">
                  <table className="prototype-grid">
                    <thead>
                      <tr>
                        <th className="row-number">#</th>
                        {gridColumns.map((column) => <th key={column} title={column}>{column}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {gridRows.map((row, rowIndex) => (
                        <GridRow
                          key={`${gridSheet}-${rowIndex}`}
                          row={row}
                          original={originalGridRows[rowIndex]}
                          rowIndex={rowIndex}
                          columns={gridColumns}
                          onEdit={editGridCell}
                        />
                      ))}
                    </tbody>
                  </table>
                  {gridRows.length === 0 && <div className="empty-editor">The grid sheet has no rows.</div>}
                </div>
                <div className="grid-footer">Click any cell to edit · Edited cells are highlighted · Edits are passed to the automation when you run it.</div>
              </div>
            )}
          </div>

          <footer className="action-bar">
            <div className="action-status" aria-live="polite">
              {actionStatus}
              {!drawerOpen && (isRunning || result) && (
                <button type="button" className="text-button" onClick={() => setDrawerOpen(true)}>View progress</button>
              )}
            </div>
            <div className="action-buttons">
              <button type="button" className="outline-button" onClick={() => void saveChanges()} disabled={isSaving || unsavedCount === 0}>
                {isSaving ? 'Saving...' : 'Save changes'}
              </button>
              <button type="button" className="dark-button" onClick={() => void runAutomation()} disabled={isRunning}>
                {isRunning ? 'Running...' : 'Run automation'}
              </button>
            </div>
          </footer>

          {drawerOpen && (
            <section className="run-drawer" aria-label="Automation run">
              <div className="run-drawer-head">
                <div className="run-drawer-title">
                  <span className="mono-label">{runNumber ? `RUN #${runNumber}` : 'AUTOMATION'}</span>
                  <span className={`run-state ${runState}`}>{runState === 'idle' ? 'READY' : runState.toUpperCase()}</span>
                  <span className="run-sub">
                    {isRunning ? latestLog?.message ?? 'Starting...' : result ? result.message : 'Review the data, then click Run automation.'}
                  </span>
                </div>
                <button type="button" className="outline-button" onClick={() => setDrawerOpen(false)}>{isRunning ? 'Minimise' : 'Close'}</button>
              </div>

              <div className="run-drawer-body">
                <div className="run-progress"><span className={runState} style={{ width: `${progress}%` }} /></div>
                <div className="run-steps">
                  {RUN_PHASES.map((phase, index) => {
                    const done = result?.success || index < reached;
                    const failed = result && !result.success && index === reached;
                    const active = isRunning && index === reached;
                    return <span className={done ? 'complete' : failed ? 'failed' : active ? 'active' : ''} key={phase.label}>{phase.label}</span>;
                  })}
                </div>

                <div className="run-metrics">
                  <div><strong>{parsedData.summary.totalRows}</strong><span>WORKBOOK ROWS</span></div>
                  <div><strong>{gridRows.length}</strong><span>GRID ROWS</span></div>
                  <div><strong>{runNumber ? runEditedCells : editedCellCount}</strong><span>EDITED CELLS</span></div>
                  <div><strong>{logs.length}</strong><span>LOG EVENTS</span></div>
                </div>

                {result && (
                  <div className={`run-result ${result.success ? 'success' : 'failed'}`}>
                    <strong>{result.success ? 'Automation completed' : 'Automation failed'}</strong>
                    <span>{result.message}</span>
                    {summaryEntries.length > 0 && (
                      <ul className="run-summary">
                        {summaryEntries.map(([key, value]) => <li key={key}><span>{humanizeKey(key)}</span><b>{cellText(value as string)}</b></li>)}
                      </ul>
                    )}
                    {result.snapshotUrl && <a className="text-button" href={result.snapshotUrl}>Download data sent to automation (.xlsx)</a>}
                  </div>
                )}

                <div className="run-log" ref={logRef}>
                  {visibleLogs.map((entry, index) => (
                    <div className="run-log-row" key={`${entry.step}-${index}`}>
                      <span>{formatTime(entry.timestamp)}</span>
                      <b className={entry.type}>{tagForLog(entry)}</b>
                      <p>{entry.step && <em>{entry.step}</em>}{entry.message}</p>
                    </div>
                  ))}
                  {visibleLogs.length === 0 && <div className="empty-editor">Automation progress will appear here.</div>}
                </div>

                {runHistory.length > 0 && (
                  <div className="run-history">
                    <span className="mono-label">RUN HISTORY</span>
                    {runHistory.map((run) => (
                      <div key={`${run.id}-${run.time}`}><span>#{run.id}</span><span>{run.time}</span><b className={run.state}>{run.state}</b><span>{run.detail}</span></div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      )}

      {showAbout && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowAbout(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading"><strong id="about-title">About Control-Plan Automation</strong><button type="button" onClick={() => setShowAbout(false)}>Close</button></div>
            <p>Import a control-plan workbook, review the Header form and editable Grid, then run the automation. Your edits are sent to the Playwright automation, and its progress and results appear at the bottom of the page.</p>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
