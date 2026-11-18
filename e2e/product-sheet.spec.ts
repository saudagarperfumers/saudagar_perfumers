import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { adminLogin } from './helpers';

// Download the Excel template, fill in one product as the person filling it would, upload it and import it.
// The product's web address starts with e2e-, so the global teardown deletes it; it uses an existing category only,
// so nothing else is created.
test('product sheet: download the Excel template, fill it in, upload and import', async ({ page }) => {
  const stamp = Date.now();
  await adminLogin(page, '/admin/spreadsheets');
  await page.goto('/admin/spreadsheets?tab=import');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download template/ }).click()]);
  expect(download.suggestedFilename()).toBe('product-sheet.xlsx');
  const filled = test.info().outputPath('filled.xlsx');
  const row = {
    'Product name *': `E2E Sheet ${stamp}`,
    'Main category *': '$first-category',
    'Web address': `e2e-sheet-${stamp}`,
    '50 ml price': 2000,
    '100 ml price': 3500,
    'Short description': 'Imported from the Excel sheet.',
    'Liquid in stock': 200,
  };
  const info = JSON.parse(execFileSync('node', ['e2e/fill-sheet.mjs', await download.path(), filled, JSON.stringify([row])], { encoding: 'utf8' }));
  expect(info.tabs).toEqual(['How to fill', 'Products', 'Other sizes', 'Choices', 'Example']);
  expect(info.category).not.toBe('');

  await page.locator('input[type=file][accept*=".xlsx"]').setInputFiles(filled);
  await expect(page.getByText(/1 product ready to import/)).toBeVisible();
  await expect(page.getByRole('cell', { name: '50 ml, 100 ml' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 product' }).click();
  await expect(page.getByText('Import finished')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('link', { name: 'Open product →' }).click();
  await expect(page.getByRole('heading', { name: `E2E Sheet ${stamp}` })).toBeVisible();
});
