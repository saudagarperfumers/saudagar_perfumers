import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { toFriendlyError } from '../../lib/errors';
import { fetchAll } from '../../lib/fetchAll';
import { PageHeader, Panel } from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { downloadBlob, downloadCsv } from '../export/csv';
import { rpc, throwIf, useCategories, useCollectionsAdmin, useInvalidateCatalog, useNotes, useOptions, type OptionRow } from '../catalog/api';
import { slugify, toSavePayload } from '../catalog/productForm';
import { useProductDefaults } from '../catalog/useProductDefaults';
import { useSetting } from '../../lib/bootstrap';
import { useBlock } from '../../cms/useSite';
import { diffPriceStock, priceStockSheet, type Lookup, type SheetProblem, type SizeChange, type VariantRow } from '../bulk/sheets';
import { OPTION_COLUMNS, planProductSheet, relatedIds, resolveForm, toCreate, type SheetPlan } from '../bulk/productSheet';
import { buildProductTemplate, readProductSheet, templateChoices } from '../bulk/productSheetXlsx';

const today = () => new Date().toISOString().slice(0, 10);

function useVariantRows() {
  return useQuery({
    queryKey: ['admin', 'catalog', 'variant-sheet'],
    queryFn: async () => {
      const rows = await fetchAll<{
        sku: string; label: string; kind: string; price: number | null; compare_at_price: number | null; stock: number; product_id: string;
        products: { name: string; base_price: number; archived_at: string | null; stock_unit: 'ml' | 'piece'; stock_ml: number } | null;
      }>((from, to) =>
        supabase
          .from('product_variants')
          .select('sku, label, kind, price, compare_at_price, stock, product_id, products!inner(name, base_price, archived_at, stock_unit, stock_ml)', { count: 'exact' })
          .is('purpose', null)
          .eq('products.is_gift_pack', false)
          .order('sku')
          .range(from, to) as never,
      );
      return rows
        .filter((r) => r.products && !r.products.archived_at)
        .map<VariantRow>((r) => ({
          sku: r.sku,
          product_id: r.product_id,
          product: r.products!.name,
          stock_unit: r.products!.stock_unit,
          liquid_ml: Number(r.products!.stock_ml),
          label: r.label,
          kind: r.kind,
          base_price: Number(r.products!.base_price),
          price: r.price === null ? null : Number(r.price),
          compare_at_price: r.compare_at_price === null ? null : Number(r.compare_at_price),
          stock: r.stock,
        }))
        .sort((a, b) => a.product.localeCompare(b.product) || a.label.localeCompare(b.label));
    },
  });
}

function FilePick({ onFile, label, accept, busy, disabled }: { onFile: (file: File) => void; label: string; accept: string; busy?: boolean; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <Button busy={busy} disabled={disabled} onClick={() => ref.current?.click()}>
        <FileUp size={14} /> {label}
      </Button>
    </>
  );
}

function Problems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="border border-rose-200 bg-rose-50 px-4 py-3">
      <p className="text-[14px] font-medium text-rose-800 mb-1">
        {items.length} {items.length === 1 ? 'row has a problem' : 'rows have problems'} and will be skipped
      </p>
      <ul className="text-[13px] text-rose-800 list-disc pl-5 space-y-0.5 max-h-48 overflow-y-auto">
        {items.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  );
}

// ============================================================ prices and stock
function PriceStockTab() {
  const { data: rows = [], isLoading, refetch } = useVariantRows();
  const invalidate = useInvalidateCatalog();
  const [file, setFile] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ changes: SizeChange[]; problems: SheetProblem[]; rows: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => {
    const c = plan?.changes ?? [];
    return { price: c.filter((x) => x.price || x.compare_at_price).length, stock: c.filter((x) => x.stock || x.liquid).length };
  }, [plan]);

  return (
    <div className="space-y-5">
      <Panel title="1 · Download the current sheet" description="Every bottle size and sample vial with its SKU, price and stock, ready for Excel or Google Sheets.">
        <Button variant="secondary" disabled={isLoading || !rows.length} onClick={() => downloadCsv(`prices-and-stock-${today()}.csv`, priceStockSheet(rows))}>
          <Download size={14} /> Download {rows.length ? `${rows.length} sizes` : 'sheet'}
        </Button>
        <ul className="mt-3 text-[13px] text-[#454545] list-disc pl-5 space-y-1">
          <li>Change <strong>Price</strong>, <strong>Compare-at price</strong>, <strong>Liquid left (ml)</strong> for perfumes, or <strong>Stock</strong> for sets and accessories. Don't change the SKU; it's how each row is matched.</li>
          <li>An empty Price means the size uses the product's base price. A perfume's liquid is shared by its sizes, so it repeats on each of its rows; change it on any one. Every change is logged in the stock history.</li>
          <li>You can delete rows or columns you aren't changing. Save as CSV.</li>
        </ul>
      </Panel>

      <Panel title="2 · Upload it and check the changes" description="Nothing is saved until you press Apply.">
        <div className="flex flex-wrap items-center gap-3">
          <FilePick
            label="Upload edited sheet (CSV)"
            accept=".csv,text/csv"
            onFile={async (f) => {
              if (!/\.csv$/i.test(f.name)) return void toast.error('Save the sheet as CSV first (Excel: File → Save as → CSV UTF-8; Google Sheets: File → Download → CSV).');
              setFile(f.name);
              setPlan(diffPriceStock(await f.text(), rows));
            }}
          />
          {file && <span className="text-[13px] text-[#454545]">{file}</span>}
        </div>

        {plan && (
          <div className="mt-5 space-y-4">
            <p className="text-[14px] text-tk-ink">
              {plan.changes.length
                ? `${plan.changes.length} ${plan.changes.length === 1 ? 'size changes' : 'sizes change'}: ${counts.price} price, ${counts.stock} stock.`
                : 'Nothing changes: the sheet matches the store.'}{' '}
              <span className="text-[#4A4A4A]">({plan.rows} rows read)</span>
            </p>
            <Problems items={plan.problems.map((p) => `Row ${p.line}${p.sku ? ` · ${p.sku}` : ''}: ${p.message}`)} />
            {plan.changes.length > 0 && (
              <div className="border border-[#E2E0DB] overflow-x-auto max-h-[420px]">
                <table className="w-full text-[13.5px] min-w-[640px]">
                  <thead className="sticky top-0 bg-[#F8F7F5]">
                    <tr className="text-left text-[12px] border-b border-[#E2E0DB] font-medium">
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Compare-at</th>
                      <th className="px-3 py-2 font-medium">Liquid / stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E9E7E2]">
                    {plan.changes.map((c) => (
                      <tr key={c.sku}>
                        <td className="px-3 py-2">
                          {c.product} · {c.label}
                          <span className="block text-[12px] font-mono text-[#4A4A4A]">{c.sku}</span>
                        </td>
                        {(['price', 'compare_at_price', 'stock'] as const).map((k) => {
                          const ch = k === 'stock' ? c.liquid ?? c.stock : c[k];
                          return (
                          <td key={k} className="px-3 py-2 tabular-nums">
                            {ch ? (
                              <>
                                <span className="text-[#575757] line-through mr-1.5">{ch.from}</span>
                                <span className="font-medium text-tk-ink">{ch.to}</span>
                              </>
                            ) : (
                              <span className="text-[#666666]">—</span>
                            )}
                          </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                busy={busy}
                disabled={!plan.changes.length}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await rpc<{ updated: number; stock_changes: number; errors: { sku: string; message: string }[] }>('bulk_update_variants', {
                      p_rows: plan.changes.map((c) => c.payload),
                    });
                    toast.success(`${r.updated} sizes updated${r.stock_changes ? `, ${r.stock_changes} stock changes logged` : ''}.`);
                    if (r.errors.length) toast.warning(`${r.errors.length} rows were refused`, { description: r.errors.slice(0, 6).map((e) => `${e.sku}: ${e.message}`).join('  ·  '), duration: 12000 });
                    await Promise.all([invalidate(), refetch()]);
                    setPlan(null);
                    setFile(null);
                  } catch (err) {
                    toast.error(toFriendlyError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Apply {plan.changes.length} changes
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => { setPlan(null); setFile(null); }}>Cancel</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ============================================================ import new products
type StoreProduct = Lookup & { is_gift_pack: boolean; archived_at: string | null };
type ImportResult = { handle: string; name: string; id?: string; error?: string };
const KIND_LABEL = Object.fromEntries(OPTION_COLUMNS) as Record<string, string>;

function ImportTab() {
  const { data: categories = [], refetch: refetchCategories, isSuccess: c1 } = useCategories();
  const { data: collections = [], refetch: refetchCollections, isSuccess: c2 } = useCollectionsAdmin();
  const { data: notes = [], refetch: refetchNotes, isSuccess: c3 } = useNotes();
  const { data: options = [], refetch: refetchOptions, isSuccess: c4 } = useOptions();
  const { data: storeProducts = [], refetch: refetchProducts, isSuccess: c5 } = useQuery({
    queryKey: ['admin', 'catalog', 'all-product-names'],
    queryFn: async () => (await throwIf(supabase.from('products').select('id, name, slug, is_gift_pack, archived_at').order('name'))) as StoreProduct[],
  });
  const productDefaults = useProductDefaults();
  const sampleSize = Number(useSetting('samples.sample_size_ml', 5)) || 5;
  const brand = useBlock<Record<string, string>>('brand')?.name || 'Saudagar Perfumers';
  const invalidate = useInvalidateCatalog();
  const [plan, setPlan] = useState<(SheetPlan & { file: string }) | null>(null);
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  // The template's dropdowns and the upload check both need the store's lists, so wait for them.
  const loaded = c1 && c2 && c3 && c4 && c5;

  const optionLookups = (rows: OptionRow[]) => rows.map((o) => ({ id: o.id, name: o.label, slug: o.slug, kind: o.kind }));
  const ready = useMemo(() => plan?.products.filter((p) => !p.errors.length) ?? [], [plan]);
  const blocked = plan?.products.filter((p) => p.errors.length) ?? [];
  const create = useMemo(() => toCreate(ready), [ready]);
  const warnings = ready.flatMap((p) => p.warnings.map((w) => `Row ${p.line} · ${p.form.name}: ${w}`));
  const liveCount = ready.filter((p) => p.form.is_active).length;

  const downloadTemplate = async () => {
    setBuilding(true);
    try {
      const choices = templateChoices({
        categories,
        collections,
        notes,
        options,
        products: storeProducts.filter((p) => !p.is_gift_pack && !p.archived_at),
      });
      const buf = await buildProductTemplate(choices, { brand, sampleSize });
      downloadBlob('product-sheet.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (err) {
      toast.error(toFriendlyError(err));
    } finally {
      setBuilding(false);
    }
  };

  const readFile = async (file: File) => {
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      toast.error('Upload the Excel file (.xlsx). Google Sheets: File → Download → Microsoft Excel.');
      return;
    }
    setResults(null);
    setReading(true);
    try {
      const sheet = await readProductSheet(await file.arrayBuffer(), file.name);
      const [media, skus] = await Promise.all([
        fetchAll<{ url: string; kind: string; original_name: string | null; path: string }>((from, to) =>
          supabase.from('media_assets').select('url, kind, original_name, path', { count: 'exact' }).order('created_at', { ascending: false }).order('id').range(from, to) as never,
        ),
        fetchAll<{ sku: string }>((from, to) => supabase.from('product_variants').select('sku', { count: 'exact' }).order('sku').range(from, to) as never),
      ]);
      const r = planProductSheet(
        { products: sheet.products, sizes: sheet.sizes },
        {
          categories,
          collections,
          notes,
          options: optionLookups(options),
          products: storeProducts,
          existingSkus: new Set(skus.map((x) => x.sku.toUpperCase())),
          media: media.flatMap((m) => [
            ...(m.original_name ? [{ name: m.original_name, url: m.url, kind: m.kind }] : []),
            { name: m.path, url: m.url, kind: m.kind },
          ]),
          defaults: productDefaults,
          sampleSize,
        },
      );
      setPlan({ ...r, problems: [...sheet.problems, ...r.problems], file: file.name });
    } catch (err) {
      toast.error(toFriendlyError(err));
    } finally {
      setReading(false);
    }
  };

  const freeSlug = (name: string, taken: string[]) => {
    const base = slugify(name) || 'item';
    let slug = base;
    for (let i = 2; taken.includes(slug); i += 1) slug = `${base}-${i}`;
    return slug;
  };

  const runImport = async () => {
    setResults(null);
    try {
      // 1. Everything the products need: missing categories, collections, notes and scent choices.
      const cats: Lookup[] = [...categories];
      for (const name of create.categories) {
        setProgress(`Creating category “${name}”…`);
        const leaf = name.split(/>|›/).pop()!.trim();
        cats.push((await throwIf(supabase.from('categories').insert({ name: leaf, slug: freeSlug(leaf, cats.map((c) => c.slug ?? '')) }).select('id, name, slug').single())) as Lookup);
      }
      const cols: Lookup[] = [...collections];
      for (const name of create.collections) {
        setProgress(`Creating collection “${name}”…`);
        cols.push((await throwIf(supabase.from('collections').insert({ name, slug: freeSlug(name, cols.map((c) => c.slug ?? '')) }).select('id, name, slug').single())) as Lookup);
      }
      const nts: Lookup[] = [...notes];
      for (const name of create.notes) {
        setProgress(`Adding note “${name}”…`);
        nts.push((await throwIf(supabase.from('notes').insert({ name, slug: freeSlug(name, nts.map((n) => n.slug ?? '')) }).select('id, name, slug').single())) as Lookup);
      }
      const opts = optionLookups(options);
      for (const o of create.options) {
        setProgress(`Adding ${KIND_LABEL[o.kind]?.toLowerCase() ?? 'choice'} “${o.label}”…`);
        const taken = opts.filter((x) => x.kind === o.kind).map((x) => x.slug ?? '');
        const row = (await throwIf(
          supabase.from('attribute_options').insert({ kind: o.kind, label: o.label, slug: freeSlug(o.label, taken) }).select('id, label, slug, kind').single(),
        )) as OptionRow;
        opts.push({ id: row.id, name: row.label, slug: row.slug, kind: row.kind });
      }

      // 2. The products, one by one, so one problem doesn't stop the rest.
      const out: ImportResult[] = [];
      for (const [i, p] of ready.entries()) {
        setProgress(`Importing ${i + 1} of ${ready.length}: ${p.form.name}`);
        try {
          const form = resolveForm(p, { categories: cats, collections: cols, notes: nts, options: opts });
          const id = await rpc<string>('save_product', { payload: toSavePayload(form) });
          if (form.page_sections.length || !form.use_default_sections) {
            await throwIf(supabase.from('products').update({ page_sections: form.page_sections as never, use_default_sections: form.use_default_sections }).eq('id', id));
          }
          out.push({ handle: p.handle, name: p.form.name, id });
        } catch (err) {
          out.push({ handle: p.handle, name: p.form.name, error: toFriendlyError(err) });
        }
      }

      // 3. "You may also appreciate", now that every product in the sheet exists.
      const known: Lookup[] = [...storeProducts, ...out.filter((r) => r.id).map((r) => ({ id: r.id!, name: r.name, slug: r.handle }))];
      for (const r of out) {
        const p = ready.find((x) => x.handle === r.handle);
        if (!r.id || !p?.related.length) continue;
        const ids = relatedIds(p.related, known, r.id);
        if (!ids.length) continue;
        setProgress(`Linking “You may also appreciate” for ${r.name}…`);
        try {
          await throwIf(supabase.from('products').update({ related_product_ids: ids }).eq('id', r.id));
        } catch (err) {
          r.error = `Imported, but “You may also appreciate” wasn't saved: ${toFriendlyError(err)}`;
        }
      }
      setResults(out);
      setPlan(null);
      const ok = out.filter((r) => r.id).length;
      toast.success(`${ok} product${ok === 1 ? '' : 's'} imported.`);
    } catch (err) {
      toast.error(toFriendlyError(err));
    } finally {
      setProgress(null);
      await Promise.all([invalidate(), refetchCategories(), refetchCollections(), refetchNotes(), refetchOptions(), refetchProducts()]);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        title="1 · Download the template"
        description="An Excel file ready to send to whoever fills in your products. It has a How to fill tab, a filled-in example, and dropdowns with your current categories, scent choices and notes."
      >
        <Button variant="secondary" busy={building} disabled={!loaded} onClick={downloadTemplate}>
          <Download size={14} /> {loaded ? 'Download template (.xlsx)' : 'Loading your store…'}
        </Button>
        <ul className="mt-3 text-[13px] text-[#454545] list-disc pl-5 space-y-1">
          <li>One row per product. Only <strong>Product name</strong>, <strong>Main category</strong> and one <strong>price</strong> are required; every other column is optional.</li>
          <li>30, 50 and 100 ml each have a price column. Other sizes (attar 6 ml, gift box) go on the <strong>Other sizes</strong> tab.</li>
          <li>Everything on the product page can be filled in: scent type, accords, notes, story, extra sections, label details, parcel sizes, Google text.</li>
          <li>Categories, collections, notes and scent choices that don't exist yet are created for you.</li>
        </ul>
      </Panel>

      <Panel title="2 · Upload the filled sheet and check it" description="Nothing is saved until you press Import.">
        <p className="text-[13px] text-[#454545] mb-3">
          Photos: upload the photo files to the <Link to="/admin/media" className="underline underline-offset-4">Media library</Link> first (you can pick them all at once). The sheet finds them by file name.
        </p>
        <FilePick label="Upload filled sheet (.xlsx)" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" busy={reading} disabled={!loaded} onFile={readFile} />

        {plan && (
          <div className="mt-5 space-y-4">
            <p className="text-[14px]">
              <strong>{plan.file}</strong>: {ready.length} product{ready.length === 1 ? '' : 's'} ready to import
              {ready.length > 0 && ` (${liveCount} live, ${ready.length - liveCount} draft)`}
              {blocked.length > 0 && `, ${blocked.length} with problems (skipped)`}
              {plan.existing.length > 0 && `, ${plan.existing.length} already in the store (left alone)`}.
            </p>
            <Problems items={[...plan.problems, ...blocked.flatMap((p) => p.errors.map((e) => `Row ${p.line} · ${p.form.name || p.handle}: ${e}`))]} />
            {warnings.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[14px] font-medium text-amber-900 mb-1">Worth a look (these still import)</p>
                <ul className="text-[13px] text-amber-900 list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {plan.existing.length > 0 && (
              <div className="border border-[#E2E0DB] bg-[#F8F7F5] px-4 py-3 text-[13px] text-[#3F3F3F]">
                <p className="font-medium mb-1">Already in the store, left alone</p>
                <p>{plan.existing.map((e) => e.name).join(', ')}</p>
                <p className="mt-1 text-[#4F4F4F]">Change these on their product page, or their prices and stock in the Update prices &amp; stock tab.</p>
              </div>
            )}
            {(create.categories.length > 0 || create.collections.length > 0 || create.notes.length > 0 || create.options.length > 0) && (
              <div className="border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] text-sky-900 space-y-1">
                <p className="font-medium">These will be created:</p>
                {create.categories.length > 0 && <p>Categories: {create.categories.join(', ')}</p>}
                {create.collections.length > 0 && <p>Collections: {create.collections.join(', ')}</p>}
                {create.notes.length > 0 && <p>Notes: {create.notes.join(', ')}</p>}
                {create.options.length > 0 && <p>Scent choices: {create.options.map((o) => `${o.label} (${KIND_LABEL[o.kind]?.toLowerCase() ?? o.kind})`).join(', ')}</p>}
              </div>
            )}
            {ready.length > 0 && (
              <div className="border border-[#E2E0DB] overflow-x-auto max-h-[420px]">
                <table className="w-full text-[13.5px] min-w-[640px]">
                  <thead className="sticky top-0 bg-[#F8F7F5]">
                    <tr className="text-left text-[12px] border-b border-[#E2E0DB]">
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 font-medium">Sizes</th>
                      <th className="px-3 py-2 font-medium">Photos</th>
                      <th className="px-3 py-2 font-medium">Notes</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E9E7E2]">
                    {ready.map((p) => (
                      <tr key={p.handle}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{p.form.name}</span>
                          <span className="block text-[12px] text-[#4A4A4A]">/product/{p.handle}</span>
                        </td>
                        <td className="px-3 py-2">{p.mainCategory}</td>
                        <td className="px-3 py-2">{p.form.variants.filter((v) => v.kind === 'retail').map((v) => v.label).join(', ')}</td>
                        <td className="px-3 py-2 tabular-nums">{p.form.media.length}</td>
                        <td className="px-3 py-2 tabular-nums">{p.noteNames.length}</td>
                        <td className={`px-3 py-2 ${p.form.is_active ? 'text-emerald-700' : 'text-amber-700'}`}>{p.form.is_active ? 'Live' : 'Draft'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button busy={!!progress} disabled={!ready.length} onClick={runImport}>
                Import {ready.length} product{ready.length === 1 ? '' : 's'}
              </Button>
              <Button variant="secondary" disabled={!!progress} onClick={() => setPlan(null)}>Cancel</Button>
              {progress && <span role="status" className="text-[13px] text-[#454545]">{progress}</span>}
            </div>
          </div>
        )}

        {results && (
          <div className="mt-5 border border-[#E2E0DB]">
            <p className="px-3 py-2 bg-[#F8F7F5] text-[14px] font-medium">Import finished</p>
            <ul className="divide-y divide-[#E9E7E2]">
              {results.map((r) => (
                <li key={r.handle} className="px-3 py-2 text-[13.5px] flex flex-wrap gap-3 justify-between">
                  <span>{r.name}</span>
                  {r.error && <span className="text-rose-700">{r.error}</span>}
                  {r.id && (
                    <Link to={`/admin/products/${r.id}`} className="underline underline-offset-4">Open product →</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function SpreadsheetsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'import' ? 'import' : 'prices';
  return (
    <div className="max-w-[1000px]">
      <PageHeader
        title="Spreadsheets"
        description="Change many prices and stock counts at once, or add many products, using Excel or Google Sheets."
      />
      <div role="tablist" aria-label="Spreadsheet tasks" className="flex gap-1 mb-5 border-b border-[#E2E0DB]">
        {[
          ['prices', 'Update prices & stock'],
          ['import', 'Import new products'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams(k === 'prices' ? {} : { tab: k })}
            className={`px-4 py-2.5 text-[14px] border-b-2 -mb-px ${tab === k ? 'border-tk-accent text-tk-ink font-semibold' : 'border-transparent text-[#454545] hover:text-tk-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'prices' ? <PriceStockTab /> : <ImportTab />}
    </div>
  );
}
