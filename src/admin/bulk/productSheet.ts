// The product sheet: one row per product on the Products tab, unusual sizes on the Other sizes tab. Pure functions
// (no Excel here) so the preview the admin sees is exactly what gets saved. The Excel file itself is built and read
// in productSheetXlsx.ts.
import {
  COMPLIANCE_FIELDS, autoSku, emptyProductForm, emptyVariant, slugify, validateProductForm,
  type NoteLink, type PageSectionForm, type ProductForm, type VariantForm,
} from '../catalog/productForm';
import { findByName, type Lookup } from './sheets';

type ComplianceKey = (typeof COMPLIANCE_FIELDS)[number][0];

export const OPTION_COLUMNS = [
  ['family', 'Fragrance family'],
  ['accord', 'Accords'],
  ['concentration', 'Concentration'],
  ['intensity', 'Intensity'],
  ['longevity', 'Longevity'],
  ['sillage', 'Sillage'],
  ['season', 'Seasons'],
  ['time_of_day', 'Day / night'],
  ['occasion', 'Occasions'],
  ['gender', 'Wear it as'],
] as const;
export type OptionKind = (typeof OPTION_COLUMNS)[number][0];
export type ChoiceList = 'categories' | 'collections' | 'notes' | 'products' | OptionKind;

/** Bottle sizes that get their own price columns. Anything else goes on the Other sizes tab. */
export const STANDARD_SIZES = [30, 50, 100] as const;

export interface SheetColumn {
  key: string;
  header: string;
  group: string;
  hint: string;
  required?: boolean;
  width?: number;
  /** Dropdown from the Choices tab; any other value can still be typed. */
  choices?: ChoiceList;
  /** Fixed dropdown; other values are refused by Excel. */
  fixed?: string[];
  /** Numbers (prices, ml, grams): the cell is left as a number, not text. */
  number?: boolean;
  /** Headers that also match this column (older sheets, short forms). */
  aliases?: string[];
}

export const YES_NO = ['yes', 'no'];
export const KEPT_AS = ['Liquid (ml)', 'Pieces'];
export const LIQUID_UNITS = ['ml', 'L', 'tola'];

const LABEL_HINTS: Partial<Record<ComplianceKey, string>> = {
  hsn_code: 'Blank = store default, e.g. 3303',
  gst_rate: 'Blank = store default, e.g. 18',
};

export const PRODUCT_COLUMNS: SheetColumn[] = [
  { key: 'name', header: 'Product name *', group: 'Basics', hint: 'Required. e.g. Amber Noir', required: true, width: 26, aliases: ['name', 'product'] },
  { key: 'main_category', header: 'Main category *', group: 'Basics', hint: 'Required. Pick from the list or type a new one', required: true, width: 20, choices: 'categories' },
  { key: 'short_description', header: 'Short description', group: 'Basics', hint: 'One or two lines under the name', width: 36 },
  { key: 'description', header: 'Full description', group: 'Basics', hint: 'Longer text for the product page. Line breaks are kept', width: 48 },
  { key: 'badge', header: 'Badge', group: 'Basics', hint: 'Small label on cards, e.g. NEW DROP', width: 14 },
  { key: 'concentration_note', header: 'Concentration line', group: 'Basics', hint: 'e.g. Extrait de Parfum · 38% pure oil', width: 30 },
  { key: 'handle', header: 'Web address', group: 'Basics', hint: 'Blank = made from the name (amber-noir)', width: 20, aliases: ['handle', 'slug', 'link'] },

  ...STANDARD_SIZES.map<SheetColumn>((s, i) => ({
    key: `price_${s}`, header: `${s} ml price`, group: 'Sizes and prices (₹, incl. GST)',
    hint: i === 0 ? 'Required: at least one price here or on Other sizes. Blank = size not sold' : 'e.g. 2900 · blank = not sold',
    width: 13, number: true,
  })),
  ...STANDARD_SIZES.map<SheetColumn>((s) => ({
    key: `mrp_${s}`, header: `${s} ml MRP`, group: 'Sizes and prices (₹, incl. GST)', hint: 'Optional, shown struck through', width: 12, number: true,
  })),

  { key: 'kept_as', header: 'Kept as', group: 'Stock', hint: 'Liquid for perfume, attar, oil · Pieces for sets, accessories · blank = Liquid', width: 14, fixed: KEPT_AS },
  { key: 'liquid_amount', header: 'Liquid in stock', group: 'Stock', hint: 'How much you have now, e.g. 1 · blank = 0', width: 12, number: true },
  { key: 'liquid_unit', header: 'Liquid unit', group: 'Stock', hint: 'ml, L or tola · blank = ml', width: 10, fixed: LIQUID_UNITS },
  { key: 'free_sample', header: 'Offer as free sample', group: 'Stock', hint: 'yes or no · blank = no', width: 12, fixed: YES_NO },

  { key: 'also_list_under', header: 'Also list under', group: "Where it's listed", hint: 'More categories, separated by |', width: 22, choices: 'categories' },
  { key: 'collections', header: 'Collections', group: "Where it's listed", hint: 'e.g. The Oud Edit · separate several with |', width: 22, choices: 'collections' },
  { key: 'related', header: 'You may also appreciate', group: "Where it's listed", hint: 'Product names, separated by | · blank = automatic', width: 28, choices: 'products' },

  { key: 'photos', header: 'Photos and videos', group: 'Photos', hint: 'File names (amber-noir-1.jpg) or full links, separated by | · first = main photo', width: 40 },

  ...OPTION_COLUMNS.map<SheetColumn>(([kind, header]) => ({
    key: kind, header, group: 'Scent type', choices: kind, width: kind === 'accord' ? 30 : 18,
    hint: kind === 'family'
      ? 'Several with |, the first is the main family'
      : kind === 'accord'
        ? 'Name and strength 1–100, e.g. Oud 80 | Amber 60'
        : 'Pick from the list · several with |',
  })),

  { key: 'top_notes', header: 'Top notes', group: 'Notes', hint: 'e.g. Saffron | Pink pepper', width: 26, choices: 'notes' },
  { key: 'heart_notes', header: 'Heart notes', group: 'Notes', hint: 'e.g. Rose | Jasmine', width: 26, choices: 'notes' },
  { key: 'base_notes', header: 'Base notes', group: 'Notes', hint: 'e.g. Oud | Amber', width: 26, choices: 'notes' },

  { key: 'perfumer', header: 'Perfumer / nose', group: 'The story', hint: 'Optional', width: 18 },
  { key: 'launch_year', header: 'Launch year', group: 'The story', hint: 'e.g. 2024', width: 10, number: true },
  { key: 'inspiration', header: 'Inspiration', group: 'The story', hint: 'The story behind the scent', width: 40 },
  { key: 'how_to_wear', header: 'How to wear', group: 'The story', hint: 'e.g. Two sprays on the wrists', width: 32 },

  ...[1, 2, 3].flatMap<SheetColumn>((n) => [
    { key: `section${n}_title`, header: `Section ${n} title`, group: 'Extra page sections', hint: n === 1 ? 'Drop-down section on the product page, e.g. The ritual' : 'Optional', width: 18 },
    { key: `section${n}_text`, header: `Section ${n} text`, group: 'Extra page sections', hint: 'What the section says', width: 36 },
  ]),
  { key: 'default_sections', header: "Also show the store's default sections", group: 'Extra page sections', hint: 'yes or no · blank = yes', width: 14, fixed: YES_NO },

  { key: 'vegan', header: 'Vegan', group: 'Label details', hint: 'yes or no · blank = no', width: 9, fixed: YES_NO },
  { key: 'cruelty_free', header: 'Cruelty free', group: 'Label details', hint: 'yes or no · blank = no', width: 10, fixed: YES_NO },
  ...COMPLIANCE_FIELDS.map<SheetColumn>(([key, label]) => ({
    key, header: label, group: 'Label details', hint: LABEL_HINTS[key] ?? "Blank = the store's details",
    width: key.endsWith('address') || key === 'ingredients' || key === 'caution_text' ? 30 : 18,
    number: key === 'gst_rate',
  })),

  { key: 'live', header: 'Live on the store', group: 'Visibility', hint: 'yes = on sale straight away · blank = draft', width: 11, fixed: YES_NO },
  { key: 'featured', header: 'Featured', group: 'Visibility', hint: 'yes or no · blank = no', width: 10, fixed: YES_NO },
  { key: 'earns_samples', header: 'Earns free samples', group: 'Visibility', hint: 'yes or no · blank = yes', width: 11, fixed: YES_NO },
  { key: 'surface_only', header: 'Ships by surface only', group: 'Visibility', hint: 'For alcohol-based perfume · blank = yes', width: 12, fixed: YES_NO },

  ...STANDARD_SIZES.flatMap<SheetColumn>((s) => [
    { key: `weight_${s}`, header: `${s} ml parcel weight (g)`, group: 'Parcel (for couriers)', hint: 'e.g. 250', width: 12, number: true },
    { key: `box_${s}`, header: `${s} ml box L × W × H (mm)`, group: 'Parcel (for couriers)', hint: 'e.g. 60x60x120', width: 14 },
  ]),

  { key: 'seo_title', header: 'Google title', group: 'Google and notes', hint: 'Blank = automatic', width: 26 },
  { key: 'seo_description', header: 'Google description', group: 'Google and notes', hint: 'Blank = automatic', width: 36 },
  { key: 'admin_note', header: 'Internal note', group: 'Google and notes', hint: 'Only admins see this', width: 26 },
];

export const SIZE_COLUMNS: SheetColumn[] = [
  { key: 'product', header: 'Product name *', group: '', hint: 'Required. Exactly as on the Products tab', required: true, width: 26, aliases: ['product', 'name'] },
  { key: 'label', header: 'Size *', group: '', hint: 'Required. e.g. 6 ml or Gift box', required: true, width: 16, aliases: ['size label'] },
  { key: 'size_ml', header: 'Size in ml', group: '', hint: 'Needed for liquid products, e.g. 6', width: 10, number: true },
  { key: 'price', header: 'Price *', group: '', hint: 'Required. ₹ incl. GST', required: true, width: 11, number: true },
  { key: 'mrp', header: 'MRP', group: '', hint: 'Optional, shown struck through', width: 11, number: true },
  { key: 'sku', header: 'SKU', group: '', hint: 'Blank = automatic', width: 18 },
  { key: 'stock', header: 'Opening stock', group: '', hint: 'Pieces products only, e.g. 25', width: 12, number: true },
  { key: 'weight', header: 'Parcel weight (g)', group: '', hint: 'e.g. 250', width: 12, number: true },
  { key: 'box', header: 'Box L × W × H (mm)', group: '', hint: 'e.g. 60x60x120', width: 14 },
];

// ============================================================ reading a grid of cells
export interface SheetRow {
  /** Row number as the spreadsheet shows it. */
  line: number;
  v: Record<string, string>;
}

const headerNorm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|₹|\*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Finds the header row (it may sit under a row of group names), maps headers to columns and skips the hint row. */
export function readGrid(grid: string[][], columns: SheetColumn[]): { rows: SheetRow[]; found: boolean; missing: string[] } {
  const byHeader = new Map<string, string>();
  for (const c of columns) for (const h of [c.header, ...(c.aliases ?? [])]) byHeader.set(headerNorm(h), c.key);
  const first = columns[0];
  const firstHeaders = new Set([first.header, ...(first.aliases ?? [])].map(headerNorm));
  const headerAt = grid.slice(0, 8).findIndex((r) => r.some((cell) => firstHeaders.has(headerNorm(cell ?? ''))));
  if (headerAt < 0) return { rows: [], found: false, missing: [] };
  const keys = grid[headerAt].map((h) => byHeader.get(headerNorm(h ?? '')) ?? '');
  const missing = columns.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.header.replace(' *', ''));
  const rows: SheetRow[] = [];
  grid.slice(headerAt + 1).forEach((cells, i) => {
    const v: Record<string, string> = {};
    keys.forEach((k, j) => {
      if (k && !(k in v && v[k])) v[k] = String(cells[j] ?? '').trim();
    });
    if (!Object.values(v).some(Boolean)) return;
    // The grey hint row under the headers.
    if ((v[first.key] ?? '') === first.hint) return;
    rows.push({ line: headerAt + i + 2, v });
  });
  return { rows, found: true, missing };
}

// ============================================================ planning the import
export interface MediaRef {
  /** File name as uploaded (or the end of its storage path). */
  name: string;
  url: string;
  kind: string;
}

export interface PlanContext {
  categories: Lookup[];
  collections: Lookup[];
  notes: Lookup[];
  options: (Lookup & { kind: string })[];
  /** Products already in the store. */
  products: Lookup[];
  existingSkus: Set<string>;
  media: MediaRef[];
  /** Settings → Product details, used where the sheet leaves a label detail empty. */
  defaults: Partial<Record<ComplianceKey, string>>;
  sampleSize: number;
}

export interface PlannedOption {
  kind: OptionKind;
  label: string;
  strength: number | null;
  primary: boolean;
}

export interface PlannedProduct {
  handle: string;
  line: number;
  form: ProductForm;
  sizes: number;
  mainCategory: string;
  extraCategories: string[];
  collectionNames: string[];
  noteNames: { tier: NoteLink['tier']; name: string }[];
  options: PlannedOption[];
  related: string[];
  sections: PageSectionForm[];
  useDefaultSections: boolean;
  /** Names that don't exist yet and will be created on import. */
  create: { categories: string[]; collections: string[]; notes: string[]; options: { kind: OptionKind; label: string }[] };
  errors: string[];
  warnings: string[];
}

export interface SheetPlan {
  products: PlannedProduct[];
  /** Rows whose product is already in the store; left alone. */
  existing: { line: number; name: string; handle: string }[];
  problems: string[];
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(/[|;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const uniq = <T>(xs: T[]) => [...new Set(xs)];

function yesNo(v: string | undefined, fallback: boolean): boolean | 'bad' {
  const t = (v ?? '').trim();
  if (!t) return fallback;
  if (/^(y|yes|true|1|on|live)$/i.test(t)) return true;
  if (/^(n|no|false|0|off|draft)$/i.test(t)) return false;
  return 'bad';
}

/** '₹2,900' → '2900'; '' → ''; anything else that isn't a number → null. */
function money(v: string | undefined): string | null {
  const t = (v ?? '').replace(/₹|rs\.?|inr|,|\s/gi, '');
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100) / 100) : null;
}

function wholeNumber(v: string | undefined): string | null {
  const t = (v ?? '').replace(/[,\s]|g$|gm$|grams?$/gi, '');
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n)) : null;
}

/** '60x60x120', '60 × 60 × 120', '60*60*120' → three sizes; '' → empty; anything else → null. */
function box(v: string | undefined): [string, string, string] | null {
  const t = (v ?? '').trim();
  if (!t) return ['', '', ''];
  const parts = t.replace(/mm/gi, '').split(/\s*[x×*X,/]\s*/).filter(Boolean);
  if (parts.length !== 3 || parts.some((p) => !(Number(p) > 0))) return null;
  return parts.map((p) => String(Math.round(Number(p)))) as [string, string, string];
}

/** 'Oud 80', 'Oud: 80', 'Oud (80)', 'Oud 80%' → Oud at 80; 'Oud' → Oud at 70. */
function accord(text: string): { label: string; strength: number } {
  const m = text.match(/^(.*?)[\s:–-]*\(?\s*(\d{1,3})\s*%?\s*\)?$/);
  if (m && m[1].trim()) return { label: m[1].trim(), strength: Number(m[2]) };
  return { label: text.trim(), strength: 70 };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text from a cell → the rich-text HTML the product page shows. Blank lines start a new paragraph. */
export function textToHtml(v: string | undefined): string {
  const t = (v ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  return t
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const baseName = (s: string) => s.trim().split(/[\\/]/).pop()!.toLowerCase();
const VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

function findOption(options: PlanContext['options'], kind: string, label: string) {
  const n = norm(label);
  return options.find((o) => o.kind === kind && (norm(o.name) === n || (o.slug && o.slug === slugify(label))));
}

const FRIENDLY_FIELD: Record<string, string> = {
  name: 'Product name',
  slug: 'Web address',
  launch_year: 'Launch year',
  gst_rate: 'GST rate',
  liquid_amount: 'Liquid in stock',
  compare_at_price: 'MRP',
};

export function planProductSheet(sheet: { products: SheetRow[]; sizes: SheetRow[] }, ctx: PlanContext): SheetPlan {
  const problems: string[] = [];
  const existing: SheetPlan['existing'] = [];
  const products: PlannedProduct[] = [];
  const existingSlugs = new Set(ctx.products.map((p) => p.slug ?? ''));
  const sheetSkus = new Set<string>();
  const seenHandles = new Set<string>();
  const claimed = new Set<SheetRow>();
  const sheetNames = new Set(sheet.products.flatMap((r) => [norm(r.v.name ?? ''), slugify(r.v.handle || r.v.name || '')]).filter(Boolean));
  const mediaByName = new Map<string, MediaRef>();
  // Newest first wins when two uploads share a file name.
  for (const m of ctx.media) if (!mediaByName.has(baseName(m.name))) mediaByName.set(baseName(m.name), m);

  for (const r of sheet.products) {
    const v = r.v;
    const name = (v.name ?? '').trim();
    const handle = slugify(v.handle || name);
    if (!name && !handle) continue;
    const sizeRows = sheet.sizes.filter((s) => {
      const key = (s.v.product ?? '').trim();
      return key && (norm(key) === norm(name) || slugify(key) === handle);
    });
    sizeRows.forEach((s) => claimed.add(s));
    if (!name) {
      problems.push(`Products row ${r.line}: no product name, so it was skipped.`);
      continue;
    }
    if (existingSlugs.has(handle)) {
      existing.push({ line: r.line, name, handle });
      continue;
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    if (seenHandles.has(handle)) errors.push(`Another row above has the same name or web address (${handle}).`);
    seenHandles.add(handle);

    const form = emptyProductForm(ctx.defaults);
    form.slug = handle;
    form.name = name;
    form.short_description = v.short_description ?? '';
    form.description = textToHtml(v.description);
    form.badge = v.badge ?? '';
    form.concentration_note = v.concentration_note ?? '';
    form.perfumer = v.perfumer ?? '';
    form.launch_year = v.launch_year ?? '';
    form.inspiration = textToHtml(v.inspiration);
    form.how_to_wear = textToHtml(v.how_to_wear);
    form.seo_title = v.seo_title ?? '';
    form.seo_description = v.seo_description ?? '';
    form.admin_note = v.admin_note ?? '';
    for (const [k] of COMPLIANCE_FIELDS) {
      const cell = (v[k] ?? '').trim();
      if (cell) form[k] = k === 'gst_rate' ? cell.replace(/%/g, '').trim() : cell;
    }

    const flag = (key: string, header: string, fallback: boolean) => {
      const b = yesNo(v[key], fallback);
      if (b === 'bad') {
        errors.push(`${header}: “${v[key]}” should be yes or no.`);
        return fallback;
      }
      return b;
    };
    form.is_active = flag('live', 'Live on the store', false);
    form.is_featured = flag('featured', 'Featured', false);
    form.counts_toward_samples = flag('earns_samples', 'Earns free samples', true);
    form.ships_surface_only = flag('surface_only', 'Ships by surface only', true);
    form.is_vegan = flag('vegan', 'Vegan', false);
    form.is_cruelty_free = flag('cruelty_free', 'Cruelty free', false);
    const freeSample = flag('free_sample', 'Offer as free sample', false);
    const useDefaultSections = flag('default_sections', "Also show the store's default sections", true);

    const kept = (v.kept_as ?? '').trim();
    form.stock_unit = /piece|pcs|count|unit/i.test(kept) ? 'piece' : 'ml';
    if (kept && !/piece|pcs|count|unit|liquid|ml/i.test(kept)) errors.push(`Kept as: “${kept}” should be Liquid (ml) or Pieces.`);
    const liquid = wholeOrDecimal(v.liquid_amount);
    if (liquid === null) errors.push(`Liquid in stock: “${v.liquid_amount}” isn't a number.`);
    else form.liquid_amount = liquid;
    const unit = (v.liquid_unit ?? '').trim().toLowerCase();
    form.liquid_unit = ['l', 'litre', 'liter', 'litres', 'liters'].includes(unit) ? 'L' : unit === 'tola' ? 'tola' : 'ml';
    if (unit && !['ml', 'l', 'litre', 'liter', 'litres', 'liters', 'tola'].includes(unit)) errors.push(`Liquid unit: “${v.liquid_unit}” should be ml, L or tola.`);

    // ---- sizes
    const variants: VariantForm[] = [];
    const parcel = (weightRaw: string | undefined, boxRaw: string | undefined, where: string, sv: VariantForm) => {
      const w = wholeNumber(weightRaw);
      if (w === null) errors.push(`${where} parcel weight: “${weightRaw}” isn't a number of grams.`);
      else sv.weight_g = w;
      const b = box(boxRaw);
      if (!b) errors.push(`${where} box: “${boxRaw}” should look like 60x60x120 (mm).`);
      else [sv.length_mm, sv.width_mm, sv.height_mm] = b;
    };
    for (const s of STANDARD_SIZES) {
      const price = money(v[`price_${s}`]);
      const mrp = money(v[`mrp_${s}`]);
      if (price === null) errors.push(`${s} ml price: “${v[`price_${s}`]}” isn't a number.`);
      if (mrp === null) errors.push(`${s} ml MRP: “${v[`mrp_${s}`]}” isn't a number.`);
      if (!price) {
        if (mrp || v[`weight_${s}`] || v[`box_${s}`]) warnings.push(`${s} ml has details but no price, so ${s} ml isn't sold.`);
        continue;
      }
      const sv = { ...emptyVariant(), label: `${s} ml`, size_ml: String(s), price, compare_at_price: mrp ?? '' };
      parcel(v[`weight_${s}`], v[`box_${s}`], `${s} ml`, sv);
      variants.push(sv);
    }
    for (const s of sizeRows) {
      const where = `Other sizes row ${s.line}`;
      const label = (s.v.label ?? '').trim();
      if (!label) {
        errors.push(`${where}: add the size, e.g. 6 ml or Gift box.`);
        continue;
      }
      let ml = (s.v.size_ml ?? '').replace(/ml/i, '').trim();
      if (!ml) ml = label.match(/^(\d+(?:\.\d+)?)\s*ml$/i)?.[1] ?? '';
      if (ml && !(Number(ml) > 0)) errors.push(`${where}: size in ml “${s.v.size_ml}” isn't a number.`);
      const price = money(s.v.price);
      if (price === null) errors.push(`${where}: price “${s.v.price}” isn't a number.`);
      else if (!price) errors.push(`${where}: add a price for ${label}.`);
      const mrp = money(s.v.mrp);
      if (mrp === null) errors.push(`${where}: MRP “${s.v.mrp}” isn't a number.`);
      const stock = wholeNumber(s.v.stock);
      if (stock === null) errors.push(`${where}: opening stock “${s.v.stock}” should be a whole number.`);
      if (stock && form.stock_unit === 'ml') warnings.push(`${label}: opening stock is only used for products kept as Pieces; liquid products use Liquid in stock.`);
      if (variants.some((x) => norm(x.label) === norm(label) || (ml && x.size_ml === String(Number(ml))))) {
        errors.push(`${label} is filled twice (on the Products tab or above on Other sizes).`);
        continue;
      }
      const sv = {
        ...emptyVariant(), label, size_ml: ml ? String(Number(ml)) : '', price: price ?? '', compare_at_price: mrp ?? '',
        sku: (s.v.sku ?? '').trim().toUpperCase(), initial_stock: stock ?? '',
      };
      parcel(s.v.weight, s.v.box, label, sv);
      variants.push(sv);
    }
    const prices = variants.map((x) => Number(x.price)).filter((n) => Number.isFinite(n) && n > 0);
    form.base_price = prices.length ? String(Math.min(...prices)) : '';
    if (freeSample) {
      variants.push({ ...emptyVariant(), kind: 'sample', label: `${ctx.sampleSize} ml sample`, size_ml: String(ctx.sampleSize), in_sample_pool: true });
    }
    form.variants = variants;
    for (const x of variants) {
      const sku = (x.sku || autoSku(handle, x)).toUpperCase();
      if (ctx.existingSkus.has(sku)) errors.push(`SKU ${sku} is already used by another product. Type a different SKU on the Other sizes tab, or change the web address.`);
      else if (sheetSkus.has(sku)) errors.push(`SKU ${sku} appears twice in the sheet.`);
      sheetSkus.add(sku);
    }

    // ---- where it's listed
    const mainCategory = (v.main_category ?? '').trim();
    form.primary_category_id = mainCategory ? 'pending' : '';
    if (!mainCategory) errors.push('Add a main category.');
    const extraCategories = list(v.also_list_under).filter((c) => norm(c) !== norm(mainCategory));
    const collectionNames = list(v.collections);
    const related = list(v.related).filter((n) => norm(n) !== norm(name) && slugify(n) !== handle);
    for (const n of related) {
      const known = ctx.products.some((p) => norm(p.name) === norm(n) || p.slug === slugify(n)) || sheetNames.has(norm(n)) || sheetNames.has(slugify(n));
      if (!known) warnings.push(`“${n}” (You may also appreciate) isn't a product here, so it's left out.`);
    }

    // ---- photos
    for (const typed of list(v.photos)) {
      if (/^https?:\/\//i.test(typed)) {
        form.media.push({ kind: VIDEO.test(typed) ? 'video' : 'image', url: typed, alt: name, variant_sku: '' });
        continue;
      }
      const m = mediaByName.get(baseName(typed));
      if (!m) errors.push(`Photo “${typed}” isn't in the Media library. Upload it there first, then upload this sheet again.`);
      else if (m.kind !== 'image' && m.kind !== 'video') errors.push(`“${typed}” isn't a photo or video.`);
      else form.media.push({ kind: m.kind, url: m.url, alt: name, variant_sku: '' });
    }

    // ---- scent type
    const options: PlannedOption[] = [];
    for (const [kind, header] of OPTION_COLUMNS) {
      list(v[kind]).forEach((typed, i) => {
        const a = kind === 'accord' ? accord(typed) : { label: typed, strength: null };
        if (a.strength !== null && !(a.strength >= 1 && a.strength <= 100)) errors.push(`${header}: strength for ${a.label} must be 1 to 100.`);
        if (!options.some((o) => o.kind === kind && norm(o.label) === norm(a.label))) {
          options.push({ kind, label: a.label, strength: kind === 'accord' ? a.strength : null, primary: kind === 'family' && i === 0 });
        }
      });
    }
    const noteNames = (['top', 'heart', 'base'] as const).flatMap((tier) => list(v[`${tier}_notes`]).map((n) => ({ tier, name: n })));
    const dupNote = noteNames.find((n, i) => noteNames.findIndex((x) => norm(x.name) === norm(n.name)) !== i);
    if (dupNote) warnings.push(`${dupNote.name} is in more than one notes column; it's kept once, in the first.`);

    // ---- page sections
    const sections: PageSectionForm[] = [];
    for (const n of [1, 2, 3]) {
      const title = (v[`section${n}_title`] ?? '').trim();
      const text = v[`section${n}_text`] ?? '';
      if (!title && text.trim()) errors.push(`Section ${n} has text but no title.`);
      if (title) sections.push({ title, body: textToHtml(text) });
    }

    // ---- the form's own checks, in plain words
    for (const [k, msg] of Object.entries(validateProductForm(form))) {
      if (k === 'primary_category_id' || k === 'base_price') continue;
      if (k === 'variants') {
        errors.push('Fill at least one price (30, 50 or 100 ml), or add a size on the Other sizes tab.');
        continue;
      }
      const m = k.match(/^variants\.(\d+)\.(\w+)$/);
      if (m) {
        const sv = form.variants[Number(m[1])];
        const text = m[2] === 'size_ml' && form.stock_unit === 'ml' ? 'add its size in ml (this product is kept as liquid).' : msg.charAt(0).toLowerCase() + msg.slice(1);
        errors.push(`${sv?.label || 'A size'}: ${text}`);
        continue;
      }
      errors.push(`${FRIENDLY_FIELD[k] ?? k}: ${msg}`);
    }

    const missing = (items: Lookup[], names: string[]) => names.filter((n) => !findByName(items, n));
    products.push({
      handle,
      line: r.line,
      form,
      sizes: variants.filter((x) => x.kind === 'retail').length,
      mainCategory,
      extraCategories,
      collectionNames,
      noteNames,
      options,
      related,
      sections,
      useDefaultSections,
      create: {
        categories: uniq(missing(ctx.categories, [mainCategory, ...extraCategories].filter(Boolean))),
        collections: uniq(missing(ctx.collections, collectionNames)),
        notes: uniq(missing(ctx.notes, noteNames.map((n) => n.name))),
        options: options.filter((o) => !findOption(ctx.options, o.kind, o.label)).map((o) => ({ kind: o.kind, label: o.label })),
      },
      errors: uniq(errors),
      warnings: uniq(warnings),
    });
  }

  for (const s of sheet.sizes) {
    if (claimed.has(s)) continue;
    const key = (s.v.product ?? '').trim();
    problems.push(key ? `Other sizes row ${s.line}: no product called “${key}” on the Products tab, so it was skipped.` : `Other sizes row ${s.line}: no product name, so it was skipped.`);
  }
  return { products, existing, problems };
}

function wholeOrDecimal(v: string | undefined): string | null {
  const t = (v ?? '').replace(/[,\s]/g, '');
  if (t === '') return '';
  return Number.isFinite(Number(t)) && Number(t) >= 0 ? t : null;
}

/** Everything the products need that isn't in the store yet, across the whole sheet (one of each). */
export function toCreate(products: PlannedProduct[]) {
  const by = <T>(items: T[], key: (x: T) => string) => [...new Map(items.map((x) => [key(x), x])).values()];
  return {
    categories: by(products.flatMap((p) => p.create.categories), norm),
    collections: by(products.flatMap((p) => p.create.collections), norm),
    notes: by(products.flatMap((p) => p.create.notes), norm),
    options: by(products.flatMap((p) => p.create.options), (o) => `${o.kind}:${norm(o.label)}`),
  };
}

/** Fills in the category, collection, note and scent ids once they all exist. */
export function resolveForm(p: PlannedProduct, ctx: Pick<PlanContext, 'categories' | 'collections' | 'notes' | 'options'>): ProductForm {
  const id = (items: Lookup[], name: string) => findByName(items, name)?.id;
  const form: ProductForm = { ...p.form };
  form.primary_category_id = id(ctx.categories, p.mainCategory) ?? '';
  form.category_ids = uniq(p.extraCategories.map((n) => id(ctx.categories, n)).filter((x): x is string => !!x && x !== form.primary_category_id));
  form.collection_ids = uniq(p.collectionNames.map((n) => id(ctx.collections, n)).filter((x): x is string => !!x));
  const seen = new Set<string>();
  form.notes = p.noteNames
    .map((n) => ({ note_id: id(ctx.notes, n.name) ?? '', tier: n.tier }))
    .filter((n) => n.note_id && !seen.has(n.note_id) && !!seen.add(n.note_id))
    .map((n, i) => ({ ...n, position: i }));
  const optionIds = new Set<string>();
  form.attributes = p.options
    .map((o) => ({ o, row: findOption(ctx.options, o.kind, o.label) }))
    .filter(({ row }) => row && !optionIds.has(row.id) && !!optionIds.add(row.id))
    .map(({ o, row }) => ({ option_id: row!.id, kind: o.kind, strength: o.strength, is_primary: o.primary }));
  form.page_sections = p.sections;
  form.use_default_sections = p.useDefaultSections;
  return form;
}

/** “You may also appreciate” names → product ids, once every product in the sheet exists. */
export function relatedIds(names: string[], products: Lookup[], selfId: string): string[] {
  const out: string[] = [];
  for (const n of names) {
    const hit = products.find((p) => norm(p.name) === norm(n) || p.slug === slugify(n));
    if (hit && hit.id !== selfId && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

// ============================================================ the example rows in the template
export const EXAMPLE_PRODUCTS: Record<string, string>[] = [
  {
    name: 'Amber Noir', main_category: 'Perfumes', short_description: 'A warm amber for evenings.',
    description: 'Saffron and pink pepper open onto a heart of rose.\n\nIt dries down to amber and oud that lasts all night.',
    badge: 'NEW DROP', concentration_note: 'Extrait de Parfum · 30% pure oil',
    price_30: '1900', price_50: '2900', price_100: '4900', mrp_100: '5500',
    kept_as: 'Liquid (ml)', liquid_amount: '1', liquid_unit: 'L', free_sample: 'yes',
    also_list_under: 'Gift ideas', collections: 'The Oud Edit', related: 'Musk Attar',
    photos: 'amber-noir-1.jpg | amber-noir-2.jpg',
    family: 'Amber | Woody', accord: 'Amber 85 | Oud 60 | Spicy 40', concentration: 'Extrait de Parfum', intensity: 'Strong',
    longevity: '8–10 hours', sillage: 'Moderate', season: 'Autumn | Winter', time_of_day: 'Night', occasion: 'Evening | Wedding', gender: 'Unisex',
    top_notes: 'Saffron | Pink pepper', heart_notes: 'Rose', base_notes: 'Amber | Oud',
    launch_year: '2024', inspiration: 'Inspired by old Hyderabad attar shops at dusk.', how_to_wear: 'Two sprays on the wrists and neck.',
    section1_title: 'The ritual', section1_text: 'Spray on warm skin after a shower.',
    vegan: 'yes', cruelty_free: 'yes', live: 'yes', weight_30: '180', box_30: '60x60x120', weight_50: '250', box_50: '70x70x140',
  },
  {
    name: 'Musk Attar', main_category: 'Attars', short_description: 'Soft white musk oil, alcohol free.',
    kept_as: 'Liquid (ml)', liquid_amount: '500', liquid_unit: 'ml', family: 'Musky', surface_only: 'no', live: 'no',
  },
  {
    name: 'Oud Gift Box', main_category: 'Gift sets', short_description: 'Three oud minis in a wooden box.', kept_as: 'Pieces', live: 'no',
  },
];

export const EXAMPLE_SIZES: Record<string, string>[] = [
  { product: 'Musk Attar', label: '3 ml', size_ml: '3', price: '450' },
  { product: 'Musk Attar', label: '6 ml', size_ml: '6', price: '850', mrp: '990' },
  { product: 'Musk Attar', label: '12 ml', size_ml: '12', price: '1500' },
  { product: 'Oud Gift Box', label: 'Gift box', price: '3500', stock: '25', weight: '600', box: '200x150x80' },
];
