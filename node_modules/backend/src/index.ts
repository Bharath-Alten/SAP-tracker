import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { parseWorkbook } from './excelParser.js';
import { runMockPlaywrightAutomation } from './playwright/mockAutomation.js';
import * as XLSX from 'xlsx';
import type { AutomationProgressEvent, ParsedWorkbook } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const uploadDir = path.join(__dirname, '..', config.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

// Built React app (frontend/dist). Resolves the same from backend/src (tsx) and backend/dist (node).
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
const frontendIndex = path.join(frontendDist, 'index.html');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowedExt = /\.xlsx$/i;
    if (!allowedExt.test(file.originalname)) {
      return cb(new Error('Only .xlsx files are accepted'));
    }
    cb(null, true);
  }
});

const jobs = new Map<
  string,
  {
    status: 'queued' | 'running' | 'completed' | 'failed';
    startTime?: string;
    endTime?: string;
    logs: AutomationProgressEvent[];
    result?: { success: boolean; message: string; summary: Record<string, unknown> };
    artifacts?: Record<string, string>;
  }
>();

app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: config.appName });
});

app.post('/api/upload', (req, res) => {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Invalid upload' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      const parsed = parseWorkbook(req.file.path, req.file.originalname);
      return res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse uploaded file';
      return res.status(400).json({ error: message });
    }
  });
});

app.post('/api/automation/run', async (req, res) => {
  try {
    const payload = req.body as { fileName?: string; parsedData?: ParsedWorkbook };
    const data = payload.parsedData ?? {
      fileName: payload.fileName ?? 'uploaded-file',
      sheetNames: [],
      sheets: {},
      summary: { totalRows: 0, totalSheets: 0, sheetCounts: {} }
    };

    const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    jobs.set(jobId, {
      status: 'queued',
      startTime: new Date().toISOString(),
      logs: []
    });

    void (async () => {
      const job = jobs.get(jobId);
      if (!job) return;
      job.status = 'running';
      job.logs.push({ type: 'status', step: 'Playwright started', message: 'Automation queued and waiting to start.', timestamp: new Date().toISOString() });

      // prepare artifact directory for this job
      const artifactsRoot = path.join(uploadDir, 'artifacts');
      const jobArtifactDir = path.join(artifactsRoot, jobId);
      fs.mkdirSync(jobArtifactDir, { recursive: true });

      // Save a snapshot XLSX of the parsed data so external tools can consume it
      try {
        const snapshotPath = path.join(jobArtifactDir, `${jobId}-snapshot.xlsx`);
        const wb = XLSX.utils.book_new();
        for (const sheetName of data.sheetNames) {
          const rows = (data.sheets[sheetName] ?? []) as any[];
          const cleaned = rows.map((r) => {
            const copy: Record<string, any> = {};
            Object.entries(r).forEach(([k, v]) => {
              if (k === '__row') return;
              copy[k] = v;
            });
            return copy;
          });
          const ws = XLSX.utils.json_to_sheet(cleaned);
          XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
        }
        XLSX.writeFile(wb, snapshotPath);
        job.logs.push({ type: 'status', step: 'Snapshot saved', message: `Saved workbook snapshot to ${snapshotPath}`, timestamp: new Date().toISOString() });
        job.artifacts = job.artifacts ?? {};
        job.artifacts.snapshot = `/api/automation/artifact/${jobId}/${path.basename(snapshotPath)}`;
      } catch (e) {
        job.logs.push({ type: 'error', step: 'Snapshot failed', message: (e as Error).message, timestamp: new Date().toISOString() });
      }

      try {
        const result = await runMockPlaywrightAutomation(data, jobArtifactDir, (event) => {
          const currentJob = jobs.get(jobId);
          if (!currentJob) return;
          currentJob.logs.push({
            ...event,
            timestamp: new Date().toISOString()
          });
        });

        const currentJob = jobs.get(jobId);
        if (!currentJob) return;
        currentJob.result = result;
        currentJob.status = result.success ? 'completed' : 'failed';
        currentJob.endTime = new Date().toISOString();
      } catch (error) {
        const currentJob = jobs.get(jobId);
        if (!currentJob) return;
        const message = error instanceof Error ? error.message : 'Unknown automation error';
        currentJob.status = 'failed';
        currentJob.logs.push({ type: 'error', step: 'Automation failed', message, timestamp: new Date().toISOString() });
        currentJob.result = { success: false, message, summary: { error: message } };
        currentJob.endTime = new Date().toISOString();
      }
    })();

    return res.json({ jobId, status: 'queued' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Automation failed';
    return res.status(500).json({ error: message });
  }
});

app.get('/api/automation/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.json({
    jobId: req.params.jobId,
    status: job.status,
    logs: job.logs,
    result: job.result,
    artifacts: job.artifacts,
    startedAt: job.startTime,
    completedAt: job.endTime
  });
});

// Serve artifacts for a job
app.get('/api/automation/artifact/:jobId/:fileName', (req, res) => {
  const { jobId, fileName } = req.params;
  const filePath = path.join(uploadDir, 'artifacts', jobId, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Artifact not found.' });
  }
  return res.sendFile(filePath);
});

// Save workbook snapshot from frontend
app.post('/api/workbook/save', (req, res) => {
  try {
    const parsed = req.body as ParsedWorkbook;
    if (!parsed || !parsed.sheetNames) return res.status(400).json({ error: 'Invalid payload' });
    const fileName = `${Date.now()}-${parsed.fileName ?? 'snapshot'}`.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const outPath = path.join(uploadDir, fileName);
    const wb = XLSX.utils.book_new();
    for (const sheetName of parsed.sheetNames) {
      const rows = (parsed.sheets[sheetName] ?? []) as any[];
      const cleaned = rows.map((r) => {
        const copy: Record<string, any> = {};
        Object.entries(r).forEach(([k, v]) => {
          if (k === '__row') return;
          copy[k] = v;
        });
        return copy;
      });
      const ws = XLSX.utils.json_to_sheet(cleaned);
      XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
    }
    XLSX.writeFile(wb, outPath);
    return res.json({ file: fileName, path: `/uploads/${fileName}`, savedTo: outPath });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

// Unknown API routes return JSON rather than the UI.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// Serve the built UI from the same server so the whole app lives on one URL.
if (fs.existsSync(frontendIndex)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(frontendIndex));
}

function openBrowser(url: string) {
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) console.log(`Open ${url} in your browser.`);
  });
}

app.listen(config.port, () => {
  const url = `http://localhost:${config.port}`;
  console.log(`${config.appName} listening on ${url}`);
  if (fs.existsSync(frontendIndex)) {
    console.log(`Application UI available at ${url}`);
    if (process.argv.includes('--open')) openBrowser(url);
  } else {
    console.log('UI build not found (frontend/dist). Run "npm start" from the project root, or "npm run dev" for development.');
  }
});
