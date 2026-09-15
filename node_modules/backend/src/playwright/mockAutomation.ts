import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import type { ParsedWorkbook, AutomationProgressEvent } from '../types.js';

function findSheetRows(payload: ParsedWorkbook, names: string[]) {
  const normalizedNames = names.map((name) => name.trim().toLowerCase());

  for (const sheetName of payload.sheetNames) {
    const normalizedSheetName = sheetName.trim().toLowerCase();
    if (normalizedNames.includes(normalizedSheetName)) {
      return payload.sheets[sheetName] ?? [];
    }
  }

  for (const [sheetName, rows] of Object.entries(payload.sheets)) {
    const normalizedSheetName = sheetName.trim().toLowerCase();
    if (normalizedNames.some((name) => normalizedSheetName.includes(name))) {
      return rows;
    }
  }

  return [];
}

export async function runMockPlaywrightAutomation(
  payload: ParsedWorkbook,
  artifactDir: string | null,
  onProgress?: (event: AutomationProgressEvent) => void
): Promise<{ success: boolean; message: string; summary: Record<string, unknown> }> {
  const emit = (event: AutomationProgressEvent) => {
    if (onProgress) {
      onProgress({
        ...event,
        timestamp: new Date().toISOString()
      });
    }
  };

  let browser;

  try {
    emit({ type: 'status', step: 'File uploaded', message: `Loaded ${payload.fileName}` });
    emit({ type: 'status', step: 'Excel data read', message: `Parsed ${payload.summary.totalRows} rows across ${payload.summary.totalSheets} sheets.` });

    const frontPage = findSheetRows(payload, [
      'CP Front Page',
      'CP Front Page ',
      'Front Page',
      'Control Plan Front Page',
      'CP Front Page (Data)'
    ]);

    const gridData = findSheetRows(payload, [
      'CP Grid',
      'CP Grid (Tool)',
      'Grid',
      'CP Grid Data'
    ]);

    if (!frontPage.length) {
      throw new Error(`CP Front Page sheet was not found in the uploaded file. Available sheets: ${payload.sheetNames.join(', ') || 'none'}`);
    }

    emit({ type: 'status', step: 'CP Front Page data loaded', message: `Loaded ${frontPage.length} rows from CP Front Page.` });
    emit({ type: 'status', step: 'CP Grid data loaded', message: `Loaded ${gridData.length} rows from CP Grid.` });
    emit({ type: 'status', step: 'Playwright started', message: 'Opening browser and beginning simple login automation.' });

    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Use a simple public test login page for demo purposes
    // The test site has fields with name="username" and name="password"
    const demoUrl = 'https://the-internet.herokuapp.com/login';
    // const demoUrl = 'https://docs.google.com.rproxy.goskope.com/spreadsheets/d/1IqvElGymRzlm7GSOMw8tt4uvcfxsrqBPXxHNpMXNe10/edit?gid=0#gid=0';
    emit({ type: 'status', step: 'Navigation', message: `Navigating to ${demoUrl}` });
    await page.goto(demoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Fill demo credentials (public test credentials)
    const demoUser = 'tomsmith';
    const demoPass = 'SuperSecretPassword!';
    emit({ type: 'status', step: 'Filling credentials', message: `Filling username and password on ${demoUrl}` });
    await page.fill('input[name="username"]', demoUser);
    await page.fill('input[name="password"]', demoPass);
    await page.click('button[type="submit"]');

    // Wait for either success or failure message to appear
    await page.waitForSelector('#flash', { timeout: 10000 }).catch(() => {});
    const flash = await page.$('#flash');
    const flashText = flash ? (await flash.textContent())?.trim() : 'No result message';
    emit({ type: 'status', step: 'Login result', message: flashText ?? 'Login completed' });

    // Save a screenshot artifact if artifactDir is provided
    if (artifactDir) {
      try {
        fs.mkdirSync(artifactDir, { recursive: true });
        const shotPath = path.join(artifactDir, 'screenshot-1.png');
        await page.screenshot({ path: shotPath, fullPage: true });
        emit({ type: 'status', step: 'Artifact saved', message: `Saved screenshot to ${shotPath}` });
      } catch (e) {
        emit({ type: 'error', step: 'Artifact error', message: `Failed to save screenshot: ${(e as Error).message}` });
      }
    }

    emit({ type: 'status', step: 'Demo actions', message: `Demo automation completed. Loaded ${frontPage.length} front-page rows and ${gridData.length} grid rows.` });
    emit({ type: 'log', message: 'Automation demo completed successfully.' });

    return {
      success: true,
      message: 'Automation completed successfully.',
      summary: {
        parentCreated: true,
        subChildOneCreated: true,
        subChildTwoCreated: true,
        gridRowsAdded: gridData.length,
        validated: true,
        fileName: payload.fileName
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown automation error';
    emit({ type: 'error', step: 'Automation failed', message });
    emit({ type: 'result', success: false, message, data: { error: message } });
    return {
      success: false,
      message,
      summary: { error: message }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
