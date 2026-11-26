// Which photo belongs to which bottle size, so the gallery can jump to the size a customer picks
// and the bottle that flies into the bag is the one they chose.

export interface GalleryImage {
  url: string;
  variantId: string | null;
  alt: string | null;
}

interface MediaRow {
  kind: string;
  url: string;
  alt?: string | null;
  variant_id?: string | null;
}

/** The product's photos in admin order, each with the size it belongs to (if any). */
export function galleryFrom(media: MediaRow[] | null | undefined, fallback: string[] = []): GalleryImage[] {
  const images = (media ?? []).filter((m) => m.kind === 'image' && m.url);
  if (images.length) return images.map((m) => ({ url: m.url, variantId: m.variant_id ?? null, alt: m.alt ?? null }));
  return fallback.filter(Boolean).map((url) => ({ url, variantId: null, alt: null }));
}

/** Position of the first photo attached to this size, or -1 when the size has none. */
export function imageIndexFor(gallery: GalleryImage[], variantId: string | null | undefined): number {
  if (!variantId) return -1;
  return gallery.findIndex((g) => g.variantId === variantId);
}

/**
 * The picture that flies into the bag: the chosen size's own photo; for a set or combo (a size with no ml)
 * the picture set in Admin → Site content → Product page; otherwise the product's first photo.
 */
export function flyImageFor(
  gallery: GalleryImage[],
  size: { variantId?: string | null; ml?: number | null } | null | undefined,
  setImage?: string | null,
): string | null {
  const own = imageIndexFor(gallery, size?.variantId);
  if (own >= 0) return gallery[own].url;
  if (size && !(Number(size.ml) > 0) && setImage) return setImage;
  return gallery[0]?.url ?? null;
}
