import { test, expect, type Locator, type Page } from '@playwright/test';
import { getFormFields, getGridRows, requireField } from './workbookData';
import { sapCredentials } from './sapLogin';

// Picks a value in a SAP UI5 dropdown: open it, then click the matching entry.
// async function selectDropdown(page: Page, opener: Locator, value: string) {
//   await opener.click();
//   const option = page.getByRole('option', { name: value, exact: true });
//   if (await option.count()) await option.first().click();
//   else await page.locator('li').filter({ hasText: value }).first().click();
// }
// Picks a value in a SAP UI5 dropdown: open it, then click the matching entry.
// Picks a value in a SAP UI5 dropdown: open it, wait for it, then click the matching entry.


// async function selectDropdown(page: Page, opener: Locator, value: string) {
//   await opener.click({ force: true });
  
//   // Wait for the dropdown option to physically appear on the screen
//   const option = page.locator('li').filter({ hasText: value }).first();
//   await option.waitFor({ state: 'visible', timeout: 5000 });
//   await option.click({ force: true });
  
//   // Give SAP UI5 a half-second to register the selection before moving to the next field
//   await page.waitForTimeout(500); 
// }
// Picks a value in a SAP UI5 dropdown: open it, wait for it, then click the matching entry.
async function selectDropdown(page: Page, opener: Locator, value: string) {
  await opener.click({ force: true });
  
  // 1. First, try the standard option role (Works for Plant and newer SAP dropdowns)
  const option = page.getByRole('option', { name: value, exact: true });
  
  // Give the menu a moment to animate and appear
  await page.waitForTimeout(500);
  
  if (await option.count() > 0) {
      await option.first().click({ force: true });
  } else {
      // 2. Fallback for older SAP UI5 dropdowns that just use list items
      const fallbackOption = page.locator('li').filter({ hasText: value }).first();
      await fallbackOption.waitFor({ state: 'visible', timeout: 5000 });
      await fallbackOption.click({ force: true });
  }
  
  // Give SAP UI5 a half-second to register the selection before moving to the next field
  await page.waitForTimeout(500); 
}

// async function selectDropdown(page: Page, opener: Locator, value: string) {
//   // Add { force: true } to bypass the SAP label intercepting the click
//   await opener.click({ force: true });
  
//   const option = page.getByRole('option', { name: value, exact: true });
//   if (await option.count()) {
//       await option.first().click({ force: true });
//   } else {
//       await page.locator('li').filter({ hasText: value }).first().click({ force: true });
//   }
// }

test('test', async ({ page }) => {
  const form = getFormFields();

  // Values derived from the workbook fields
  const buildProcess = form['Build Process Number & Issue'] ?? '';        // "D2567983900200 Issue D"
  const productNumber = buildProcess.replace(/\s*issue\b.*$/i, '').trim(); // "D2567983900200"
  const engineeringProduct = (form['Definition Dossier Number & Issue'] ?? '').split(/[\s(]/)[0]; // "D256-79839"
  const standard = (form['Program designation'] ?? '').match(/\(([^)]+)\)/)?.[1] ?? '';           // "ST08"
  const poeNumber = (form['Point of Embodiment'] ?? '').replace(/\D/g, '');                      // "13441"
  const inThreeWeeks = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  const dueDate = `${inThreeWeeks.getMonth() + 1}/${inThreeWeeks.getDate()}/${String(inThreeWeeks.getFullYear()).slice(-2)}`;

  // Credentials come from the SAP_USER / SAP_PASSWORD environment variables, never from the code.
  const { user, password } = sapCredentials();

  await page.goto('https://mylaunchpad.intra.corp/fiori#Shell-home');
  //await page.goto('https://umssosptlspro.intra.corp/1S14/idp/SSO.saml2');
  await page.getByRole('link', { name: 'Login / Password' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill(user);
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign On   >' }).click();
  await page.getByRole('button', { name: 'CP Control Plan' }).click();

  await page.getByRole('textbox', { name: 'Control Plan Name' }).click();
  await page.getByRole('textbox', { name: 'Control Plan Name' }).fill(requireField('Control Plan Number'));
  await page.getByRole('textbox', { name: 'Control Plan Description' }).click();
  await page.getByRole('textbox', { name: 'Control Plan Description' }).fill(form['Control Plan Number']);
  // console.log("till here done ");
  // await selectDropdown(page, page.getByRole('combobox', { name: 'SAP Target System' }), 'ARP');
  // await selectDropdown(page, page.getByRole('combobox', { name: 'Control Plan Granularity' }), 'Routing');
  // await selectDropdown(page, page.getByRole('combobox', { name: 'Control Plan Stage /' }), form['Stage']);
  // await selectDropdown(page, page.getByRole('combobox', { name: 'Program' }), 'A320_Family_CEO/NEO');
  // console.log("---------- ");

  console.log("till here done ");
  
  // Use Regex (/.../i) to match the names safely, and wait between selections
  await selectDropdown(page, page.getByRole('combobox', { name: /SAP Target System/i }), 'ARP');
  await selectDropdown(page, page.getByRole('combobox', { name: /Control Plan Granularity/i }), 'Routing');

  await selectDropdown(page, page.getByRole('combobox', { name: /Control Plan Stage/i }), form['Stage']);
  // Using getByRole for Plant instead of the hardcoded xmlview ID
  // await selectDropdown(page, page.getByRole('combobox', { name: 'Plant', exact: true }), 'AFM1');
    console.log("---------- ");
  // await selectDropdown(page, page.getByRole('combobox', { name: /Plant/i }), 'AFM1');
  // Using the wildcard ID to click the dropdown arrow directly
await selectDropdown(page, page.locator('[id$="id_plant-arrow"]'), 'AFM1');
  await selectDropdown(page, page.getByRole('combobox', { name: /Program/i }), 'A320_Family_CEO/NEO');
 console.log("----------1 ");
  await page.getByRole('textbox', { name: 'Build Process Operation' }).click();
  await page.getByRole('textbox', { name: 'Build Process Operation' }).fill(buildProcess);
  await page.getByRole('textbox', { name: 'D-FMEAs Number & Issue' }).click();
  await page.getByRole('textbox', { name: 'D-FMEAs Number & Issue' }).fill('NA');
  await page.getByRole('textbox', { name: 'P-FMEAs Number & Issue' }).click();
  await page.getByRole('textbox', { name: 'P-FMEAs Number & Issue' }).fill(form['P-FMEAs Number & Issue']);

  // Manufacturing product: open the value help, search the product number, pick it, confirm.
  await page.locator('#__xmlview1--idProduct-vhi').click();
  await page.locator('#__xmlview5--idMaterialNumber-inner').fill(productNumber);
  // await page.locator('#__button39-img').click();
   console.log("----------2 ");
   await page.getByRole('button', { name: 'Search', exact: true }).click();
  //await page.locator(`//span[.='${productNumber}']//parent::td//parent::tr/td/div/div`).click();
  await page.locator(`//span[.='${productNumber}']//parent::td//parent::tr/td/div/div`).first().click();
console.log("----------4 ");
  await page.locator('//button[@title="Decline"]/span/span').click();
  console.log("----------3 ");
  await page.getByRole('textbox', { name: 'Engineering product' }).click();
  await page.getByRole('textbox', { name: 'Engineering product' }).fill(engineeringProduct);
  await page.getByRole('textbox', { name: 'Standard' }).click();
  await page.getByRole('textbox', { name: 'Standard' }).fill(standard);
  await page.getByRole('textbox', { name: 'Area' }).click();
  await page.getByRole('textbox', { name: 'Area' }).fill(form['Area']);
  console.log("----------4");
  await page.getByPlaceholder('POE - 5 Digits').click();
  await page.getByPlaceholder('POE - 5 Digits').fill(poeNumber);
  console.log("----------5");
  // await page.getByRole('textbox', { name: 'POE (MSN or DATE)', description: 'Date' }).click();
  // await page.getByRole('textbox', { name: 'POE (MSN or DATE)', description: 'Date' }).fill(poeNumber);
   console.log("----------6");
  await page.getByRole('textbox', { name: 'Effectivity' }).click();
  await page.getByRole('textbox', { name: 'Effectivity' }).fill('Effecrivity');

  await selectDropdown(page, page.locator('[id="__xmlview1--MFT-arrow"]'), 'A320 FAL MOB [MINOR]');

  await page.getByRole('textbox', { name: 'Content of Revision' }).click();
  await page.getByRole('textbox', { name: 'Content of Revision' }).fill(form['Content of Revision']);
  await page.getByRole('textbox', { name: 'Due Date for Implementation' }).click();
  await page.getByRole('textbox', { name: 'Due Date for Implementation' }).fill(dueDate);
  await page.getByRole('textbox', { name: 'Creation Date' }).click();

  await page.goto('https://mylaunchpad.intra.corp/fiori#ZSO_1N31_CP-display&/CP_ID/A0/CPGrid');
});
