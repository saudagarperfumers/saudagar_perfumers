// Spreadsheet round-trip for prices and stock of every size. Pure functions so the preview the admin sees is exactly
// what gets saved. New products come in through the Excel product sheet (productSheet.ts).
import { csvObjects } from '../../lib/csvParse';
import { toCsv } from '../export/csv';
import { slugify } from '../catalog/productForm';

// ============================================================ prices and stock
export interface VariantRow {
  sku: string;
  product_id: string;
  product: string;
  /** 'ml': the perfume's liquid is shared by its sizes; 'piece': each size has its own count. */
  stock_unit: 'ml' | 'piece';
  /** Liquid left for the whole perfume (ml products). */
  liquid_ml: number;
  label: string;
  kind: string;
  base_price: number;
  price: number | null;
  compare_at_price: number | null;
  stock: number;
}

export const PRICE_STOCK_COLUMNS = ['SKU', 'Product', 'Size', 'Type', 'Base price (₹)', 'Price (₹)', 'Compare-at price (₹)', 'Liquid left (ml)', 'Stock'];

export function priceStockSheet(rows: VariantRow[]): string {
  return toCsv(
    rows.map((r) => ({
      SKU: r.sku,
      Product: r.product,
      Size: r.label,
      Type: r.kind === 'sample' ? 'sample vial' : 'bottle',
      'Base price (₹)': r.base_price,
      'Price (₹)': r.price ?? '',
      'Compare-at price (₹)': r.compare_at_price ?? '',
      // Perfumes: one liquid amount per perfume (repeated on each of its rows); pieces: a count per size.
      'Liquid left (ml)': r.stock_unit === 'ml' ? r.liquid_ml : '',
      Stock: r.stock_unit === 'piece' ? r.stock : '',
    })),
    PRICE_STOCK_COLUMNS,
  );
}

export interface FieldChange {
  from: string;
  to: string;
}
export interface SizeChange {
  sku: string;
  product: string;
  label: string;
  price?: FieldChange;
  compare_at_price?: FieldChange;
  stock?: FieldChange;
  liquid?: FieldChange;
  /** What bulk_update_variants receives (only the fields that change). */
  payload: Record<string, unknown>;
}
export interface SheetProblem {
  line: number;
  sku: string;
  message: string;
}

const money = (n: number | null) => (n === null ? 'base price' : `₹${n.toLocaleString('en-IN')}`);
const parseMoney = (v: string): number | null | 'bad' => {
  const t = v.replace(/[₹,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 'bad';
};

/** Compares an uploaded sheet with the store. Columns that are missing from the sheet are left alone. */
export function diffPriceStock(text: string, current: VariantRow[]): { changes: SizeChange[]; problems: SheetProblem[]; rows: number } {
  const { headers, rows } = csvObjects(text);
  if (!headers.includes('sku')) {
    return { changes: [], problems: [{ line: 1, sku: '', message: 'The sheet needs a SKU column. Start from “Download the current sheet”.' }], rows: 0 };
  }
  const bySku = new Map(current.map((v) => [v.sku.toUpperCase(), v]));
  const hasPrice = headers.includes('price');
  const hasCompare = headers.includes('compare_at_price');
  const hasStock = headers.includes('stock');
  const hasLiquid = headers.includes('liquid_left');
  const liquidDone = new Map<string, number>();
  const seen = new Set<string>();
  const changes: SizeChange[] = [];
  const problems: SheetProblem[] = [];

  rows.forEach((r, i) => {
    const line = i + 2;
    const sku = (r.sku ?? '').trim().toUpperCase();
    if (!sku) return;
    if (seen.has(sku)) return void problems.push({ line, sku, message: 'This SKU appears twice in the sheet; only the first row is used.' });
    seen.add(sku);
    const v = bySku.get(sku);
    if (!v) return void problems.push({ line, sku, message: 'No size has this SKU. Add new sizes from the product page or the import tab.' });

    const change: SizeChange = { sku: v.sku, product: v.product, label: v.label, payload: { sku: v.sku } };
    if (hasPrice) {
      const p = parseMoney(r.price ?? '');
      if (p === 'bad') return void problems.push({ line, sku, message: `Price “${r.price}” isn't a number.` });
      if (p !== v.price) {
        change.price = { from: money(v.price), to: money(p) };
        change.payload.price = p;
      }
    }
    if (hasCompare) {
      const c = parseMoney(r.compare_at_price ?? '');
      if (c === 'bad') return void problems.push({ line, sku, message: `Compare-at price “${r.compare_at_price}” isn't a number.` });
      if (c !== v.compare_at_price) {
        change.compare_at_price = { from: v.compare_at_price === null ? 'none' : money(v.compare_at_price), to: c === null ? 'none' : money(c) };
        change.payload.compare_at_price = c;
      }
    }
    if (hasLiquid && v.stock_unit === 'ml' && (r.liquid_left ?? '').trim() !== '') {
      const ml = Number((r.liquid_left ?? '').replace(/[,\s]/g, ''));
      if (!Number.isFinite(ml) || ml < 0) return void problems.push({ line, sku, message: `Liquid left “${r.liquid_left}” must be a number of ml, 0 or more.` });
      const earlier = liquidDone.get(v.product_id);
      if (earlier !== undefined) {
        if (earlier !== ml) problems.push({ line, sku, message: `${v.product} has a different Liquid left on another row; the first row's ${earlier} ml is used.` });
      } else {
        liquidDone.set(v.product_id, ml);
        if (Math.round(ml * 100) !== Math.round(v.liquid_ml * 100)) {
          change.liquid = { from: `${v.liquid_ml.toLocaleString('en-IN')} ml`, to: `${ml.toLocaleString('en-IN')} ml` };
          change.payload.liquid_ml = ml;
        }
      }
    }
    if (hasStock && v.stock_unit === 'ml' && (r.stock ?? '').trim() !== '' && Number(r.stock) !== v.stock) {
      return void problems.push({ line, sku, message: `${v.product} is kept as liquid; change Liquid left (ml) instead of Stock.` });
    }
    if (hasStock && v.stock_unit === 'piece' && (r.stock ?? '').trim() !== '') {
      const n = Number((r.stock ?? '').replace(/[,\s]/g, ''));
      if (!Number.isInteger(n) || n < 0) return void problems.push({ line, sku, message: `Stock “${r.stock}” must be a whole number, 0 or more.` });
      if (n !== v.stock) {
        change.stock = { from: String(v.stock), to: String(n) };
        change.payload.stock = n;
      }
    }
    if (change.price || change.compare_at_price || change.stock || change.liquid) changes.push(change);
  });
  return { changes, problems, rows: rows.length };
}

// ============================================================ lookups shared with the product sheet
export interface Lookup {
  id: string;
  name: string;
  slug?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Finds a category, collection or note by name, slug or "Parent > Child" path. */
export function findByName(items: Lookup[], name: string): Lookup | undefined {
  const last = name.split(/>|›/).pop()!.trim();
  const n = norm(last);
  return items.find((c) => norm(c.name) === n || (c.slug && c.slug === slugify(last)));
}
