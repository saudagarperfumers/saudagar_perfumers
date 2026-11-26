// Moves the old WooCommerce shop's content (scripts/old-site/snapshot.json + the curated catalog/*.json) onto our store.
// Products go through save_product, the same path as the product editor and the spreadsheet import.
//
//   node --env-file=.env.local scripts/old-site/import.mjs --drive <folder with the owner's Drive photos> --dry
//   node --env-file=.env.local scripts/old-site/import.mjs --drive <folder>            (writes to the live database)
//
// --dry   builds everything and writes scripts/old-site/out/preview.json without touching the database or storage.
// Safe to re-run: products are matched by their web address, photos by their storage path.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { env, mgmt, runSql as runSqlOnce } from '../lib/mgmt.mjs';
import { emptyProductForm, emptyVariant, toSavePayload, slugify } from '../../src/admin/catalog/productForm.ts';

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry');
// --only site: photos, categories, pages, home sections and site text only (no product saves, nothing removed).
const SITE_ONLY = ARGS.includes('--only') && ARGS[ARGS.indexOf('--only') + 1] === 'site';
const DRIVE_DIR = ARGS[ARGS.indexOf('--drive') + 1];
if (!ARGS.includes('--drive') || !DRIVE_DIR || !existsSync(DRIVE_DIR)) throw new Error('Pass --drive <folder with the Drive photos>.');

const here = (p) => new URL(p, import.meta.url);
const OUT = fileURLToPath(here('./out/'));
mkdirSync(OUT, { recursive: true });
const snap = JSON.parse(readFileSync(here('./snapshot.json'), 'utf8'));
const catalog = Object.assign({}, ...['part1', 'part2', 'part3'].map((p) => JSON.parse(readFileSync(here(`./catalog/${p}.json`), 'utf8'))));

// ------------------------------------------------------------------ decisions (docs/superpowers/specs/2026-11-26-old-site-content-import-design.md)
const MERGED = { 'hudson-valley-copy': 'hudson-valley', 'guidance-2': 'guidance', khamra: 'khamarah', srk: 'ssrk', aventus: 'creed-aventus' };
const COMBOS = {
  'saudagar-premium-perfume-gift-set-5-x-20-ml-100-ml': { label: '5 × 20 ml', weight: 700 },
  'raksha-bandhan-special-fragrance-combo': { label: 'Combo', weight: 600 },
  '3-piece-perfume-combo': { label: '3 bottles', weight: 700 },
  'saudagar-20ml-x-4-piece-perfume-collection': { label: '4 × 20 ml', weight: 600 },
};
const SLUG_OVERRIDE = { 'saudagar-premium-perfume-gift-set-5-x-20-ml-100-ml': 'saudagar-premium-perfume-gift-set' };
const CATEGORIES = [
  { slug: 'men', name: 'Men', from: 'mens', image: 'black_code.png' },
  { slug: 'women', name: 'Women', from: 'womens', image: 'white_code.png' },
  { slug: 'unisex', name: 'Unisex', from: 'unisex', image: 'ocean_blue_3.png' },
  { slug: 'inspired-perfumes', name: 'Inspired Perfumes', from: 'inspired-perfumes', image: 'ocean_blue_2.png' },
  { slug: 'floral-perfumes', name: 'Floral Perfumes', from: 'floral-perfumes', image: 'white_code_3.png' },
  { slug: 'new-perfumes', name: 'New Perfumes', from: 'new-perfumes', image: 'combo_pack.png' },
  { slug: 'signature-fragrances', name: 'Signature Fragrances', image: 'ocean_blue.png', products: ['ocean-blue-perfume', 'white-code-perfume', 'black-code-perfume', 'ice-land'] },
  { slug: 'new-collections', name: 'New Collections', image: 'combo_pack.png', products: Object.keys(COMBOS) },
];
const PRIMARY_ORDER = ['signature-fragrances', 'new-collections', 'inspired-perfumes', 'floral-perfumes', 'new-perfumes', 'men', 'women', 'unisex'];
const GENDER_FROM_CATEGORY = { mens: 'masculine', womens: 'feminine', unisex: 'unisex' };
const STOCK_ML = 1000; // owner: 1 L for every in-stock perfume, 0 for out of stock
// By what is printed on the bottle: saudagar_perfumers_30ml.png (gold cap) reads "50 ML", so it stays in the library only.
const DRIVE_BY_SIZE = { 30: ['saudagar_perfumers_30ml_2.png'], 50: ['saudagar_perfumers_50ml.png'], 100: ['saudagar_perfumers_100ml.png'] };
const OWN_PHOTOS = {
  'ocean-blue-perfume': ['ocean_blue.png', 'ocean_blue_2.png', 'ocean_blue_3.png'],
  'white-code-perfume': ['white_code.png', 'white_code_2.png', 'white_code_3.png'],
  'black-code-perfume': ['black_code.png'],
};
const KEEP_OLD_PHOTOS = ['saudagar-premium-perfume-gift-set-5-x-20-ml-100-ml', 'raksha-bandhan-special-fragrance-combo', '3-piece-perfume-combo', 'saudagar-20ml-x-4-piece-perfume-collection', 'fakhir-attar'];
const WEIGHT_G = { 5: 15, 12: 100, 30: 300, 50: 450, 100: 650 };
const LAUNCH_YEAR = 2026;
const PERFUMER = 'Saudagar Perfumers';
const SITE = {
  address: 'Anakapalle Bypass, opposite Union Bank, Woodpeta, Anakapalle, Andhra Pradesh 531001',
  email: 'saudagarperfumers@gmail.com',
};
const OPTION_KINDS = ['family', 'accord', 'gender', 'concentration', 'intensity', 'longevity', 'sillage', 'season', 'time_of_day', 'occasion'];

// ------------------------------------------------------------------ helpers
const NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket hang up|\(5\d\d\)/i;
/** Retries a step when the connection drops (the Management API resets connections now and then). */
async function withRetry(fn, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = `${err?.message ?? ''} ${err?.cause?.code ?? ''} ${err?.cause?.message ?? ''}`;
      if (i >= attempts || !NETWORK.test(msg)) throw err;
      console.log(`  (connection dropped, retrying in ${2 * i}s)`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}
const runSql = (query) => withRetry(() => runSqlOnce(query));
const decode = (s) =>
  String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”').replace(/&nbsp;/g, ' ').replace(/&#038;/g, '&').replace(/&quot;/g, '"');
const text = (html) => decode(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|li|div)>/gi, '\n').replace(/<[^>]+>/g, ''))
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sql = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => {
  const body = JSON.stringify(v);
  if (body.includes('$j$')) throw new Error('payload contains $j$');
  return `$j$${body}$j$::jsonb`;
};
const sizeOf = (label) => {
  const n = Number(String(label).replace(',', '.').match(/[\d.]+/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const fileName = (url) => decodeURIComponent(url.split('/').pop());

/** WordPress / Elementor page HTML → the plain formatted text our pages use (p, h2, h3, lists, bold, links). */
export function cleanHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<(script|style|iframe|form|button|select|textarea|noscript|svg|label)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(input|hr|img)[^>]*>/gi, '');
  s = s.replace(/<span[^>]*font-weight:\s*(?:600|700|bold)[^>]*>([\s\S]*?)<\/span>/gi, '<strong>$1</strong>');
  const MAP = { h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'p', h6: 'p', b: 'strong', strong: 'strong', i: 'em', em: 'em', p: 'p', ul: 'ul', ol: 'ol', li: 'li', br: 'br', a: 'a' };
  s = s.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (_m, close, tag, attrs) => {
    const t = MAP[tag.toLowerCase()];
    if (!t) return '';
    if (t === 'br') return '<br>';
    if (t === 'a') {
      if (close) return '</a>';
      const href = /href="([^"]*)"/i.exec(attrs)?.[1] ?? '';
      return /^(mailto:|tel:)/.test(href) ? `<a href="${href}">` : '<a>';
    }
    return `<${close}${t}>`;
  });
  s = s.replace(/<a>([\s\S]*?)<\/a>/g, '$1');
  s = decode(s).replace(/&#\d+;/g, ' ').replace(/[ \t\r\n]+/g, ' ');
  for (let i = 0; i < 4; i++) s = s.replace(/<(p|h2|h3|strong|em|li|ul|ol)>\s*(<br>\s*)*<\/\1>/g, '');
  s = s.replace(/<(h2|h3)>\s*<strong>([\s\S]*?)<\/strong>\s*<\/\1>/g, '<$1>$2</$1>');
  s = s.replace(/<p>\s*<strong>([^<]{1,80}:)\s*<\/strong>\s*<\/p>/g, '<h3>$1</h3>');
  s = s.replace(/\s*(<br>)\s*/g, '$1').replace(/>\s+</g, '><').replace(/<br><\/(p|li)>/g, '</$1>').trim();
  return s;
}

/** Their prose paragraphs before the notes / details lists, plus their "Scent Profile" line. */
function proseOf(p) {
  const lines = text(p.description);
  const stop = /^(•\s*)?(fragrance profile|fragrance notes|character|category\s*:|inspired by\s*:|description$|key accords|top notes|pricing options|available sizes)/i;
  const out = [];
  for (const [i, l] of lines.entries()) {
    if (stop.test(l)) break;
    if (i === 0 && !/[.!?]$/.test(l) && l.length < 90) continue; // title line
    out.push(l);
  }
  const profile = lines.find((l) => /^scent profile\s*:/i.test(l));
  if (profile) out.push(profile.replace(/^scent profile\s*:\s*/i, ''));
  // Writing-tool leftovers in a few of their descriptions.
  const tidy = (l) =>
    l.replace(', reflecting the artisanal, oil-based character described in the source', ', with an artisanal, oil-based character')
      .replace(' described in the source as suited to', ' suited to')
      .replace(/ described in the source/g, '');
  return out.map((l) => `<p>${esc(tidy(l))}</p>`).join('');
}

// ------------------------------------------------------------------ validate the curated catalog
const problems = [];
const survivors = snap.products.filter((p) => !MERGED[p.slug]);
for (const p of survivors) if (!catalog[p.slug]) problems.push(`No catalog entry for ${p.slug}`);
for (const key of Object.keys(catalog)) if (!snap.products.some((p) => p.slug === key)) problems.push(`Catalog entry ${key} is not on the old site`);
const PROFILE = { intensity: ['beastmode', 'intense', 'moderate', 'soft'], longevity: ['light', 'moderate', 'long', 'very-long'], sillage: ['intimate', 'moderate', 'strong', 'enormous'] };
for (const [k, c] of Object.entries(catalog)) {
  const [i, l, s] = String(c.p).split('/');
  if (!PROFILE.intensity.includes(i) || !PROFILE.longevity.includes(l) || !PROFILE.sillage.includes(s)) problems.push(`${k}: bad profile ${c.p}`);
  if (!Array.isArray(c.n) || c.n.length !== 3) problems.push(`${k}: notes need top, heart and base`);
  for (const f of ['name', 'short', 'insp', 'wear', 'fam']) if (!c[f]) problems.push(`${k}: missing ${f}`);
}
if (problems.length) throw new Error(`Catalog problems:\n${problems.join('\n')}`);

// ------------------------------------------------------------------ build the products
function productPlan(p) {
  const c = catalog[p.slug];
  const slug = SLUG_OVERRIDE[p.slug] ?? slugify(c.name);
  const combo = COMBOS[p.slug];
  const lines = text(p.description).join('\n');
  const guessed = new Set(['short description', 'accords', 'intensity', 'longevity', 'sillage', 'season', 'time of day', 'occasion', 'how to wear', 'perfumer', 'launch year', 'parcel weights']);
  const flags = String(c.x ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const WORDS = { desc: 'description', notes: 'notes', 'base notes': 'base notes', gender: 'gender', insp: 'inspiration', family: 'scent family', prices: 'prices (the old site showed ₹0)', sizes: 'sizes' };
  for (const f of flags) guessed.add(WORDS[f] ?? f);
  if (!/fragrance family/i.test(lines)) guessed.add('scent family');
  if (!/top notes|key accords/i.test(lines)) guessed.add('notes');
  if (!c.conc && !/extrait/i.test(lines)) guessed.add('concentration');
  if (!/inspired by/i.test(lines) && !c.x?.includes('insp')) guessed.add('inspiration');

  // categories
  const catSlugs = new Set();
  for (const def of CATEGORIES) if ((def.from && p.categories.includes(def.from)) || def.products?.includes(p.slug)) catSlugs.add(def.slug);
  const primary = PRIMARY_ORDER.find((s) => catSlugs.has(s)) ?? null;
  const gender = c.g ?? p.categories.map((x) => GENDER_FROM_CATEGORY[x]).find(Boolean);
  if (!gender) problems.push(`${p.slug}: no gender`);

  // sizes and stock
  const inStock = p.in_stock && (p.sizes.length === 0 || p.sizes.some((s) => s.in_stock));
  let sizes;
  if (combo) {
    const count = Number(String(p.stock_text).match(/(\d+)\s+in stock/i)?.[1]);
    sizes = [{ label: combo.label, size_ml: null, price: p.price, compare: p.on_sale ? p.regular_price : null, stock: inStock ? (Number.isFinite(count) ? count : 100) : 0, weight: combo.weight }];
    if (!Number.isFinite(count) && inStock) guessed.add('stock count (100 boxes)');
  } else if (c.sizes) {
    sizes = Object.entries(c.sizes).map(([label, price]) => ({ label, size_ml: sizeOf(label), price, compare: null }));
  } else {
    sizes = p.sizes.map((s) => ({ label: `${sizeOf(s.label)} ml`, size_ml: sizeOf(s.label), price: s.on_sale ? s.price : s.regular_price, compare: s.on_sale ? s.regular_price : null }));
  }
  sizes.sort((a, b) => (a.size_ml ?? 0) - (b.size_ml ?? 0));
  for (const s of sizes) if (!(s.price > 0)) problems.push(`${p.slug}: size ${s.label} has no price`);

  // photos (file names; mapped to uploaded URLs later)
  const media = [];
  const oldImages = [...p.images, ...p.sizes.map((s) => s.image).filter(Boolean)].filter((u, i, a) => a.indexOf(u) === i);
  if (OWN_PHOTOS[p.slug]) OWN_PHOTOS[p.slug].forEach((f) => media.push({ drive: f, alt: c.name }));
  if (p.slug === 'saudagar-premium-perfume-gift-set-5-x-20-ml-100-ml') media.push({ drive: 'combo_pack.png', alt: `${c.name}: Green Musk, Oud, White Code, Black Code and Pink Bomb` });
  if (KEEP_OLD_PHOTOS.includes(p.slug)) oldImages.forEach((u) => media.push({ old: u, alt: c.name }));
  if (!OWN_PHOTOS[p.slug] && !KEEP_OLD_PHOTOS.includes(p.slug)) {
    for (const s of sizes) for (const f of DRIVE_BY_SIZE[s.size_ml] ?? []) media.push({ drive: f, alt: `${c.name} ${s.label}`, size_ml: s.size_ml });
  }
  if (!media.length) problems.push(`${p.slug}: no photos`);

  const conc = c.conc ?? 'extrait';
  const notes = c.n.flatMap((tier, ti) => tier.map((name, i) => ({ name, tier: ['top', 'heart', 'base'][ti], position: ti * 100 + i })));
  const sea = c.sea === 'all' ? ['spring', 'summer', 'autumn', 'winter'] : c.sea.split(',');
  const [intensity, longevity, sillage] = c.p.split('/');
  const attrs = [
    { kind: 'family', slug: c.fam, is_primary: true },
    ...Object.entries(c.acc).map(([slug, strength]) => ({ kind: 'accord', slug, strength })),
    { kind: 'gender', slug: gender },
    { kind: 'concentration', slug: conc },
    { kind: 'intensity', slug: intensity },
    { kind: 'longevity', slug: longevity },
    { kind: 'sillage', slug: sillage },
    ...sea.map((slug) => ({ kind: 'season', slug })),
    ...c.tod.split(',').map((slug) => ({ kind: 'time_of_day', slug })),
    ...c.occ.split(',').map((slug) => ({ kind: 'occasion', slug })),
  ];
  const desc = c.desc ?? proseOf(p);
  if (!desc) problems.push(`${p.slug}: empty description`);
  const note = [
    `Imported from saudagarperfumers.in (old link: /product/${p.slug}/) on 26 Nov 2026.`,
    combo ? `Stock: ${sizes[0].stock} boxes.` : `Stock: ${inStock ? '1 L to start (owner’s choice); enter the real amount' : '0 (out of stock on the old site)'}.`,
    `Filled in by the import, please check: ${[...guessed].join(', ')}.`,
  ].join(' ');
  return {
    old: p.slug, merged: Object.entries(MERGED).filter(([, to]) => to === p.slug).map(([from]) => from),
    slug, name: c.name, combo: !!combo, inStock, primary, categories: [...catSlugs], gender, sizes, media, notes, attrs, desc, note,
    c, conc, guessed: [...guessed],
  };
}

const plans = survivors.map(productPlan);
const slugs = plans.map((x) => x.slug);
const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
if (dupes.length) problems.push(`Duplicate web addresses: ${dupes.join(', ')}`);
if (problems.length) throw new Error(`Plan problems:\n${problems.join('\n')}`);

// old WooCommerce links → new pages
const redirects = [];
for (const x of plans) {
  for (const from of [x.old, ...x.merged]) if (from !== x.slug) redirects.push({ source: `/product/${from}`, destination: `/product/${x.slug}` });
}
for (const def of CATEGORIES) if (def.from) redirects.push({ source: `/product-category/${def.from}`, destination: `/categories/${def.slug}` });
redirects.push(
  { source: '/product-category/uncategorized', destination: '/shop' },
  { source: '/shipping-policy', destination: '/pages/shipping-policy' },
  { source: '/refund_returns', destination: '/pages/returns-policy' },
  { source: '/privacy-policy-2', destination: '/pages/privacy-policy' },
  { source: '/privacy-policy', destination: '/pages/privacy-policy' },
  { source: '/terms-of-use', destination: '/pages/terms' },
  { source: '/contact-us', destination: '/pages/contact' },
  { source: '/my-account', destination: '/account' },
  { source: '/my-account/:path*', destination: '/account' },
  { source: '/track-order', destination: '/account' },
  { source: '/shopping-cart', destination: '/shop' },
  { source: '/cart', destination: '/shop' },
  { source: '/checkouts', destination: '/checkout' },
  { source: '/wishlist-2', destination: '/wishlist' },
  { source: '/categories', destination: '/shop' },
  { source: '/special-offers', destination: '/shop' },
  { source: '/recently-view-products', destination: '/shop' },
  { source: '/compare-2', destination: '/shop' },
  { source: '/about-us', destination: '/' },
  { source: '/faq', destination: '/' },
  { source: '/blog', destination: '/' },
  { source: '/blog/:path*', destination: '/' },
  { source: '/coming-soon', destination: '/' },
);
writeFileSync(join(OUT,'redirects.json'), `${JSON.stringify(redirects, null, 2)}\n`);

// ------------------------------------------------------------------ pages, home, site text
const pageHtml = (slug) => cleanHtml(snap.pages.find((x) => x.slug === slug)?.html);
const PAGES = {
  'shipping-policy': { title: 'Shipping Policy', body: pageHtml('shipping-policy') },
  'returns-policy': { title: 'Refund and Returns Policy', body: pageHtml('refund_returns') },
  'privacy-policy': { title: 'Privacy Policy', body: pageHtml('privacy-policy-2') },
  terms: { title: 'Terms & Conditions', body: pageHtml('terms-of-use') },
  contact: {
    title: 'Contact Us',
    body: [
      '<h2>Customer support</h2><p>Have a question? Please contact us using the customer support channels below.</p>',
      `<h3>Address</h3><p>${esc(SITE.address)}</p>`,
      `<h3>Email</h3><p><a href="mailto:${SITE.email}">${SITE.email}</a></p>`,
      '<h3>Phone and WhatsApp</h3><p><a href="tel:+918448441388">+91 84484 41388</a></p>',
    ].join(''),
  },
};
for (const [k, v] of Object.entries(PAGES)) if (!v.body || v.body.length < 200) problems.push(`Page ${k} came out empty`);
if (problems.length) throw new Error(problems.join('\n'));

const count = (slug) => plans.filter((x) => x.categories.includes(slug)).length;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const catLink = (slug) => ({ type: 'category', value: slug });

function homeSections(img) {
  const tiles = ['men', 'women', 'unisex', 'inspired-perfumes', 'floral-perfumes', 'new-perfumes'].map((slug, i) => {
    const def = CATEGORIES.find((d) => d.slug === slug);
    return { numeral: String(i + 1).padStart(2, '0'), title: def.name, count_label: plural(count(slug), 'product'), image: img(def.image), link: catLink(slug) };
  });
  const byOld = (old) => plans.find((x) => x.old === old).slug;
  const search = (label) => ({ label, query: label });
  return [
    { section_type: 'hero_video_carousel', label: 'Hero', config: { slides: [], fallback_image: img('combo_pack.png'), fallback_image_mobile: img('saudagar_perfumers_50ml.png'), fallback_alt: 'Saudagar Perfumers', cta_label: 'Shop now', cta_link: { type: 'path', value: '/shop' } } },
    { section_type: 'kinetic_marquee', label: 'Saudagar Perfumers ribbon', config: { items: ['SAUDAGAR PERFUMERS'], speed: 40, reverse: false } },
    { section_type: 'product_carousel', label: 'Our Signature Fragrance', config: { heading: 'Our Signature Fragrance', cta_label: 'View all', cta_link: catLink('signature-fragrances'), source: { mode: 'manual', products: ['ocean-blue-perfume', 'white-code-perfume', 'black-code-perfume', 'ice-land'].map(byOld), limit: 4 } } },
    {
      section_type: 'campaign_banner_animated',
      label: 'Ocean Blue banner',
      config: {
        kicker: 'Saudagar signature',
        headline: 'Ocean Blue',
        italic_word: '',
        subheading: 'Fresh, cool and versatile',
        text: 'A bright splash of cool mint, crisp green apple and Sicilian bergamot over tonka bean and ambroxan, drying down to vanilla, vetiver and cedar. Made for the office, college, the outdoors and every day.',
        notes: ['Mint', 'Green Apple', 'Sicilian Bergamot', 'Tonka Bean', 'Ambroxan', 'Vanilla', 'Cedar'],
        video: '',
        image: img('ocean_blue_2.png'),
        primary_cta: { label: 'Shop Ocean Blue', link: { type: 'product', value: byOld('ocean-blue-perfume') } },
        secondary_cta: { label: 'Signature Fragrances', link: catLink('signature-fragrances') },
        badge: 'Extrait de Parfum',
      },
    },
    { section_type: 'product_showcase', label: 'New Collections', config: { heading: 'New Collections', text: 'Gift sets and combos of Saudagar perfumes, boxed and ready to give.', cta_label: 'View all', cta_link: catLink('new-collections'), source: { mode: 'manual', products: ['saudagar-20ml-x-4-piece-perfume-collection', '3-piece-perfume-combo', 'raksha-bandhan-special-fragrance-combo', 'saudagar-premium-perfume-gift-set-5-x-20-ml-100-ml'].map(byOld), limit: 4 } } },
    { section_type: 'category_tiles', label: 'Categories', config: { heading: 'Shop by category', view_all_label: 'Shop all', view_all_link: { type: 'path', value: '/shop' }, cta_label: 'Shop now', items: tiles } },
    {
      section_type: 'product_grid_tabs',
      label: 'For him, for her, unisex',
      config: {
        heading: 'Find your perfume',
        text: 'Every perfume in 30, 50 and 100 ml, sorted by who it suits.',
        tabs: [
          { label: 'For him', source: { mode: 'filter', attrs: { gender: ['masculine'] }, limit: 48 } },
          { label: 'For her', source: { mode: 'filter', attrs: { gender: ['feminine'] }, limit: 48 } },
          { label: 'Unisex', source: { mode: 'filter', attrs: { gender: ['unisex'] }, limit: 72 } },
        ],
      },
    },
    { section_type: 'product_carousel', label: 'Floral Perfumes', config: { heading: 'Floral Perfumes', text: 'Traditional Indian flowers: jasmine, champa, kewda, paarijatham, rajanigandha and rose.', cta_label: 'View all', cta_link: catLink('floral-perfumes'), source: { mode: 'category', category: 'floral-perfumes', limit: 12 } } },
    {
      section_type: 'gallery_tiles',
      label: 'Three picture tiles',
      config: {
        heading: 'Explore Saudagar',
        tiles: [
          { kicker: plural(count('inspired-perfumes'), 'perfume'), title: 'Inspired Perfumes', subtitle: 'Our take on the world’s best-known fragrances', image: img('saudagar_perfumers_50ml.png'), link: catLink('inspired-perfumes') },
          { kicker: plural(count('floral-perfumes'), 'perfume'), title: 'Floral Perfumes', subtitle: 'Jasmine, champa, kewda and more', image: img('saudagar_perfumers_30ml_2.png'), link: catLink('floral-perfumes') },
          { kicker: plural(count('new-collections'), 'set'), title: 'Gift Sets & Combos', subtitle: 'Boxed sets of Saudagar perfumes', image: img('combo_pack.png'), link: catLink('new-collections') },
        ],
      },
    },
    { section_type: 'product_carousel', label: 'Inspired Perfumes', config: { heading: 'Inspired Perfumes', cta_label: 'View all', cta_link: catLink('inspired-perfumes'), source: { mode: 'category', category: 'inspired-perfumes', limit: 120 } } },
    { section_type: 'kinetic_marquee', label: 'Categories ribbon', config: { items: ['INSPIRED PERFUMES', 'FLORAL PERFUMES', 'SIGNATURE FRAGRANCES', 'GIFT SETS AND COMBOS', 'EXTRAIT DE PARFUM'], speed: 36, reverse: true } },
    {
      section_type: 'editorial_story',
      label: 'About Saudagar',
      config: {
        statement: 'Inspired perfumes, Indian florals and our own signatures, made in Anakapalle.',
        intro: 'Saudagar Perfumers makes long-lasting perfumes in 30, 50 and 100 ml: perfumes inspired by the world’s best-known fragrances, traditional Indian florals, and Saudagar originals like Ocean Blue, White Code and Black Code.',
        atelier: { kicker: 'Signature', title: 'Ocean Blue, White Code, Black Code', image: img('ocean_blue_3.png'), link: catLink('signature-fragrances') },
        stat: { kicker: 'The range', number: `${Math.floor(plans.length / 10) * 10}+`, caption: 'perfumes, sets and combos' },
        sourcing: { kicker: 'Floral perfumes', title: 'Jasmine, champa, kewda and rajanigandha', image: img('saudagar_perfumers_30ml_2.png') },
        craft: { kicker: 'Free samples', text: 'Every 50 ml of perfume in your order earns a free 5 ml sample of your choice.' },
        entries_heading: 'Shop by category',
        view_all_label: 'Shop all',
        view_all_link: { type: 'path', value: '/shop' },
        entries: ['men', 'women', 'unisex'].map((slug) => ({ title: CATEGORIES.find((d) => d.slug === slug).name, note: plural(count(slug), 'perfume'), image: img(CATEGORIES.find((d) => d.slug === slug).image), link: catLink(slug) })),
      },
    },
    // Switched off until there are real reviews and real videos (Content → Testimonials / Reels).
    { section_type: 'testimonials', label: 'Testimonials', visible: false, config: {} },
    { section_type: 'instagram_reels', label: 'Instagram reels', visible: false, config: { heading: 'Saudagar on Instagram', follow_label: 'Follow us' } },
    {
      section_type: 'seo_accordion',
      label: 'About & popular searches',
      config: {
        heading: 'Saudagar Perfumers',
        intro: '<p>Saudagar Perfumers is a perfume house in Anakapalle, Andhra Pradesh. Every perfume comes in 30, 50 and 100 ml, and every 50 ml in your order earns a free 5 ml sample.</p>',
        more: [
          '<h3>Inspired perfumes</h3><p>Our inspired perfumes are our own takes on famous fragrances such as Sauvage, Aventus, Baccarat Rouge 540, Khamrah and Oud Wood. Each product page lists the perfume it is inspired by and its top, heart and base notes.</p>',
          '<h3>Floral perfumes</h3><p>Traditional Indian flowers in perfume form: forest jasmine, javadhu, kewda, paarijatham, champa, rose and rajanigandha.</p>',
          '<h3>Gift sets and combos</h3><p>Boxed sets of Saudagar perfumes, including the Premium Perfume Gift Set of five 20 ml bottles.</p>',
          '<h3>Delivery</h3><p>Orders are processed within 1–2 business days and delivered within 2–7 business days across India.</p>',
        ].join(''),
        read_more_label: 'Read more',
        read_less_label: 'Read less',
        searches_heading: 'Popular searches',
        search_tabs: [
          { label: 'Inspired by', terms: ['Sauvage', 'Creed Aventus', 'BR540', 'Khamarah', 'Oud Wood', 'Good Girl', 'Jadore', 'Eros'].map(search) },
          { label: 'Florals', terms: ['Jasmine', 'Rose', 'Champa', 'Kewda', 'Tuberose', 'Paarijatham'].map(search) },
          { label: 'Notes', terms: ['Oud', 'Musk', 'Vanilla', 'Saffron', 'Sandalwood', 'Bergamot', 'Amber', 'Leather'].map(search) },
        ],
      },
    },
  ];
}

function siteBlocks(current, img) {
  const navCats = ['men', 'women', 'unisex', 'inspired-perfumes', 'floral-perfumes'];
  const linkTo = (slug) => ({ link: catLink(slug), label: CATEGORIES.find((d) => d.slug === slug).name, action: 'link' });
  const page = (slug, label) => ({ link: { type: 'page', value: slug }, label, action: 'link' });
  return {
    brand: { ...current.brand, name: 'Saudagar Perfumers', legal_name: 'Saudagar Perfumers', address: SITE.address, support_email: SITE.email, support_hours: '', instagram: '', youtube: '', boutiques_message: '' },
    announcement_bar: { ...current.announcement_bar, tags: [], bulletins: [], bulletins_heading: '' },
    // Gift sets and combos have no bottle size: the premium 100 ml bottle flies into the bag for them (owner, 26 Nov).
    product_page: { ...current.product_page, set_fly_image: img('saudagar_perfumers_100ml.png') },
    seo: { ...current.seo, default_title: 'Saudagar Perfumers', default_description: 'Saudagar Perfumers, Anakapalle: inspired perfumes, Indian floral perfumes, Saudagar signature fragrances and gift sets in 30, 50 and 100 ml.', og_image: img('combo_pack.png') },
    search: { ...current.search, popular: ['Gift Set', 'Kasturi', 'Sabaya', 'Oud Sheikha', 'The Moon'], popular_heading: 'Popular products' },
    mega_nav: {
      ...current.mega_nav,
      items: [
        { numeral: '01', title: 'All perfumes', subtitle: 'Every Saudagar perfume, set and combo', count_label: plural(plans.length, 'product'), concentration: '', image: img('combo_pack.png'), video: '', link: { type: 'path', value: '/shop' } },
        ...navCats.map((slug, i) => {
          const def = CATEGORIES.find((d) => d.slug === slug);
          return { numeral: String(i + 2).padStart(2, '0'), title: def.name, subtitle: '', count_label: plural(count(slug), 'product'), concentration: '', image: img(def.image), video: '', link: catLink(slug) };
        }),
      ],
      accords: [],
      accords_heading: '',
      quick_cards: [],
      side_cells: [
        { link: catLink('signature-fragrances'), badge: '', image: img('ocean_blue.png'), video: '', title: 'Signature', subtitle: 'Ocean Blue, White Code, Black Code', cta_label: 'Explore →' },
        { link: catLink('new-collections'), badge: '', image: img('combo_pack.png'), video: '', title: 'New Collections', subtitle: 'Gift sets and combos', cta_label: 'Explore →' },
      ],
      secondary_links: [
        { link: { type: 'path', value: '/shop' }, label: 'Shop all', action: 'link' },
        page('contact', 'Contact Us'),
        page('shipping-policy', 'Shipping Policy'),
      ],
      footer_text: 'Saudagar Perfumers',
      feature_badge_image: 'Saudagar Perfumers',
      feature_badge_video: 'Saudagar Perfumers',
      feature_cta_prefix: 'Shop',
      feature_secondary_cta: { link: catLink('new-collections'), label: 'Gift sets' },
    },
    mobile_drawer: {
      ...current.mobile_drawer,
      all_link: { link: { type: 'path', value: '/shop' }, label: 'Shop all' },
      highlight: { link: catLink('new-collections'), badge: 'NEW', label: 'New Collections' },
      collections: ['signature-fragrances', ...navCats].map((slug) => ({ link: catLink(slug), label: CATEGORIES.find((d) => d.slug === slug).name, count_label: String(count(slug)) })),
      theme_label: 'Theme',
      footer_lines: ['Phone and WhatsApp: +91 84484 41388', SITE.email],
      utility_links: [
        { icon: '🔖', label: 'Wishlist', action: 'wishlist' },
        { icon: '👤', label: 'Account and orders', action: 'account' },
      ],
    },
    footer: {
      ...current.footer,
      creed: SITE.address,
      badges: [],
      columns: [
        { heading: 'Shop', links: [{ link: { type: 'path', value: '/shop' }, label: 'Shop all', action: 'link' }, ...navCats.map(linkTo)] },
        { heading: 'Information', links: [page('contact', 'Contact Us'), page('shipping-policy', 'Shipping Policy'), page('returns-policy', 'Refund and Returns Policy'), page('privacy-policy', 'Privacy Policy'), page('terms', 'Terms & Conditions')] },
        {
          heading: 'Contact',
          links: [
            { link: { type: 'url', value: 'tel:+918448441388' }, label: '+91 84484 41388', action: 'link' },
            { link: { type: 'url', value: 'https://wa.me/918448441388' }, label: 'WhatsApp', action: 'link' },
            { link: { type: 'url', value: `mailto:${SITE.email}` }, label: SITE.email, action: 'link' },
          ],
        },
      ],
      copyright: '© {year} Saudagar Perfumers. All rights reserved.',
      legal_links: [
        { link: { type: 'page', value: 'privacy-policy' }, label: 'Privacy Policy' },
        { link: { type: 'page', value: 'terms' }, label: 'Terms & Conditions' },
        { link: { type: 'page', value: 'shipping-policy' }, label: 'Shipping Policy' },
        { link: { type: 'page', value: 'returns-policy' }, label: 'Refund and Returns Policy' },
      ],
      newsletter_eyebrow: '',
      newsletter_heading: 'Stay in touch',
      newsletter_text: 'New perfumes and offers from Saudagar Perfumers, sent to your inbox.',
      newsletter_placeholder: 'Your email address',
      newsletter_button: 'Subscribe',
      newsletter_success: 'Thank you for subscribing',
      theme_light_label: 'Light',
      theme_dark_label: 'Dark',
    },
  };
}

// ------------------------------------------------------------------ photos: WebP like an admin upload (long edge ≤ 2400 px, quality 0.82)
// fit: the plain bottle photos have a transparent background and a lot of empty space (the 100 ml one is wide), so they
// are trimmed to the bottle and set in the same 4:5 frame. Every size then shows at the same scale on cards and pages.
async function convertAll(files) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = new Map();
  for (const f of files) {
    const b64 = f.bytes.toString('base64');
    const r = await page.evaluate(async ({ b64, mime, fit }) => {
      const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: mime }));
      let source = bmp;
      let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
      if (fit) {
        const probe = document.createElement('canvas');
        probe.width = bmp.width;
        probe.height = bmp.height;
        const pctx = probe.getContext('2d');
        pctx.drawImage(bmp, 0, 0);
        const { data } = pctx.getImageData(0, 0, bmp.width, bmp.height);
        let minX = bmp.width, minY = bmp.height, maxX = -1, maxY = -1;
        for (let y = 0; y < bmp.height; y++) {
          for (let x = 0; x < bmp.width; x++) {
            if (data[(y * bmp.width + x) * 4 + 3] > 12) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX > minX && maxY > minY) {
          sx = minX; sy = minY; sw = maxX - minX + 1; sh = maxY - minY + 1;
          source = probe;
        }
      }
      const canvas = document.createElement('canvas');
      if (fit) {
        // Bottle fills 86% of a 4:5 frame, centred.
        const frameH = Math.max(sh / 0.86, (sw / 0.86) * 1.25);
        const scale = Math.min(1, 1600 / frameH);
        canvas.height = Math.round(frameH * scale);
        canvas.width = Math.round(canvas.height * 0.8);
        const dw = sw * scale, dh = sh * scale;
        canvas.getContext('2d').drawImage(source, sx, sy, sw, sh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } else {
        const long = Math.max(bmp.width, bmp.height);
        const scale = long > 2400 ? 2400 / long : 1;
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.82));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(s), width: canvas.width, height: canvas.height };
    }, { b64, mime: f.mime, fit: !!f.fit });
    out.set(f.key, { ...f, webp: Buffer.from(r.b64, 'base64'), width: r.width, height: r.height });
  }
  await browser.close();
  return out;
}

const mimeOf = (name) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[name.split('.').pop().toLowerCase()] ?? 'image/png';

// ------------------------------------------------------------------ run
const driveFiles = readdirSync(DRIVE_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
for (const need of ['combo_pack.png', 'black_code.png', ...Object.values(DRIVE_BY_SIZE).flat(), ...Object.values(OWN_PHOTOS).flat()]) {
  if (!driveFiles.includes(need)) throw new Error(`Drive photo ${need} is missing from ${DRIVE_DIR}`);
}
const oldUrls = [...new Set(snap.products.flatMap((p) => [...p.images, ...p.sizes.map((s) => s.image).filter(Boolean)]))];

const storagePath = (key) => `images/2026/11/${key}.webp`;
// Plain bottle photos are trimmed to the bottle (see convertAll); their originals stay in the library too.
const FIT = (f) => /^saudagar_perfumers_/.test(f);
const keyDrive = (f, original = false) => `drive-${slugify(f.replace(/\.[^.]+$/, ''))}${FIT(f) && !original ? '-fit' : ''}`;
const plainOldKey = (u) => `old-site-${slugify(u.split('/uploads/')[1].replace(/\.[^.]+$/, ''))}`;
// Two files that differ only by type (50ml.png and 50ml.webp) keep the type in their name so neither replaces the other.
const clashing = new Set(oldUrls.map(plainOldKey).filter((k, i, all) => all.indexOf(k) !== i));
const keyOld = (u) => (clashing.has(plainOldKey(u)) ? `${plainOldKey(u)}-${u.split('.').pop().toLowerCase()}` : plainOldKey(u));
const baseUrl = env('VITE_SUPABASE_URL');
const publicUrl = (path) => `${baseUrl}/storage/v1/object/public/media/${path}`;
const img = (driveName) => publicUrl(storagePath(keyDrive(driveName)));
const urlOf = (m) => publicUrl(storagePath(m.drive ? keyDrive(m.drive) : keyOld(m.old)));

const current = Object.fromEntries((DRY ? [] : await runSql(`select key, value from public.site_blocks`)).map((r) => [r.key, r.value]));
const preview = {
  products: plans.map((x) => ({ ...x, c: undefined, media: x.media.map((m) => ({ ...m, url: urlOf(m) })) })),
  pages: PAGES,
  home: homeSections(img),
  blocks: siteBlocks({ brand: {}, announcement_bar: {}, seo: {}, search: {}, mega_nav: {}, mobile_drawer: {}, footer: {}, product_page: {}, ...current }, img),
  redirects,
  library: { drive: driveFiles.length, old: oldUrls.length },
};
writeFileSync(join(OUT,'preview.json'), `${JSON.stringify(preview, null, 1)}\n`);
console.log(`Plan: ${plans.length} products, ${driveFiles.length} Drive photos + ${oldUrls.length} old-site photos, ${redirects.length} redirects.`);
if (DRY) process.exit(0);

// 1. backup of everything this replaces
const backupDir = join(OUT,'backups');
mkdirSync(backupDir, { recursive: true });
const backup = {};
for (const t of ['products', 'product_variants', 'product_media', 'product_notes', 'product_attributes', 'product_categories', 'product_collections', 'categories', 'collections', 'pages', 'website_sections', 'site_blocks', 'stories', 'reels', 'reel_products', 'testimonials', 'announcements', 'stockists', 'settings', 'notes']) {
  backup[t] = await runSql(`select * from public.${t}`);
}
const backupFile = join(backupDir, `before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backupFile, JSON.stringify(backup));
console.log(`Backup saved: ${backupFile}`);

// 2. photos → Storage + Media library
const keys = await mgmt(`/projects/${env('SUPABASE_PROJECT_REF')}/api-keys?reveal=true`);
const secret = (keys.find((k) => k.type === 'secret' && k.api_key) || keys.find((k) => k.name === 'service_role'))?.api_key;
if (!secret) throw new Error('No secret key for Storage uploads.');
const storageHeaders = { apikey: secret, ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` }) };
const admin = (await runSql(`select user_id from public.user_roles where role = 'admin' order by created_at limit 1`))[0]?.user_id;
if (!admin) throw new Error('No admin user found.');
const existing = new Set((await runSql(`select path from public.media_assets where bucket = 'media'`)).map((r) => r.path));

const toFetch = [];
for (const f of driveFiles) {
  const alt = f.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const bytes = readFileSync(join(DRIVE_DIR, f));
  if (!existing.has(storagePath(keyDrive(f, true)))) toFetch.push({ key: keyDrive(f, true), name: f, mime: mimeOf(f), bytes, alt });
  if (FIT(f) && !existing.has(storagePath(keyDrive(f)))) toFetch.push({ key: keyDrive(f), name: f.replace(/\.[^.]+$/, '-fitted.png'), mime: mimeOf(f), bytes, alt: `${alt} (trimmed for product photos)`, fit: true });
}
for (const u of oldUrls) {
  if (existing.has(storagePath(keyOld(u)))) continue;
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (store content import)' } });
  if (!res.ok) throw new Error(`Could not download ${u}: HTTP ${res.status}`);
  toFetch.push({ key: keyOld(u), name: fileName(u), mime: res.headers.get('content-type')?.split(';')[0] || mimeOf(u), bytes: Buffer.from(await res.arrayBuffer()), alt: `Old site photo: ${fileName(u)}` });
}
console.log(`Converting ${toFetch.length} photos to WebP…`);
const converted = await convertAll(toFetch);
for (const f of converted.values()) {
  const path = storagePath(f.key);
  const res = await fetch(`${baseUrl}/storage/v1/object/media/${path}`, {
    method: 'POST',
    headers: { ...storageHeaders, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': '3600' },
    body: f.webp,
  });
  if (!res.ok) throw new Error(`Upload failed for ${f.name}: ${res.status} ${await res.text()}`);
  await runSql(`insert into public.media_assets (bucket, path, url, kind, mime, bytes, width, height, alt, original_name, uploaded_by)
    select 'media', ${sql(path)}, ${sql(publicUrl(path))}, 'image', 'image/webp', ${f.webp.length}, ${f.width}, ${f.height}, ${sql(f.alt)}, ${sql(f.name)}, ${sql(admin)}
    where not exists (select 1 from public.media_assets where bucket = 'media' and path = ${sql(path)})`);
  console.log(`  ${f.name} → ${path} (${Math.round(f.webp.length / 1024)} KB)`);
}

// 3. categories, notes, scent options
for (const [i, def] of CATEGORIES.entries()) {
  await runSql(`insert into public.categories (slug, name, image_url, position, is_active) values (${sql(def.slug)}, ${sql(def.name)}, ${sql(img(def.image))}, ${i}, true)
    on conflict (slug) do update set name = excluded.name, image_url = excluded.image_url, position = excluded.position, is_active = true, parent_id = null`);
}
const catId = Object.fromEntries((await runSql(`select id, slug from public.categories`)).map((r) => [r.slug, r.id]));

const opts = await runSql(`select id, kind, slug from public.attribute_options`);
const optId = (kind, slug) => {
  const o = opts.find((x) => x.kind === kind && x.slug === slug);
  if (!o) throw new Error(`Scent choice ${kind}/${slug} does not exist`);
  return o.id;
};
for (const x of plans) for (const a of x.attrs) optId(a.kind, a.slug);

const NOTE_FAMILY = [
  ['oud', /\b(oud|agarwood)\b/i],
  ['leather', /\b(leather|suede|musk|castoreum)\b/i],
  ['amber', /\b(amber|ambergris|ambroxan|labdanum|benzoin|frankincense|olibanum|myrrh|incense|resin|elemi|balsam|opoponax|tonka|vanilla|praline|caramel|honey|sugar|cocoa|chocolate|bakhoor)/i],
  ['spices', /\b(pepper|peppercorn|cardamom|cinnamon|nutmeg|saffron|ginger|clove|anise|caraway|pimento|cumin|coriander|spice|spices)\b/i],
  ['citrus', /\b(bergamot|lemon|lime|orange|mandarin|tangerine|grapefruit|citron|yuzu|petitgrain|citrus|neroli)\b/i],
  ['aquatic', /\b(sea|marine|water|aquatic|calone|seaweed|ice|snow|salt|mountain air)\b/i],
  ['rose', /\b(rose|jasmine|tuberose|peony|osmanthus|iris|orris|violet|lily|blossom|magnolia|freesia|gardenia|champaca|kewda|paarijatham|geranium|pelargonium|orchid|lotus|mimosa|narcissus|hyacinth|daisy|chamomile|floral|florals|flowers|petals|petalia|hibiscus|mahonial)\b/i],
  ['woody', /\b(cedar|sandalwood|vetiver|patchouli|guaiac|cashmere wood|birch|cypress|pine|fir|oakmoss|moss|wood|woods|akigalawood|cypriol|rosewood|driftwood|tobacco|bark|mahogany|iso e super)\b/i],
];
const noteFamilyOpt = Object.fromEntries(opts.filter((o) => o.kind === 'note_family').map((o) => [o.slug, o.id]));
let notes = await runSql(`select id, name, slug from public.notes`);
const findNote = (name) => notes.find((n) => n.name.toLowerCase() === name.toLowerCase() || n.slug === slugify(name));
for (const name of [...new Set(plans.flatMap((x) => x.notes.map((n) => n.name)))]) {
  if (findNote(name)) continue;
  const fam = NOTE_FAMILY.find(([, re]) => re.test(name))?.[0];
  let slug = slugify(name);
  for (let i = 2; notes.some((n) => n.slug === slug); i++) slug = `${slugify(name)}-${i}`;
  const row = (await runSql(`insert into public.notes (name, slug, family_option_id, position) values (${sql(name)}, ${sql(slug)}, ${sql(fam ? noteFamilyOpt[fam] : null)}, (select coalesce(max(position), 0) + 1 from public.notes)) returning id, name, slug`))[0];
  notes.push(row);
}
console.log(`Notes library: ${notes.length} notes.`);

// Inspired perfumes read "Inspired by Sauvage by Dior."; general descriptions start lower-case after "Inspired by".
function inspirationLine(x) {
  if (!x.categories.includes('inspired-perfumes')) return x.c.insp;
  // "Classic Middle Eastern artisanal oud." is a description; "The Moon by Frédéric Malle." is a perfume name.
  const general = /^(Classic|Modern|Traditional|The|Rich|Luxury|Heritage|Sweet) /.test(x.c.insp) && !x.c.insp.includes(" by ");
  return `Inspired by ${general ? x.c.insp[0].toLowerCase() + x.c.insp.slice(1) : x.c.insp}`;
}

// 4. products, through save_product as the admin
const settings = Object.fromEntries((await runSql(`select key, value from public.settings where key like 'product_defaults.%' or key = 'samples.sample_size_ml'`)).map((r) => [r.key, r.value]));
const defaults = Object.fromEntries(Object.entries(settings).filter(([k, v]) => k.startsWith('product_defaults.') && v !== null && v !== '').map(([k, v]) => [k.replace('product_defaults.', ''), String(v)]));
const sampleMl = Number(settings['samples.sample_size_ml'] ?? 5);
const claims = `select set_config('request.jwt.claims', ${sql(JSON.stringify({ sub: admin, role: 'authenticated' }))}, false);`;

// The product is looked up again on every attempt, so a save whose answer was lost is updated, never duplicated.
if (!SITE_ONLY) for (const x of plans) await withRetry(() => saveProduct(x));

async function saveProduct(x) {
  const found = (await runSql(`select id from public.products where slug = ${sql(x.slug)}`))[0];
  const variantIds = found ? Object.fromEntries((await runSql(`select id, sku from public.product_variants where product_id = ${sql(found.id)} and purpose is null`)).map((r) => [r.sku, r.id])) : {};
  const f = emptyProductForm(defaults);
  Object.assign(f, {
    id: found?.id,
    slug: x.slug,
    name: x.name,
    short_description: x.c.short,
    description: x.desc,
    primary_category_id: x.primary ? catId[x.primary] : '',
    category_ids: x.categories.filter((s) => s !== x.primary).map((s) => catId[s]),
    concentration_note: x.c.cn ?? (x.conc === 'extrait' ? 'Extrait de Parfum' : ''),
    badge: x.categories.includes('new-perfumes') ? 'NEW' : '',
    perfumer: PERFUMER,
    launch_year: String(LAUNCH_YEAR),
    inspiration: `<p>${esc(inspirationLine(x))}</p>`,
    how_to_wear: `<p>${esc(x.c.wear)}</p>`,
    seo_title: `${x.name} | Saudagar Perfumers`,
    seo_description: x.c.short.slice(0, 160),
    admin_note: x.note,
    is_active: true,
    is_featured: x.categories.includes('signature-fragrances'),
    stock_unit: x.combo ? 'piece' : 'ml',
    liquid_amount: x.combo ? '' : String(x.inStock ? STOCK_ML : 0),
    liquid_unit: 'ml',
    base_price: String(Math.min(...x.sizes.map((s) => s.price))),
    compare_at_price: '',
    notes: x.notes.map((n) => ({ note_id: findNote(n.name).id, tier: n.tier, position: n.position })),
    attributes: x.attrs.map((a) => ({ option_id: optId(a.kind, a.slug), kind: a.kind, strength: a.strength ?? null, is_primary: !!a.is_primary })),
  });
  const cheapest = x.sizes.reduce((a, b) => (b.price < a.price ? b : a));
  f.compare_at_price = cheapest.compare ? String(cheapest.compare) : '';
  f.variants = x.sizes.map((s) => ({
    ...emptyVariant(),
    size_ml: s.size_ml ? String(s.size_ml) : '',
    label: s.label,
    price: String(s.price),
    compare_at_price: s.compare ? String(s.compare) : '',
    weight_g: String(s.weight ?? WEIGHT_G[s.size_ml] ?? 450),
    initial_stock: x.combo ? String(s.stock) : '',
  }));
  if (!x.combo && x.inStock) {
    f.variants.push({ ...emptyVariant(), kind: 'sample', label: `${sampleMl} ml sample`, size_ml: String(sampleMl), in_sample_pool: true, weight_g: String(WEIGHT_G[5]) });
  }
  const payload = toSavePayload(f);
  for (const v of payload.variants) if (variantIds[v.sku]) v.id = variantIds[v.sku];
  payload.media = x.media.map((m) => ({ kind: 'image', url: urlOf(m), alt: m.alt, variant_sku: m.size_ml ? payload.variants.find((v) => Number(v.size_ml) === m.size_ml && v.kind === 'retail')?.sku ?? null : null }));
  const rows = await runSqlOnce(`${claims} select public.save_product(${json(payload)}) as id;`);
  console.log(`  ${found ? 'updated' : 'added'} ${x.name} (${rows[0]?.id})`);
}

// 5. remove our old content
if (!SITE_ONLY) {
const keepSlugs = `array[${plans.map((x) => sql(x.slug)).join(',')}]::text[]`;
await runSql(`
  update public.product_variants set in_sample_pool = false
    where product_id in (select p.id from public.products p where not p.is_gift_pack and not (p.slug = any (${keepSlugs})));
  update public.products p set is_active = false, archived_at = coalesce(p.archived_at, now())
    where not p.is_gift_pack and not (p.slug = any (${keepSlugs})) and exists (select 1 from public.order_items oi where oi.product_id = p.id);
  delete from public.products p
    where not p.is_gift_pack and not (p.slug = any (${keepSlugs})) and not exists (select 1 from public.order_items oi where oi.product_id = p.id);`);
const keepCats = `array[${CATEGORIES.map((d) => sql(d.slug)).join(',')}]::text[]`;
await runSql(`
  update public.categories set parent_id = null where not (slug = any (${keepCats}));
  delete from public.categories c where not (c.slug = any (${keepCats})) and not exists (select 1 from public.coupon_categories cc where cc.category_id = c.id);
  update public.categories set is_active = false where not (slug = any (${keepCats}));
  delete from public.collections;
  delete from public.stories;
  delete from public.reels;
  delete from public.testimonials;
  delete from public.announcements;
  delete from public.stockists;
  delete from public.website_sections where page_id in (select id from public.pages where slug in ('home', 'story', 'boutiques'));
  update public.pages set is_published = false where slug = 'story';`);
console.log('Old content removed.');
}

// 6. pages, home page, site text, settings
for (const [slug, p] of Object.entries(PAGES)) {
  await runSql(`update public.pages set title = ${sql(p.title)}, body = ${sql(p.body)}, layout = 'rich_text', is_published = true, seo_title = null, seo_description = null where slug = ${sql(slug)}`);
}
const home = (await runSql(`select id from public.pages where slug = 'home'`))[0].id;
await runSql(`delete from public.website_sections where page_id = ${sql(home)}`);
for (const [i, s] of homeSections(img).entries()) {
  await runSql(`insert into public.website_sections (page_id, section_type, label, position, is_visible, config) values (${sql(home)}, ${sql(s.section_type)}, ${sql(s.label)}, ${i}, ${s.visible === false ? 'false' : 'true'}, ${json(s.config)})`);
}
for (const [key, value] of Object.entries(siteBlocks(current, img))) {
  await runSql(`update public.site_blocks set value = ${json(value)}, updated_at = now() where key = ${sql(key)}`);
}
const setText = (key, value) => runSql(`update public.settings set value = to_jsonb(${sql(value)}::text) where key = ${sql(key)}`);
await setText('store.name', 'Saudagar Perfumers');
await setText('business.address', SITE.address);
await setText('returns.policy_text', 'Due to the nature of fragrance products and hygiene concerns, we follow a strict no-return and no-refund policy. If the wrong product is delivered, or it arrives damaged or leaking, contact us within 24 hours of delivery with clear photos or videos.');
console.log('Pages, home page, site text and settings written. Done.');
