import { describe, expect, it } from 'vitest';
import { diffPriceStock, priceStockSheet, type VariantRow } from './sheets';

const current: VariantRow[] = [
  { sku: 'OUD-50', product_id: 'p1', product: 'Oud', stock_unit: 'piece', liquid_ml: 0, label: '50 ml', kind: 'retail', base_price: 4900, price: null, compare_at_price: null, stock: 10 },
  { sku: 'OUD-100', product_id: 'p1', product: 'Oud', stock_unit: 'piece', liquid_ml: 0, label: '100 ml', kind: 'retail', base_price: 4900, price: 7900, compare_at_price: null, stock: 4 },
  { sku: 'ROSE-30', product_id: 'p2', product: 'Rose', stock_unit: 'ml', liquid_ml: 900, label: '30 ml', kind: 'retail', base_price: 2000, price: null, compare_at_price: null, stock: 30 },
  { sku: 'ROSE-50', product_id: 'p2', product: 'Rose', stock_unit: 'ml', liquid_ml: 900, label: '50 ml', kind: 'retail', base_price: 2000, price: 3000, compare_at_price: null, stock: 18 },
];

describe('diffPriceStock', () => {
  it('round-trips: the downloaded sheet changes nothing', () => {
    expect(diffPriceStock(priceStockSheet(current), current).changes).toEqual([]);
  });
  it('lists only what changes, and what is wrong', () => {
    const sheet = 'SKU,Price (₹),Stock\nOUD-50,"5,200",12\noud-100,,4\nNOPE,1,1\nOUD-50,1,1\nOUD-100,abc,1';
    const { changes, problems } = diffPriceStock(sheet, current);
    expect(changes.map((c) => [c.sku, c.payload])).toEqual([
      ['OUD-50', { sku: 'OUD-50', price: 5200, stock: 12 }],
      ['OUD-100', { sku: 'OUD-100', price: null }],
    ]);
    expect(changes[1].price).toEqual({ from: '₹7,900', to: 'base price' });
    expect(problems.map((p) => p.sku)).toEqual(['NOPE', 'OUD-50', 'OUD-100']);
  });
  it('leaves columns that are not in the sheet alone', () => {
    const { changes } = diffPriceStock('SKU,Stock\nOUD-100,9', current);
    expect(changes[0].payload).toEqual({ sku: 'OUD-100', stock: 9 });
  });
  it('changes a perfume\'s liquid once, and refuses a per-size count for it', () => {
    const { changes, problems } = diffPriceStock('SKU,Liquid left (ml),Stock\nROSE-30,1200,\nROSE-50,5,99', current);
    expect(changes.map((c) => c.payload)).toEqual([{ sku: 'ROSE-30', liquid_ml: 1200 }]);
    expect(changes[0].liquid).toEqual({ from: '900 ml', to: '1,200 ml' });
    expect(problems.map((p) => p.message).join(' ')).toMatch(/different Liquid left/);
    expect(problems.map((p) => p.message).join(' ')).toMatch(/kept as liquid/);
  });
  it('asks for a SKU column', () => {
    expect(diffPriceStock('Product,Stock\nOud,1', current).problems[0].message).toMatch(/SKU column/);
  });
});
