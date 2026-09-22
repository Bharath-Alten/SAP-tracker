import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

import { config } from '../config.js';
import type { AutomationProgressEvent, ParsedWorkbook } from '../types.js';

// Runs a Playwright Test spec (tests/login.spec.ts) as the app's automation job and streams its output
// to the UI. The spec can read the edited workbook from the JSON file named in WORKBOOK_DATA_PATH.

// Override with the PLAYWRIGHT_SPEC environment variable to run a different spec.
const SPEC_FILE = process.env.PLAYWRIGHT_SPEC || 'tests/login.spec.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same result from backend/src/playwright (tsx) and backend/dist/playwright (node).
const backendDir = path.join(__dirname, '..', '..');
const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');

// Values from backend/.env (SAP_USER, SAP_PASSWORD, ...) so nobody has to set them in the terminal.
// The file is git-ignored; see backend/.env.example. Real environment variables win over the file.
const envFile = path.join(backendDir, '.env');

function envFileValues(): Record<string, string> {
  const file = envFile;
  if (!fs.existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

function sheetRowCount(payload: ParsedWorkbook, name: string) {
  const sheet = payload.sheetNames.find((sheetName) => sheetName.trim().toLowerCase().includes(name));
  return sheet ? payload.sheets[sheet]?.length ?? 0 : 0;
}

export async function runPlaywrightSpec(
  payload: ParsedWorkbook,
  artifactDir: string,
  onProgress?: (event: AutomationProgressEvent) => void
): Promise<{ success: boolean; message: string; summary: Record<string, unknown> }> {
  const emit = (event: AutomationProgressEvent) => onProgress?.({ ...event, timestamp: new Date().toISOString() });

  fs.mkdirSync(artifactDir, { recursive: true });
  const dataPath = path.join(artifactDir, 'workbook-data.json');
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2));

  emit({ type: 'status', step: 'Excel data read', message: `Parsed ${payload.summary.totalRows} rows across ${payload.summary.totalSheets} sheets.` });
  emit({ type: 'status', step: 'CP Front Page data loaded', message: `Loaded ${sheetRowCount(payload, 'front page')} rows from CP Front Page.` });
  emit({ type: 'status', step: 'CP Grid data loaded', message: `Loaded ${sheetRowCount(payload, 'grid')} rows from CP Grid.` });
  // Say where the SAP credentials come from, so a missing or misplaced .env is obvious in the run panel.
  const fromFile = envFileValues();
  const specEnv: NodeJS.ProcessEnv = { ...fromFile, ...process.env, WORKBOOK_DATA_PATH: dataPath, FORCE_COLOR: '0' };
  const missing = ['SAP_USER', 'SAP_PASSWORD'].filter((name) => !specEnv[name]);
  if (missing.length) {
    emit({
      type: 'error',
      step: 'Credentials missing',
      message: fs.existsSync(envFile)
        ? `${missing.join(' and ')} not found in ${envFile}. Check the spelling of the variable names.`
        : `${missing.join(' and ')} not set, and no file at ${envFile}. Copy backend/.env.example to backend/.env and fill it in.`
    });
  } else {
    emit({
      type: 'status',
      step: 'Credentials loaded',
      message: process.env.SAP_USER ? 'Using SAP_USER from the environment.' : `Using SAP_USER from ${envFile}.`
    });
  }

  emit({ type: 'status', step: 'Playwright test started', message: `Running ${SPEC_FILE}` });

  const child = spawn(
    process.execPath,
    [playwrightCli, 'test', SPEC_FILE, '--reporter=list', `--output=${path.join(artifactDir, 'test-results')}`],
    { cwd: backendDir, env: specEnv }
  );

  const output: string[] = [];
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      output.push(text);
      // "0 failed" and "0 errors" are good news, so don't mark those lines as errors.
      const bad = /\berror\b|\bfailed\b|✘/i.test(text) && !/\b0 (failed|errors?)\b/i.test(text);
      emit({ type: bad ? 'error' : 'log', step: 'Playwright', message: text });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  const timer = setTimeout(() => {
    emit({ type: 'error', step: 'Timeout', message: `Stopped after ${config.automationTimeoutMs / 1000}s` });
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  }, config.automationTimeoutMs);

  const exitCode = await new Promise<number>((resolve) => {
    child.on('error', (error) => {
      emit({ type: 'error', step: 'Playwright', message: error.message });
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);

  const countOf = (label: string) => Number(output.join('\n').match(new RegExp(`(\\d+) ${label}`))?.[1] ?? 0);
  const success = exitCode === 0;
  const message = success ? `${SPEC_FILE} passed.` : `${SPEC_FILE} failed (exit code ${exitCode}).`;
  emit({ type: success ? 'status' : 'error', step: 'Test finished', message });

  return {
    success,
    message,
    summary: {
      spec: SPEC_FILE,
      testsPassed: countOf('passed'),
      testsFailed: countOf('failed'),
      exitCode,
      fileName: payload.fileName
    }
  };
}
