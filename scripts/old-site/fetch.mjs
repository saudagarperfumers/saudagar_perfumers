// Downloads the old WooCommerce shop (saudagarperfumers.in) into scripts/old-site/snapshot.json:
// every product with each size's price, MRP and stock text, the categories, and the pages the import uses.
// Run: node scripts/old-site/fetch.mjs
import { writeFileSync } from 'node:fs';

const SITE = 'https://saudagarperfumers.in';
const API = `${SITE}/wp-json`;
const PAGES = ['shipping-policy', 'refund_returns', 'privacy-policy-2', 'terms-of-use', 'contact-us'];

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0 (store content import)' } });
      if (res.ok) return { body: await res.json(), headers: res.headers };
      if (res.status < 500) throw new Error(`${path}: HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`${path}: no answer`);
}

const rupees = (minor) => (minor === null || minor === undefined || minor === '' ? null : Number(minor) / 100);

const products = [];
for (let page = 1; ; page++) {
  const { body, headers } = await get(`/wc/store/v1/products?per_page=100&page=${page}`);
  products.push(...body);
  if (page >= Number(headers.get('x-wp-totalpages') ?? 1)) break;
}

const out = [];
for (const p of products) {
  const sizes = [];
  for (const v of p.variations ?? []) {
    const { body: x } = await get(`/wc/store/v1/products/${v.id}`);
    sizes.push({
      label: String(x.variation ?? '').replace(/^size:\s*/i, '').trim(),
      price: rupees(x.prices.price),
      regular_price: rupees(x.prices.regular_price),
      on_sale: !!x.on_sale,
      in_stock: !!x.is_in_stock,
      stock_text: x.stock_availability?.text ?? '',
      image: x.images?.[0]?.src ?? null,
    });
  }
  out.push({
    id: p.id,
    slug: p.slug,
    name: p.name,
    type: p.type,
    description: p.description,
    short_description: p.short_description,
    categories: p.categories.map((c) => c.slug),
    images: p.images.map((i) => i.src),
    price: rupees(p.prices.price),
    regular_price: rupees(p.prices.regular_price),
    on_sale: !!p.on_sale,
    in_stock: !!p.is_in_stock,
    stock_text: p.stock_availability?.text ?? '',
    sizes,
  });
}

const { body: categories } = await get('/wc/store/v1/products/categories?per_page=100');
const { body: pages } = await get('/wp/v2/pages?per_page=100');

writeFileSync(
  new URL('./snapshot.json', import.meta.url),
  `${JSON.stringify(
    {
      fetched_at: new Date().toISOString(),
      site: SITE,
      products: out,
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, count: c.count })),
      pages: pages.filter((p) => PAGES.includes(p.slug)).map((p) => ({ slug: p.slug, title: p.title.rendered, html: p.content.rendered })),
    },
    null,
    1,
  )}\n`,
);
console.log(`Saved ${out.length} products, ${categories.length} categories, ${PAGES.length} pages.`);
