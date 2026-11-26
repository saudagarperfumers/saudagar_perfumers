import { expect, test } from '@playwright/test';

test('home "Our Signature Fragrance" is filled from the database', async ({ page }) => {
  await page.goto('/');
  // The home page is built from CMS sections; this row lists hand-picked products.
  await expect(page.getByText('Our Signature Fragrance').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Ocean Blue/i).first()).toBeAttached({ timeout: 20_000 });
});

test('product page shows the note pyramid, real sizes and no fake reviews', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/product/kasturi');
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/kasturi/i);
  await expect(page.getByText('No reviews yet').first()).toBeVisible();
  await expect(page.getByText('Top Notes')).toBeVisible();
  const noteLink = page.getByRole('link', { name: 'Saffron', exact: true }).first();
  await expect(noteLink).toHaveAttribute('href', '/notes/saffron');
  await expect(page.getByRole('button', { name: '50 ml', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Details & Compliance' }).click();
  await expect(page.getByText('3303')).toBeVisible();
});

test('unknown product shows the 404', async ({ page }) => {
  await page.goto('/product/does-not-exist');
  await expect(page.getByRole('heading', { name: 'This page has evaporated' })).toBeVisible();
});

test('category page lists its perfumes', async ({ page }) => {
  await page.goto('/categories/floral-perfumes');
  await expect(page.getByText(/Floral Perfumes/i).first()).toBeVisible();
  await expect(page.getByText(/^7\s*perfumes$/i)).toBeVisible();
});

test('filters are saved in the URL and narrow the results', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/shop');
  await expect(page.getByText(/^102\s*perfumes$/i)).toBeVisible();
  await page.getByRole('button', { name: /Occasion & ritual/i }).first().click();
  await page.getByText('Royal Gala & Evening', { exact: true }).first().click();
  await expect(page).toHaveURL(/occasion=evening/);
  await expect(page.getByText(/^102\s*perfumes$/i)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /Royal Gala & Evening/ })).toBeVisible(); // active filter chip survives reload
});

test('search finds products by note', async ({ page }) => {
  await page.goto('/search?q=bergamot');
  await expect(page.getByRole('heading', { name: /Results for “bergamot”/ })).toBeVisible();
  await expect(page.getByText(/^[1-9]\d*\s*perfumes?$/i)).toBeVisible();
});

test('notes library links to note pages', async ({ page }) => {
  await page.goto('/notes');
  await page.getByRole('link', { name: 'Taif Rose Petals' }).click();
  await expect(page).toHaveURL(/\/notes\/taif-rose-petals$/);
  await expect(page.getByRole('heading', { name: 'Taif Rose Petals' })).toBeVisible();
});
