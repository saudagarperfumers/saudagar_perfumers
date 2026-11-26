# Shop polish after the content move: design

**Date:** 2026-11-26 · **Owner requests and decisions:** given in chat on 2026-11-26

## Intent

After the old site's content moved in (phase 28), the owner reviewed the live shop and asked for the product page,
cards and home page to feel finished and professional, with the size bottles driving the experience.

## Decisions (owner)

| Request | Decision |
|---|---|
| Add-to-bag animation | The bottle of the size the customer picked flies into the bag, not the product's first photo. |
| Combos and gift sets | The premium 100 ml bottle flies into the bag (they have no bottle size). |
| Changing size | The gallery moves to that size's bottle. |
| 100 ml preview | Shows at the same scale as the other sizes, clear of the page dots. |
| Glow behind the bottle | Behind every photo, not only the first. |
| Back button | On the product page. |
| "Make it professional" | Both the product page buy box and the product cards. |
| Pagination | Home rows show 12 products per page with page numbers. |
| Old home sections | Same designs, filled with real products and words; testimonials and reels stay off until there are real reviews and videos. |
| Light theme | Fix places that are hard to read. |

## How it works

- `src/storefront/product/sizeImages.ts` maps each photo to its size (`product_media.variant_id`). The product page and
  the quick-add popup use it to show the picked size and to choose the picture that flies (`flyImageFor`).
- The picture for sets lives in Admin → Site content → Product page → "Picture that flies into the bag for sets and
  combos" (`site_blocks.product_page.set_fly_image`), set by the import to the trimmed 100 ml bottle.
- The plain bottle photos are trimmed to the bottle and set in a 4:5 frame by the import (`-fit` files); the
  originals stay in the Media library.
- `flyToCart` waits up to half a second for its picture, so a picture still downloading never flies invisibly.
- The desktop gallery's scroll stops work for any number of photos (the gift set has five).
- Buy box: Back and breadcrumb, scent family and gender, name, "Inspired by …", summary, key facts (concentration,
  how long it lasts, projection, gender), sizes with their prices, price per ml, stock with a coloured dot, notes at
  a glance, delivery and samples.
- Cards: category, name, sizes ("30 / 50 / 100 ml"), "From" price, MRP and % off; quick add always visible on touch
  screens (it was hover-only).
- `usePagedSourceProducts` pages home rows: hand-picked rows in the browser, the others one page at a time from the
  catalogue, up to the row's "How many" (now up to 120).
- Grids restart their reveal animation when their products change; before, products that loaded after the grid came
  into view (or a new page of them) stayed invisible.
- Light theme: links on text pages use the darker brand gold (contrast 3.2 → above 4.5).
- `scripts/old-site/import.mjs --only site` rewrites the home page and site text without touching products.

## Left to the builder

Category pictures use lifestyle photos (Black Code, White Code, Ocean Blue, combo) since the trimmed bottles look
empty on dark tiles; product photos stay the plain bottles.
