import { CpPage } from './pageObjects/cpPage.js';
import type { ParsedWorkbook } from '../types.js';

export async function runPlaywrightAutomation(payload: ParsedWorkbook, onProgress?: (step: string, message: string) => void) {
  const cpPage = new CpPage();

  onProgress?.('Playwright started', 'Starting CP browser automation.');
  await cpPage.openLoginPage();
  onProgress?.('Parent created', 'Placeholder parent module creation is configured here.');
  await cpPage.createParentModule();

  const frontPageData = payload.sheets['CP Front Page'] ?? [];
  if (frontPageData.length) {
    onProgress?.('CP Front Page data loaded', `Loaded ${frontPageData.length} rows from CP Front Page.`);
  }

  const gridData = payload.sheets['CP Grid'] ?? [];
  if (gridData.length) {
    onProgress?.('CP Grid data loaded', `Loaded ${gridData.length} rows from CP Grid.`);
  }

  await cpPage.createSubChildModule('Sub-child 1');
  onProgress?.('Sub-child 1 created', 'Sub-child module creation step complete.');
  await cpPage.createSubChildModule('Sub-child 2');
  onProgress?.('Sub-child 2 created', 'Second sub-child module creation step complete.');

  await cpPage.addGridRows(gridData);
  onProgress?.('CP Grid rows added', `Added ${gridData.length} rows to the target module.`);
  await cpPage.validateSuccess();
  onProgress?.('Validation completed', 'Validation completed successfully.');

  return { success: true, message: 'Automation completed successfully.' };
}
