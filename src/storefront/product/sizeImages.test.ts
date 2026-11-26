import { describe, expect, it } from 'vitest';
import { flyImageFor, galleryFrom, imageIndexFor } from './sizeImages';

const media = [
  { kind: 'image', url: '/30.webp', variant_id: 'v30' },
  { kind: 'video', url: '/film.mp4', variant_id: null },
  { kind: 'image', url: '/50.webp', variant_id: 'v50' },
  { kind: 'image', url: '/100.webp', variant_id: 'v100' },
];

describe('size photos', () => {
  it('keeps photos in order with their size, without videos', () => {
    expect(galleryFrom(media).map((g) => g.url)).toEqual(['/30.webp', '/50.webp', '/100.webp']);
    expect(galleryFrom([], ['/a.webp'])).toEqual([{ url: '/a.webp', variantId: null, alt: null }]);
  });

  it('finds the photo of a size', () => {
    const g = galleryFrom(media);
    expect(imageIndexFor(g, 'v100')).toBe(2);
    expect(imageIndexFor(g, 'nope')).toBe(-1);
    expect(imageIndexFor(g, null)).toBe(-1);
  });

  it('flies the chosen bottle, the set picture for combos, else the first photo', () => {
    const g = galleryFrom(media);
    expect(flyImageFor(g, { variantId: 'v50', ml: 50 }, '/set.webp')).toBe('/50.webp');
    expect(flyImageFor(galleryFrom([{ kind: 'image', url: '/box.webp' }]), { variantId: 'box', ml: null }, '/set.webp')).toBe('/set.webp');
    expect(flyImageFor(galleryFrom([{ kind: 'image', url: '/box.webp' }]), { variantId: 'box', ml: null }, '')).toBe('/box.webp');
    expect(flyImageFor(g, { variantId: 'v12', ml: 12 }, '/set.webp')).toBe('/30.webp');
  });
});
