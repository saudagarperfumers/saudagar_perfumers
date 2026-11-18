import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../lib/csvParse';
import {
  EXAMPLE_PRODUCTS, EXAMPLE_SIZES, PRODUCT_COLUMNS, SIZE_COLUMNS, planProductSheet, readGrid, relatedIds, resolveForm, textToHtml, toCreate,
  type PlanContext, type SheetRow,
} from './productSheet';
import { TABS, buildProductTemplate, readProductSheet, templateChoices } from './productSheetXlsx';

const ctx: PlanContext = {
  categories: [{ id: 'c1', name: 'Perfumes', slug: 'perfumes' }, { id: 'c2', name: 'Attars', slug: 'attars' }],
  collections: [],
  notes: [{ id: 'n1', name: 'Rose', slug: 'rose' }],
  options: [{ id: 'o1', name: 'Amber', slug: 'amber', kind: 'family' }, { id: 'o2', name: 'Oud', slug: 'oud', kind: 'accord' }],
  products: [{ id: 'p0', name: 'Old Oud', slug: 'old-oud' }],
  existingSkus: new Set(['OLD-OUD-50']),
  media: [
    { name: 'amber-noir-1.jpg', url: 'https://x/a1.jpg', kind: 'image' },
    { name: 'products/abc/amber-noir-2.jpg', url: 'https://x/a2.jpg', kind: 'image' },
    { name: 'leaflet.pdf', url: 'https://x/l.pdf', kind: 'other' },
  ],
  defaults: { manufacturer_name: 'Saudagar Perfumers', gst_rate: '18' },
  sampleSize: 5,
};

const choices = templateChoices({
  categories: [{ name: 'Perfumes' }, { name: 'Attars' }],
  collections: [{ name: 'The Oud Edit' }],
  notes: [{ name: 'Rose' }, { name: 'Oud' }],
  options: [{ kind: 'family', label: 'Amber' }, { kind: 'season', label: 'Winter' }, { kind: 'season', label: 'Hidden', is_active: false }],
  products: [{ name: 'Old Oud' }],
});

/** The template with rows typed in, as the person filling it would. */
async function filledTemplate(products: Record<string, string>[], sizes: Record<string, string>[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildProductTemplate(choices, { brand: 'Test', sampleSize: 5 })) as ArrayBuffer);
  const fill = (tab: string, cols: typeof PRODUCT_COLUMNS, first: number, rows: Record<string, string>[]) => {
    const ws = wb.getWorksheet(tab)!;
    rows.forEach((row, i) =>
      cols.forEach((c, j) => {
        const v = row[c.key];
        if (v !== undefined) ws.getCell(first + i, j + 1).value = c.number && Number.isFinite(Number(v)) && v !== '' ? Number(v) : v;
      }),
    );
  };
  fill(TABS.products, PRODUCT_COLUMNS, 4, products);
  fill(TABS.sizes, SIZE_COLUMNS, 3, sizes);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const rows = (list: Record<string, string>[], first = 4): SheetRow[] => list.map((v, i) => ({ line: first + i, v }));

describe('product sheet template', () => {
  it('reads back empty: headers found, the hint row is skipped', async () => {
    const sheet = await readProductSheet(await buildProductTemplate(choices, { brand: 'Test', sampleSize: 5 }), 'product-sheet.xlsx');
    expect(sheet).toEqual({ products: [], sizes: [], problems: [] });
  });

  it('has the guide, the tabs and dropdowns with the store lists', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildProductTemplate(choices, { brand: 'Test', sampleSize: 5 })) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([TABS.guide, TABS.products, TABS.sizes, TABS.choices, TABS.example]);
    const products = wb.getWorksheet(TABS.products)!;
    expect(products.getCell(2, 1).value).toBe('Product name *');
    expect(products.getCell(4, 2).dataValidation?.formulae?.[0]).toBe('Choices!$A$2:$A$3');
    expect(choices.season).toEqual(['Winter']);
    const live = PRODUCT_COLUMNS.findIndex((c) => c.key === 'live') + 1;
    expect(products.getCell(500, live).dataValidation?.formulae?.[0]).toBe('"yes,no"');
  });

  it('imports the example products end to end', async () => {
    const sheet = await readProductSheet(await filledTemplate(EXAMPLE_PRODUCTS, EXAMPLE_SIZES), 'filled.xlsx');
    expect(sheet.problems).toEqual([]);
    expect(sheet.products).toHaveLength(3);
    expect(sheet.sizes).toHaveLength(4);
    const plan = planProductSheet(sheet, ctx);
    expect(plan.problems).toEqual([]);
    const [amber, musk, box] = plan.products;
    expect(plan.products.map((p) => p.errors)).toEqual([[], [], []]);

    // Amber Noir: three standard sizes, a free sample, everything from the row.
    expect(amber.handle).toBe('amber-noir');
    expect(amber.form.variants.map((v) => [v.kind, v.label, v.size_ml, v.price, v.compare_at_price])).toEqual([
      ['retail', '30 ml', '30', '1900', ''],
      ['retail', '50 ml', '50', '2900', ''],
      ['retail', '100 ml', '100', '4900', '5500'],
      ['sample', '5 ml sample', '5', '', ''],
    ]);
    expect(amber.form.variants[0]).toMatchObject({ weight_g: '180', length_mm: '60', width_mm: '60', height_mm: '120' });
    expect(amber.form.base_price).toBe('1900');
    expect([amber.form.stock_unit, amber.form.liquid_amount, amber.form.liquid_unit]).toEqual(['ml', '1', 'L']);
    expect(amber.form.media.map((m) => m.url)).toEqual(['https://x/a1.jpg', 'https://x/a2.jpg']);
    expect(amber.form.description).toBe('<p>Saffron and pink pepper open onto a heart of rose.</p><p>It dries down to amber and oud that lasts all night.</p>');
    expect([amber.form.is_active, amber.form.is_vegan, amber.form.is_cruelty_free, amber.form.ships_surface_only, amber.form.counts_toward_samples]).toEqual([true, true, true, true, true]);
    expect(amber.form.manufacturer_name).toBe('Saudagar Perfumers');
    expect(amber.form.badge).toBe('NEW DROP');
    expect(amber.form.launch_year).toBe('2024');
    expect(amber.sections).toEqual([{ title: 'The ritual', body: '<p>Spray on warm skin after a shower.</p>' }]);
    expect(amber.related).toEqual(['Musk Attar']);
    expect(amber.warnings).toEqual([]);
    expect(amber.create.categories).toEqual(['Gift ideas']);
    expect(amber.create.collections).toEqual(['The Oud Edit']);
    expect(amber.create.notes).toEqual(['Saffron', 'Pink pepper', 'Amber', 'Oud']);
    expect(amber.create.options).toContainEqual({ kind: 'family', label: 'Woody' });
    expect(amber.create.options).not.toContainEqual({ kind: 'family', label: 'Amber' });

    // Musk Attar: sizes only from the Other sizes tab; liquid, not by surface.
    expect(musk.form.variants.map((v) => [v.label, v.size_ml, v.price, v.compare_at_price])).toEqual([
      ['3 ml', '3', '450', ''], ['6 ml', '6', '850', '990'], ['12 ml', '12', '1500', ''],
    ]);
    expect(musk.form.base_price).toBe('450');
    expect(musk.form.ships_surface_only).toBe(false);
    expect(musk.form.is_active).toBe(false);

    // Oud Gift Box: pieces, opening stock and parcel from the Other sizes tab.
    expect(box.form.stock_unit).toBe('piece');
    expect(box.form.variants[0]).toMatchObject({ label: 'Gift box', size_ml: '', price: '3500', initial_stock: '25', weight_g: '600', length_mm: '200' });
    expect(toCreate(plan.products).categories).toEqual(['Gift ideas', 'Gift sets']);
  });

  it('fills in ids, the main family and accord strengths once everything exists', () => {
    const plan = planProductSheet({ products: rows([EXAMPLE_PRODUCTS[0]]), sizes: [] }, ctx);
    const p = plan.products[0];
    const opts = [...ctx.options, { id: 'o3', name: 'Woody', slug: 'woody', kind: 'family' }, { id: 'o4', name: 'Amber', slug: 'amber', kind: 'accord' }];
    const form = resolveForm(p, { ...ctx, options: opts, notes: [...ctx.notes, { id: 'n2', name: 'Oud' }] });
    expect(form.primary_category_id).toBe('c1');
    expect(form.attributes.filter((a) => a.kind === 'family')).toEqual([
      { option_id: 'o1', kind: 'family', strength: null, is_primary: true },
      { option_id: 'o3', kind: 'family', strength: null, is_primary: false },
    ]);
    expect(form.attributes.filter((a) => a.kind === 'accord').map((a) => [a.option_id, a.strength])).toEqual([['o4', 85], ['o2', 60]]);
    expect(form.notes.map((n) => [n.note_id, n.tier, n.position])).toEqual([['n1', 'heart', 0], ['n2', 'base', 1]]);
    expect(form.page_sections).toHaveLength(1);
    expect(relatedIds(['Musk Attar', 'Old Oud', 'old-oud', 'Nope'], [...ctx.products, { id: 'p9', name: 'Musk Attar', slug: 'musk-attar' }], 'p1')).toEqual(['p9', 'p0']);
  });

  it('explains what is wrong, in plain words', () => {
    const plan = planProductSheet(
      {
        products: rows([
          { name: 'No Price', main_category: 'Perfumes' },
          { name: 'Bad Bits', price_50: 'abc', live: 'maybe', photos: 'missing.jpg | leaflet.pdf', accord: 'Oud 300', section2_text: 'Body without a title' },
          { name: 'No Category', price_30: '1000' },
          { name: 'Old Oud', main_category: 'Perfumes', price_50: '2000' },
          { name: 'Clash', handle: 'old-oud-2', main_category: 'Perfumes', price_50: '2000' },
        ]),
        sizes: rows([{ product: 'Ghost', label: '6 ml', price: '1' }, { product: 'No Price', label: '10 ml', price: '' }], 3),
      },
      { ...ctx, existingSkus: new Set(['OLD-OUD-2-50']) },
    );
    const errs = (name: string) => plan.products.find((p) => p.form.name === name)!.errors.join(' | ');
    expect(errs('No Price')).toMatch(/add a price for 10 ml/);
    expect(errs('Bad Bits')).toMatch(/50 ml price: “abc” isn't a number/);
    expect(errs('Bad Bits')).toMatch(/Live on the store: “maybe” should be yes or no/);
    expect(errs('Bad Bits')).toMatch(/Photo “missing.jpg” isn't in the Media library/);
    expect(errs('Bad Bits')).toMatch(/“leaflet.pdf” isn't a photo or video/);
    expect(errs('Bad Bits')).toMatch(/strength for Oud must be 1 to 100/);
    expect(errs('Bad Bits')).toMatch(/Section 2 has text but no title/);
    expect(errs('Bad Bits')).toMatch(/Add a main category/);
    expect(errs('No Category')).toBe('Add a main category.');
    expect(errs('Clash')).toMatch(/SKU OLD-OUD-2-50 is already used/);
    expect(plan.existing).toEqual([{ line: 7, name: 'Old Oud', handle: 'old-oud' }]);
    expect(plan.problems).toEqual(['Other sizes row 3: no product called “Ghost” on the Products tab, so it was skipped.']);
  });

  it('a liquid product needs ml on its other sizes, worked out from "6 ml" when it can', () => {
    const plan = planProductSheet(
      { products: rows([{ name: 'Attar', main_category: 'Attars' }]), sizes: rows([{ product: 'attar', label: '6 ml', price: '800' }, { product: 'Attar', label: 'Travel', price: '500' }], 3) },
      ctx,
    );
    expect(plan.products[0].form.variants[0].size_ml).toBe('6');
    expect(plan.products[0].errors).toEqual(['Travel: add its size in ml (this product is kept as liquid).']);
  });

  it('reads a CSV of the Products tab too, under a row of group names', () => {
    const csv = 'Basics,,Sizes\nProduct name *,Main category *,50 ml price (₹)\nRequired. e.g. Amber Noir,x,y\nRose Oud,Perfumes,"3,200"\n';
    const r = readGrid(parseCsv(csv), PRODUCT_COLUMNS);
    expect(r.rows).toEqual([{ line: 4, v: { name: 'Rose Oud', main_category: 'Perfumes', price_50: '3,200' } }]);
    expect(planProductSheet({ products: r.rows, sizes: [] }, ctx).products[0].form.variants[0].price).toBe('3200');
  });

  it('keeps line breaks and escapes text from cells', () => {
    expect(textToHtml('a <b>\nnext line\n\nnew para')).toBe('<p>a &lt;b&gt;<br>next line</p><p>new para</p>');
    expect(textToHtml('  ')).toBe('');
  });
});
