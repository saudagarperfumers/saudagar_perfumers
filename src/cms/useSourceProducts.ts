import { useEffect, useMemo, useState } from 'react';
import { useLegacyProducts, useProductsBySlugs } from '../storefront/catalog/hooks';
import { sourceToSearchPayload, type ProductSource } from './sources';

/** Products for a CMS product source; hand-picked products keep the order the admin chose. */
export function useSourceProducts(source: ProductSource | null | undefined) {
  const manual = source?.mode === 'manual';
  const picked = useProductsBySlugs(manual ? source?.products ?? [] : []);
  const searched = useLegacyProducts(sourceToSearchPayload(source), !manual);
  return manual ? { products: picked.products, isLoading: picked.isLoading } : { products: searched.products, isLoading: searched.isLoading };
}

/** Home rows show this many products per page, with page numbers below. */
export const ROW_PAGE_SIZE = 12;

/** The most products a row can page through ("How many" in the admin, 1–120). */
export function sourceLimit(source: ProductSource | null | undefined): number {
  const n = Math.round(Number(source?.limit));
  return Number.isFinite(n) && n > 0 ? Math.min(120, n) : 48;
}

/**
 * A product source split into pages of `perPage`. Hand-picked products are paged in the browser; the others ask the
 * catalogue for one page at a time, up to the row's "How many".
 */
export function usePagedSourceProducts(source: ProductSource | null | undefined, perPage = ROW_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const sourceKey = JSON.stringify(source ?? null);
  useEffect(() => setPage(1), [sourceKey]);

  const manual = source?.mode === 'manual';
  const picked = useProductsBySlugs(manual ? source?.products ?? [] : []);
  const payload = useMemo(() => ({ ...sourceToSearchPayload(source), page_size: perPage, page }), [sourceKey, perPage, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const searched = useLegacyProducts(payload, !manual);

  if (manual) {
    const pageCount = Math.max(1, Math.ceil(picked.products.length / perPage));
    const current = Math.min(page, pageCount);
    return {
      products: picked.products.slice((current - 1) * perPage, current * perPage),
      page: current,
      pageCount,
      setPage,
      isLoading: picked.isLoading,
    };
  }
  const total = Math.min(searched.total, sourceLimit(source));
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  // The last page stops at the row's limit even when the catalogue has more.
  const room = Math.max(0, total - (page - 1) * perPage);
  return { products: searched.products.slice(0, room), page, pageCount, setPage, isLoading: searched.isLoading };
}
