# Old site content import: design

**Date:** 2026-11-26 · **Owner decisions:** given in chat on 2026-11-26

## Intent

The owner's current shop at saudagarperfumers.in (WordPress + WooCommerce) holds the real catalogue. Our site holds
sample content we invented while building it. The owner wants our site to carry **their** products and words, built on
**our** site's structure and features, so that saudagarperfumers.in can move to our site.

## Goals

- Every real product on their site is on ours, mapped into our admin the way a product added by hand would be
  (sizes, prices, MRP, notes pyramid, scent profile, categories, compliance defaults, free-sample size).
- Their real words replace ours: shipping, refund, privacy and terms policies, contact details, navigation and footer
  links, and the home page sections, in their order.
- All their photos and the owner's Drive photos are in the Media library.
- Old links from Google keep working (redirects).

## Non-goals / anti-goals

- No template filler from their site: the "Glozin" About Us page, the 12 fashion blog posts, the FAQ with unfilled
  blanks, Special Offers (fake codes, fashion reviews), Coming Soon, Track Order, Compare and other empty system pages.
- No copying of their features: AI chat assistant, "Request a callback" form, product compare.
- Policy words are copied only. Site behaviour (returns, cancellation, sign-in to buy, shipping fee) stays as it is.
- Our admin libraries stay: notes, note families, scent profile choices, product defaults, coupons, settings, orders,
  customers, the gift pack feature and its hidden pack product.

## Decisions (owner)

| Topic | Decision |
|---|---|
| What is removed | Our products, and our text content (home sections, story page, page text, stories, reels, testimonials, announcements, boutiques, nav/footer/drawer copy, SEO and search text). Irrelevant categories and collections are removed. |
| Template filler | Skipped. |
| Policies | Their words only. |
| Photos | Owner's Drive photos: plain Saudagar bottle photo for each size (30, 50, 100 ml); Ocean Blue, White Code and Black Code get their own shots; `combo_pack.png` is the 5 × 20 ml Gift Set. |
| Notes | Mapped into our notes pyramid, using our notes library. |
| Stock | Our approach (liquid in ml): 1 L for every in-stock perfume, 0 for the out-of-stock ones. |
| Duplicates | Merged: Hudson Valley ×2, Guidance (+ empty stub), Khamra → Khamarah, SRK → SSRK, Aventus → Creed Aventus (Creed Aventus prices). Fakhir and Fakhir Attar stay separate (different liquids). |
| Names | Tidied (case, spacing, obvious typos) and mapped to our admin. |
| Hero | Kept, with a new image. |
| Extra features | Not copied. |
| Old links | Redirected to the new pages. |
| Phone / WhatsApp | Our current number stays; their address and email are added. |
| Free samples | Every in-stock perfume sold by ml is offered as a free sample. |
| No category | Their home page headings become categories: Signature Fragrances (Ocean Blue, White Code, Black Code, Ice Land) and New Collections (the 4 combos). The rest go in Shop with no category. |
| Missing details | Guessed so each product has what our product page uses (notes, family, accords, gender, concentration, longevity, sillage, season, time of day, occasion, description). Every guessed field is listed in that product's admin note so the owner can check it. |

## Approach

Approaches considered:

1. **Reproducible import script (chosen).** Fetch their WooCommerce Store API into a committed snapshot. A curated
   data file holds the hand-cleaned parts (tidy names, notes, scent profile, guessed fields). A script saves every
   product through our own `save_product` function, the same path the editor and the spreadsheet import use, so
   defaults, SKUs, stock rules and search stay identical. It can be re-run.
2. *Spreadsheet import through the admin.* Uses the existing Excel import, but it can't delete content, upload photos
   from URLs, build pages or set redirects, and it only adds new products. Too partial.
3. *Hand-written SQL migration.* Bypasses `save_product` (stock, SKUs, search would have to be re-implemented) and
   can't upload photos. Rejected.

## How it works

- `scripts/old-site/fetch.mjs`: downloads products, every size (price, MRP, stock text), categories and pages into
  `scripts/old-site/snapshot.json`.
- `scripts/old-site/catalog.json`: the curated layer, one entry per product (after merges).
- `scripts/old-site/import.mjs`: backs up the current content, uploads photos as WebP (same settings as an admin
  upload) and records them in the Media library, removes our content, creates categories and missing notes, saves
  products, then writes pages, home sections, site text blocks and contact details.
- `vercel.json`: permanent redirects for old WooCommerce links that changed.
- Products that already have orders are archived, not deleted (store rule: sold products are archive only).

## Left to the builder

Exact section wording where their site has none (kept minimal and factual), the SEO description, piece counts for the
combos (their stated count where shown, otherwise 100), and prices for listings their site shows at ₹0 (guessed from
their usual price ladder and flagged in the admin note; those stay at 0 stock).
