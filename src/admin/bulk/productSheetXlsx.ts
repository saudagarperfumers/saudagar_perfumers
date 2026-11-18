// Builds and reads the product sheet as a real Excel file. ExcelJS is loaded only when this runs.
import type { DataValidation, Workbook, Worksheet } from 'exceljs';
import { parseCsv } from '../../lib/csvParse';
import {
  EXAMPLE_PRODUCTS, EXAMPLE_SIZES, OPTION_COLUMNS, PRODUCT_COLUMNS, SIZE_COLUMNS,
  readGrid, type ChoiceList, type SheetColumn, type SheetRow,
} from './productSheet';

type ExcelJS = typeof import('exceljs');
async function loadExcel(): Promise<ExcelJS> {
  const mod = (await import('exceljs')) as unknown as ExcelJS & { default?: ExcelJS };
  return mod.default ?? mod;
}

export const TABS = { guide: 'How to fill', products: 'Products', sizes: 'Other sizes', choices: 'Choices', example: 'Example' } as const;
/** Rows that get dropdowns (enough for a big catalogue; more rows still import, just without the dropdown). */
const ROWS = 1000;

const INK = 'FF2F2A24';
const REQUIRED = 'FFF6E3C1';
const OPTIONAL = 'FFEDEBE6';
const HINT = 'FFFAF9F6';
const LINE = 'FFD6D3CC';
const thin = { style: 'thin' as const, color: { argb: LINE } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

export const CHOICE_TITLES: Record<ChoiceList, string> = {
  categories: 'Categories',
  collections: 'Collections',
  notes: 'Notes',
  products: 'Products in the store',
  ...(Object.fromEntries(OPTION_COLUMNS.map(([k, h]) => [k, h])) as Record<(typeof OPTION_COLUMNS)[number][0], string>),
};
const CHOICE_ORDER: ChoiceList[] = ['categories', 'collections', ...OPTION_COLUMNS.map(([k]) => k), 'notes', 'products'];

export type TemplateChoices = Record<ChoiceList, string[]>;

function headerRows(ws: Worksheet, columns: SheetColumn[], withGroups: boolean, withHints: boolean) {
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width ?? 16, style: c.number ? {} : { numFmt: '@' } }));
  let at = 1;
  if (withGroups) {
    const groups = ws.getRow(at);
    let start = 1;
    columns.forEach((c, i) => {
      const next = columns[i + 1];
      if (next && next.group === c.group) return;
      const end = i + 1;
      if (end > start) ws.mergeCells(at, start, at, end);
      const cell = ws.getCell(at, start);
      cell.value = c.group;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      start = end + 1;
    });
    groups.height = 20;
    at += 1;
  }
  const head = ws.getRow(at);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: INK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? REQUIRED : OPTIONAL } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = border;
  });
  head.height = 34;
  at += 1;
  if (withHints) {
    const hints = ws.getRow(at);
    columns.forEach((c, i) => {
      const cell = hints.getCell(i + 1);
      cell.value = c.hint;
      cell.font = { italic: true, size: 9, color: { argb: 'FF5A5A5A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HINT } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = border;
    });
    hints.height = 48;
    at += 1;
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: at - 1 }];
  return at;
}

function dropdowns(ws: Worksheet, columns: SheetColumn[], firstRow: number, choiceRange: Partial<Record<ChoiceList, string>>, extra: Partial<Record<string, string>> = {}) {
  columns.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    const range = `${letter}${firstRow}:${letter}${firstRow + ROWS - 1}`;
    const source = extra[c.key] ?? (c.fixed ? `"${c.fixed.join(',')}"` : c.choices ? choiceRange[c.choices] : undefined);
    if (!source) return;
    // Range validations are supported by ExcelJS but missing from its type definitions.
    (ws as unknown as { dataValidations: { add(address: string, v: DataValidation): void } }).dataValidations.add(range, {
      type: 'list',
      allowBlank: true,
      formulae: [source],
      // Fixed lists (yes/no, ml/L/tola) refuse other values; store lists only suggest, so new names and "A | B" work.
      showErrorMessage: !!c.fixed,
      errorStyle: 'stop',
      errorTitle: c.header.replace(' *', ''),
      error: c.fixed ? `Choose one of: ${c.fixed.join(', ')}` : undefined,
    });
  });
}

function guideTab(wb: Workbook, brand: string, sampleSize: number) {
  const ws = wb.addWorksheet(TABS.guide, { properties: { tabColor: { argb: INK } } });
  ws.columns = [{ width: 16 }, { width: 34 }, { width: 11 }, { width: 70 }];
  const title = ws.addRow([`${brand}: product sheet`]);
  title.font = { bold: true, size: 16, color: { argb: INK } };
  ws.addRow([]);
  const steps = [
    'Fill the Products tab: one row per product. Columns in yellow are required, grey ones are optional and can be left empty.',
    `Prices: type the price for each bottle size that is sold (30, 50 or 100 ml). Leave a size empty if it isn't sold.`,
    'Other sizes (an attar in 3 / 6 / 12 ml, a gift box, a 10 ml travel spray) go on the Other sizes tab: one row per size, with the product name exactly as on the Products tab.',
    'Several values in one cell: separate them with a | bar, e.g. Saffron | Pink pepper.',
    'Dropdowns show what the store already has (all of them are on the Choices tab). You can also type a new name; it is created when the sheet is imported.',
    'Photos: type each photo\'s file name, e.g. amber-noir-1.jpg | amber-noir-2.jpg (the first is the main photo), and send the photos along with this sheet. A full image link (https://…) also works.',
    `Stock: "Liquid in stock" is how much perfume there is in total (e.g. 1 L); every bottle and ${sampleSize} ml free sample is poured from it. Gift sets and accessories are "Pieces": give each size an opening stock on the Other sizes tab.`,
    'The Example tab shows three filled-in products. Don\'t type in the grey hint row under the headings.',
    'Send the file back as Excel (.xlsx). In Google Sheets: File → Download → Microsoft Excel.',
  ];
  steps.forEach((s, i) => {
    const r = ws.addRow([`${i + 1}.`, s]);
    ws.mergeCells(r.number, 2, r.number, 4);
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(1).alignment = { vertical: 'top', horizontal: 'right' };
    r.height = s.length > 120 ? 46 : 32;
  });
  ws.addRow([]);
  const h = ws.addRow(['Tab', 'Column', 'Required', 'What to enter']);
  h.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  });
  const add = (tab: string, cols: SheetColumn[]) =>
    cols.forEach((c) => {
      const r = ws.addRow([tab, c.header.replace(' *', ''), c.required ? 'Yes' : '', c.hint.replace(/^Required\.\s*/, '')]);
      r.getCell(4).alignment = { wrapText: true, vertical: 'top' };
      r.eachCell((cell) => {
        cell.border = border;
        if (c.required) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REQUIRED } };
      });
    });
  add(TABS.products, PRODUCT_COLUMNS);
  add(TABS.sizes, SIZE_COLUMNS);
}

/** The Excel template, with today's categories, scent choices and notes in its dropdowns. */
export async function buildProductTemplate(choices: TemplateChoices, opts: { brand: string; sampleSize: number }): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  wb.creator = opts.brand;
  wb.created = new Date();

  guideTab(wb, opts.brand, opts.sampleSize);
  const products = wb.addWorksheet(TABS.products, { properties: { tabColor: { argb: 'FFB08D57' } } });
  const sizes = wb.addWorksheet(TABS.sizes);
  const choiceWs = wb.addWorksheet(TABS.choices);
  const example = wb.addWorksheet(TABS.example);

  // Choices: one column per list. Dropdowns point at these ranges.
  const choiceRange: Partial<Record<ChoiceList, string>> = {};
  choiceWs.columns = CHOICE_ORDER.map(() => ({ width: 24 }));
  CHOICE_ORDER.forEach((key, i) => {
    const col = choiceWs.getColumn(i + 1);
    const items = choices[key] ?? [];
    const head = choiceWs.getCell(1, i + 1);
    head.value = CHOICE_TITLES[key];
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    items.forEach((item, j) => (choiceWs.getCell(j + 2, i + 1).value = item));
    if (items.length) choiceRange[key] = `${TABS.choices}!$${col.letter}$2:$${col.letter}$${items.length + 1}`;
  });
  choiceWs.views = [{ state: 'frozen', ySplit: 1 }];

  const firstProductRow = headerRows(products, PRODUCT_COLUMNS, true, true);
  dropdowns(products, PRODUCT_COLUMNS, firstProductRow, choiceRange);

  const firstSizeRow = headerRows(sizes, SIZE_COLUMNS, false, true);
  dropdowns(sizes, SIZE_COLUMNS, firstSizeRow, choiceRange, {
    product: `${TABS.products}!$A$${firstProductRow}:$A$${firstProductRow + ROWS - 1}`,
  });

  // Example: the same layout, filled in.
  const exStart = headerRows(example, PRODUCT_COLUMNS, true, false);
  EXAMPLE_PRODUCTS.forEach((row, i) => {
    const r = example.getRow(exStart + i);
    PRODUCT_COLUMNS.forEach((c, j) => {
      const val = row[c.key];
      if (val !== undefined) r.getCell(j + 1).value = c.number && val !== '' && Number.isFinite(Number(val)) ? Number(val) : val;
    });
  });
  const sizeTitleRow = exStart + EXAMPLE_PRODUCTS.length + 2;
  example.getCell(sizeTitleRow, 1).value = `${TABS.sizes} tab, filled in for the examples above:`;
  example.getCell(sizeTitleRow, 1).font = { bold: true };
  SIZE_COLUMNS.forEach((c, j) => {
    const cell = example.getCell(sizeTitleRow + 1, j + 1);
    cell.value = c.header;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? REQUIRED : OPTIONAL } };
    cell.border = border;
  });
  EXAMPLE_SIZES.forEach((row, i) => {
    SIZE_COLUMNS.forEach((c, j) => {
      const val = row[c.key];
      if (val !== undefined) example.getCell(sizeTitleRow + 2 + i, j + 1).value = c.number && Number.isFinite(Number(val)) ? Number(val) : val;
    });
  });

  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown; hyperlink?: string; error?: string };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text !== undefined) return cellText(o.text);
    if (o.result !== undefined) return cellText(o.result);
    if (o.hyperlink) return o.hyperlink;
    if (o.error) return '';
  }
  return String(v);
}

function grid(ws: Worksheet): string[][] {
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      // A merged group heading repeats in every cell it covers; only the first one counts.
      cells[c - 1] = cell.isMerged && cell.master !== cell ? '' : cellText(cell.value);
    });
    out[n - 1] = cells;
  });
  return Array.from(out, (r) => r ?? []);
}

export interface ReadSheet {
  products: SheetRow[];
  sizes: SheetRow[];
  problems: string[];
}

/** Reads a filled-in sheet: the Excel template (Products + Other sizes tabs), or a CSV of the Products tab. */
export async function readProductSheet(data: ArrayBuffer, fileName: string): Promise<ReadSheet> {
  const problems: string[] = [];
  if (/\.csv$/i.test(fileName)) {
    const text = new TextDecoder('utf-8').decode(data);
    const p = readGrid(parseCsv(text), PRODUCT_COLUMNS);
    if (!p.found) return { products: [], sizes: [], problems: ['This file has no “Product name” column. Start from “Download the template”.'] };
    if (p.missing.length) problems.push(`Missing columns: ${p.missing.join(', ')}.`);
    return { products: p.rows, sizes: [], problems };
  }
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { products: [], sizes: [], problems: ['This file could not be opened. Save it as Excel (.xlsx) and upload it again.'] };
  }
  const find = (name: string) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === name.toLowerCase());
  const productsWs = find(TABS.products) ?? wb.worksheets.find((w) => readGrid(grid(w), PRODUCT_COLUMNS).found && w.name !== TABS.example);
  if (!productsWs) return { products: [], sizes: [], problems: ['This file has no Products tab. Start from “Download the template”.'] };
  const p = readGrid(grid(productsWs), PRODUCT_COLUMNS);
  if (!p.found) return { products: [], sizes: [], problems: ['The Products tab has no “Product name” column. Start from “Download the template”.'] };
  if (p.missing.length) problems.push(`Products tab is missing: ${p.missing.join(', ')}.`);
  const sizesWs = find(TABS.sizes);
  const s = sizesWs ? readGrid(grid(sizesWs), SIZE_COLUMNS) : { rows: [], found: false, missing: [] };
  if (sizesWs && s.found && s.missing.length && s.rows.length) problems.push(`Other sizes tab is missing: ${s.missing.join(', ')}.`);
  return { products: p.rows, sizes: s.rows, problems };
}

/** For the template's dropdowns: every choice the store has today. */
export function templateChoices(input: {
  categories: { name: string }[];
  collections: { name: string }[];
  notes: { name: string }[];
  options: { kind: string; label: string; is_active?: boolean | null }[];
  products: { name: string }[];
}): TemplateChoices {
  const names = (xs: { name: string }[]) => [...new Set(xs.map((x) => x.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const out = {
    categories: names(input.categories),
    collections: names(input.collections),
    notes: names(input.notes),
    products: names(input.products),
  } as TemplateChoices;
  for (const [kind] of OPTION_COLUMNS) {
    out[kind] = [...new Set(input.options.filter((o) => o.kind === kind && o.is_active !== false).map((o) => o.label.trim()))];
  }
  return out;
}

