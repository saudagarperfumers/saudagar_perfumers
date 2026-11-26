import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { suggestListing } from '../lib/searchListing';
import { galleryFrom, imageIndexFor, flyImageFor } from '../storefront/product/sizeImages';
import { useShopWords } from '../cms/shopWords';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { formatINR as formatPrice } from '../lib/money';
import BluorngProductCard from './BluorngProductCard.jsx';
import BluorngProductReviews from './BluorngProductReviews.jsx';
import NotifyMe from '../storefront/product/NotifyMe.jsx';
import { StaggerContainer, StaggerItem } from './motion/ScrollReveal.jsx';
import { useSmoothScroll } from './motion/SmoothScrollProvider.jsx';
import { useProductDetail, useProductsBySlugs } from '../storefront/catalog/hooks';
import { toLegacyProduct } from '../storefront/catalog/adapter';
import { recordView } from '../storefront/catalog/recentlyViewed';
import { useSetting } from '../lib/bootstrap';
import { NotePyramid, AccordBars, ProductAccordions } from '../storefront/product/ProductSections.jsx';
import NotFoundPage from '../storefront/NotFoundPage';
import ServiceDown from './ServiceDown';
import { useSEO, productJsonLd, breadcrumbJsonLd } from '../lib/seo';
import { track } from '../lib/analytics';
import { useBlock } from '../cms/useSite';
import { CmsSections } from '../cms/SectionRenderer';
import { SectionContext } from '../cms/SectionContext';

// Shown until the product page layout loads (and if it can't): the same sections it starts with.
const PRODUCT_PAGE_DEFAULT = [
  { id: 'd1', type: 'product_composition', config: { eyebrow: 'Atelier Specifications', heading: 'Craft & Olfactory Composition' } },
  { id: 'd2', type: 'product_reviews', config: {} },
  { id: 'd3', type: 'product_similar', config: { eyebrow: 'Similar Scents', heading: 'You May Also Appreciate', limit: 4 } },
  { id: 'd4', type: 'product_recent', config: { eyebrow: 'Your Journey', heading: 'Recently Viewed' } },
];

export default function BluorngPDP(props) {
  const { data: detail, isLoading, error } = useProductDetail(props.productId);
  const product = useMemo(() => (detail ? toLegacyProduct(detail) : null), [detail]);

  const brand = useBlock('brand') || {};
  // Words on Google: the admin's own, or the same automatic words the admin preview shows.
  const listing = detail
    ? suggestListing({
        kind: 'product',
        name: detail.name,
        summary: detail.short_description,
        body: detail.description,
        notes: [...(detail.notes?.top ?? []), ...(detail.notes?.heart ?? []), ...(detail.notes?.base ?? [])].map((n) => n.name),
        family: detail.attributes?.family?.[0]?.label ?? detail.family ?? null,
        sizes: (detail.sizes ?? []).map((s) => Number(s.ml)),
        siteName: brand.name || 'Saudagar Perfumers',
      })
    : null;
  useSEO(
    detail && product
      ? {
          title: detail.seo_title || listing.title,
          description: detail.seo_description || listing.description,
          image: product.images?.[0],
          path: `/product/${detail.slug}`,
          type: 'product',
          jsonLd: [
            productJsonLd({
              name: product.name,
              slug: detail.slug,
              description: detail.description || detail.short_description,
              images: product.images ?? [],
              brand: brand.name || 'Saudagar Perfumers',
              rating: product.reviewsCount > 0 ? { average: Number(product.rating), count: product.reviewsCount } : null,
              offers: (product.sizes ?? []).map((s) => ({ sku: s.variantId, price: Number(s.price), inStock: s.stock > 0, label: s.label })),
            }),
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              ...(detail.categories?.[0] ? [{ name: detail.categories[0].name, path: `/categories/${detail.categories[0].slug}` }] : []),
              { name: product.name, path: `/product/${detail.slug}` },
            ]),
          ],
        }
      : { title: null },
  );
  useEffect(() => {
    if (product) track('view_item', { value: Number(product.price) || 0, items: [{ item_id: product.id, item_name: product.name, price: Number(product.price) || 0 }] });
  }, [product]);

  if (isLoading) {
    return <div className="min-h-screen bg-white dark:bg-tk-night" aria-busy="true" />;
  }
  if (error) {
    return <ServiceDown inline />;
  }
  if (!detail || !product) {
    return <NotFoundPage onNavigateHome={props.onNavigateHome} onNavigateCollection={props.onNavigateCollection} />;
  }
  return <PDPView key={product.id} {...props} product={product} detail={detail} />;
}

function PDPView({
  product,
  detail,
  wishlist = [],
  onToggleWishlist,
  onSelectProduct,
  onAddToCart,
  onQuickBuy
}) {
  const isCurrentWishlisted = wishlist.includes(product.id);
  // Photos with the size each belongs to: picking a size shows its bottle, and that bottle flies into the bag.
  const gallery = useMemo(() => galleryFrom(detail.media, product.images), [detail.media, product.images]);
  const images = gallery.map((g) => g.url);
  const productPageBlock = useBlock('product_page') || {};
  const navigate = useNavigate();
  // The main category (the card's category name), else any category the product is in.
  const primaryCategory = detail.categories?.find((c) => c.name === product.category) ?? detail.categories?.[0] ?? null;
  const goBack = () => {
    // Back to where the visitor came from inside the shop; a direct visit goes to the product's category.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(primaryCategory ? `/categories/${primaryCategory.slug}` : '/shop');
  };

  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const words = useShopWords();
  // "Vegan · Cruelty Free" shows only for products the admin switched on.
  const claims = [detail?.is_vegan && words.vegan, detail?.is_cruelty_free && words.cruelty_free].filter(Boolean);
  const [mobileImgIdx, setMobileImgIdx] = useState(0);
  const trackRef = useRef(null);
  const { scrollTo } = useSmoothScroll();

  // Ensure immediate scroll reset and state sync when PDP mounts or product changes
  useEffect(() => {
    window.scrollTo(0, 0);
    if (window.__lenis) {
      window.__lenis.scrollTo(0, { immediate: true });
    }
    setActiveImgIdx(0);
    setMobileImgIdx(0);
  }, [product.id]);

  // Track scroll progress through the pinned hero section (Desktop)
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end']
  });

  // Each photo holds still around its own stop (stop i at i / (n - 1) of the scroll), then slides to the next.
  const numImgs = images.length;
  const { keyframesInput, keyframesOutput } = useMemo(() => {
    if (numImgs <= 1) return { keyframesInput: [0, 1], keyframesOutput: ['0%', '0%'] };
    const hold = 0.2 / (numImgs - 1);
    const input = [];
    const output = [];
    for (let i = 0; i < numImgs; i++) {
      const stop = i / (numImgs - 1);
      input.push(Math.max(0, stop - hold), Math.min(1, stop + hold));
      output.push(`${-100 * i}%`, `${-100 * i}%`);
    }
    return { keyframesInput: input, keyframesOutput: output };
  }, [numImgs]);

  const yTransform = useTransform(scrollYProgress, keyframesInput, keyframesOutput);

  // Sync the desktop active indicator dot based on scroll progress
  useEffect(() => {
    const unsubscribe = scrollYProgress.on('change', (latest) => {
      setActiveImgIdx(numImgs > 1 ? Math.round(latest * (numImgs - 1)) : 0);
    });
    return () => unsubscribe();
  }, [scrollYProgress, numImgs]);

  // Desktop: scroll the page to photo n (the buy box stays pinned beside it)
  const handleDotClick = (targetIdx) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const trackTop = window.scrollY + rect.top;
    const totalScrollable = trackRef.current.offsetHeight - window.innerHeight;
    const targetRatio = numImgs > 1 ? targetIdx / (numImgs - 1) : 0;
    const targetScrollY = trackTop + targetRatio * totalScrollable;
    if (scrollTo) {
      scrollTo(targetScrollY, { duration: 0.8 });
    } else {
      window.scrollTo({ top: targetScrollY, behavior: 'smooth' });
    }
  };

  // Picking a size shows that size's bottle: the desktop gallery scrolls to it, the phone gallery switches to it.
  const showSizeImage = (sz) => {
    const idx = imageIndexFor(gallery, sz?.variantId);
    if (idx < 0) return;
    if (window.matchMedia('(min-width: 1024px)').matches) handleDotClick(idx);
    else setMobileImgIdx(idx);
  };

  // Mobile horizontal swipe handler (Left & Right swipe)
  const handleMobileSwipe = (e, info) => {
    if (images.length <= 1) return;
    const swipeThreshold = 40;
    const velocityThreshold = 350;

    if (info.offset.x < -swipeThreshold || info.velocity.x < -velocityThreshold) {
      // Swiped Left -> Next image
      setMobileImgIdx((prev) => (prev + 1) % images.length);
    } else if (info.offset.x > swipeThreshold || info.velocity.x > velocityThreshold) {
      // Swiped Right -> Previous image
      setMobileImgIdx((prev) => (prev - 1 + images.length) % images.length);
    }
  };

  // Bottle sizes come straight from the database; sold-out sizes stay visible but cannot be added.
  const sizes = product.sizes;
  const [selectedSize, setSelectedSize] = useState(() => sizes.find((sz) => sz.stock > 0) || sizes[0] || null);
  const [quantity, setQuantity] = useState(1);
  const [openAccordion, setOpenAccordion] = useState(null);
  const maxQty = Math.max(1, Math.min(99, selectedSize?.stock ?? 0));
  const canBuy = !!selectedSize && selectedSize.stock > 0;
  const currentPrice = selectedSize?.price ?? product.price;
  const currentCompare = selectedSize?.compareAt ?? null;

  const etaRange = useSetting('shipping.default_eta', { min: 3, max: 7 });
  const samplesOn = useSetting('samples.enabled', true);
  const mlPerSample = useSetting('samples.ml_per_sample', 50);
  const sampleSize = useSetting('samples.sample_size_ml', 5);
  const etaText = `Delivered across India in ${etaRange.min}–${etaRange.max} days.`;
  const sampleCopy = samplesOn && detail.counts_toward_samples
    ? `Every ${mlPerSample} ml of perfume in your order earns a free ${sampleSize} ml sample of your choice.`
    : null;

  const [recentSlugs, setRecentSlugs] = useState([]);
  useEffect(() => setRecentSlugs(recordView(product.slug).slice(0, 4)), [product.slug]);
  const { products: recentProducts } = useProductsBySlugs(recentSlugs);

  // Sticky mobile add-to-bag bar appears once the main button scrolls away.
  const mobileBuyRef = useRef(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
  useEffect(() => {
    const el = mobileBuyRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setShowStickyBar(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toggleAccordion = (tab) => {
    setOpenAccordion(openAccordion === tab ? null : tab);
  };

  const handleAddToCartClick = () => {
    if (!canBuy || !onAddToCart) return;
    onAddToCart({
      productId: product.id,
      variantId: selectedSize.variantId,
      size: selectedSize.label,
      name: product.name,
      image: flyImageFor(gallery, selectedSize, productPageBlock.set_fly_image),
      price: currentPrice,
      quantity: Math.min(quantity, maxQty)
    });
  };

  const cleanTitle = (product.name || 'Saudagar Extrait')
    .replace(/^saudagar\s+/i, '')
    .toUpperCase();

  const categoryPrefix = (product.category || product.concentration || 'Parfum').split(' ')[0].toUpperCase();
  const accords = detail.attributes?.accord ?? [];
  // Buy box details, all from the product's own data.
  const plainText = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const inspiredLine = (() => {
    const t = plainText(detail.inspiration);
    return t && t.length <= 90 ? t : '';
  })();
  const attr = (kind) => detail.attributes?.[kind]?.[0]?.label ?? null;
  const keyFacts = [
    ['Concentration', attr('concentration')],
    ['Lasts', attr('longevity')],
    ['Projection', attr('sillage')],
    ['Gender', attr('gender')],
  ].filter(([, v]) => v);
  const noteRows = [['Top', detail.notes?.top], ['Heart', detail.notes?.heart], ['Base', detail.notes?.base]]
    .map(([label, list]) => [label, (list ?? []).slice(0, 4).map((n) => n.name).join(', ')])
    .filter(([, v]) => v);
  const perMl = Number(selectedSize?.ml) > 0 ? currentPrice / Number(selectedSize.ml) : null;
  const stockTone = !selectedSize || selectedSize.stock <= 0
    ? { dot: 'bg-[#B42318] dark:bg-red-400', text: 'text-[#8A1C12] dark:text-red-300' }
    : selectedSize.stock <= 5
      ? { dot: 'bg-[#B7791F] dark:bg-amber-400', text: 'text-[#7A4E0E] dark:text-amber-300' }
      : { dot: 'bg-[#2E7D4F] dark:bg-emerald-400', text: 'text-[#1F6B3A] dark:text-emerald-300' };

  // What the product page's CMS sections need (src/storefront/sections/PageSections.jsx).
  const sectionCtx = {
    product: {
      detail, name: product.name, accords, selectedSize, openAccordion, toggleAccordion, sampleCopy, etaText, recentProducts,
      wishlist, onToggleWishlist, onSelectProduct, onQuickBuy,
    },
  };

  // Animations
  const flaconHeroVariants = {
    hidden: { scale: 0.92, y: 32, opacity: 0 },
    visible: {
      scale: 1,
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.65,
        ease: [0.16, 1, 0.3, 1]
      }
    }
  };

  const auraVariants = {
    hidden: { scale: 0.6, opacity: 0 },
    visible: {
      scale: 1,
      opacity: 1,
      transition: {
        duration: 0.8,
        ease: 'easeOut'
      }
    }
  };

  const monographContainerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.055,
        delayChildren: 0.08
      }
    }
  };

  const monographItemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.48,
        ease: [0.16, 1, 0.3, 1]
      }
    }
  };

  // Render monograph details (shared between desktop right column and mobile body)
  const renderMonographDetails = (isMobile = false) => (
    <motion.div
      key={`monograph-${product.id}-${isMobile ? 'm' : 'd'}`}
      variants={monographContainerVariants}
      initial="hidden"
      animate="visible"
      className={`${isMobile ? 'w-full py-4' : 'py-6 max-w-[480px] w-full mx-auto'}`}
    >
      {/* 0. Back and where this product sits in the shop */}
      <motion.nav variants={monographItemVariants} aria-label="Breadcrumb" className="flex items-center gap-3 mb-6 text-[12.5px] min-w-0">
        <button
          type="button"
          onClick={goBack}
          className="hidden lg:inline-flex shrink-0 items-center gap-1.5 h-8 pl-2 pr-3 -ml-2 rounded-[2px] text-tk-ink dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-tk-accent"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          <span>Back</span>
        </button>
        <span className="hidden lg:block h-4 w-px shrink-0 bg-[#DDD6CE] dark:bg-white/15" aria-hidden />
        <ol className="flex items-center gap-1.5 min-w-0 text-[#5C5C5C] dark:text-white/65">
          <li className="shrink-0">
            <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="hover:text-tk-ink dark:hover:text-white hover:underline underline-offset-2">Home</a>
          </li>
          {primaryCategory && (
            <>
              <li aria-hidden className="shrink-0 text-[#A8A29C] dark:text-white/30">/</li>
              <li className="truncate">
                <a href={`/categories/${primaryCategory.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/categories/${primaryCategory.slug}`); }} className="hover:text-tk-ink dark:hover:text-white hover:underline underline-offset-2">
                  {primaryCategory.name}
                </a>
              </li>
            </>
          )}
        </ol>
      </motion.nav>

      {/* 1. Scent family and gender, reviews on the right */}
      <motion.div variants={monographItemVariants} className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {(attr('family') || categoryPrefix) && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-[2px] bg-[#FBF3E4] dark:bg-tk-gold/15 text-tk-accent-ink dark:text-tk-accent-night text-[12px] font-medium tracking-wide border border-tk-accent/25 dark:border-tk-gold/30">
              {attr('family') || categoryPrefix}
            </span>
          )}
          {attr('gender') && <span className="text-[12.5px] text-[#4F4F4F] dark:text-white/70 truncate">{attr('gender')}</span>}
        </div>

        <button
          type="button"
          onClick={() => {
            const el = document.getElementById('reviews-section');
            if (el) {
              if (window.__lenis) {
                window.__lenis.scrollTo(el, { offset: -20 });
              } else {
                el.scrollIntoView({ behavior: 'smooth' });
              }
            }
          }}
          className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-tk-accent-ink dark:text-tk-accent-night hover:underline cursor-pointer select-none"
        >
          {product.reviewsCount > 0 ? (
            <>
              <span className="tracking-tight text-[12px]">★★★★★</span>
              <span className="font-semibold text-tk-ink dark:text-white">{product.rating.toFixed(1)}</span>
              <span className="text-[#5C5C5C] dark:text-white/60">({product.reviewsCount})</span>
            </>
          ) : (
            <span className="text-[#5C5C5C] dark:text-white/60">No reviews yet</span>
          )}
        </button>
      </motion.div>

      {/* 2. Name, what it is inspired by, and the one-line summary */}
      <motion.h1
        variants={monographItemVariants}
        className="font-sans font-normal text-[28px] sm:text-[36px] lg:text-[40px] tracking-[-0.015em] text-tk-ink dark:text-white leading-[1.12]"
      >
        {cleanTitle}
      </motion.h1>
      {inspiredLine && (
        <motion.p variants={monographItemVariants} className="mt-2 text-[13.5px] text-[#4A4A4A] dark:text-white/75">
          {inspiredLine}
        </motion.p>
      )}
      <motion.p
        variants={monographItemVariants}
        className="mt-4 font-sans font-normal text-[14px] leading-[1.7] text-[#333333] dark:text-[#D0D0D0] mb-6"
      >
        {product.description}
      </motion.p>

      {/* 3. Key facts from the scent profile */}
      {keyFacts.length > 0 && (
        <motion.dl variants={monographItemVariants} className="grid grid-cols-2 gap-px mb-6 bg-tk-accent/25 dark:bg-tk-gold/25 border border-tk-accent/25 dark:border-tk-gold/25 rounded-[2px] overflow-hidden">
          {keyFacts.map(([label, value]) => (
            <div key={label} className="bg-white dark:bg-tk-night px-3.5 py-2.5">
              <dt className="text-[11.5px] text-[#666666] dark:text-white/55">{label}</dt>
              <dd className="mt-0.5 text-[13px] text-tk-ink dark:text-white leading-snug">{value}</dd>
            </div>
          ))}
        </motion.dl>
      )}

      {/* 4. Sizes, each with its price */}
      {sizes.length > 0 ? (
        <motion.div variants={monographItemVariants} className="mb-5">
          <p className="text-[12.5px] text-[#4F4F4F] dark:text-white/70 mb-2.5">
            Size: <span className="text-tk-ink dark:text-white font-medium">{selectedSize?.label}</span>
          </p>
          <div className="flex flex-wrap items-stretch gap-2.5">
            {sizes.map((sz) => {
              const isSelected = selectedSize?.variantId === sz.variantId;
              const soldOut = sz.stock <= 0;
              return (
                <button
                  key={sz.variantId}
                  onClick={() => {
                    setSelectedSize(sz);
                    setQuantity(1);
                    showSizeImage(sz);
                  }}
                  aria-pressed={isSelected}
                  aria-label={`${sz.label}, ${formatPrice(sz.price)}${soldOut ? ', sold out' : ''}`}
                  className={`min-w-[96px] px-3.5 py-2 rounded-[2px] text-left transition-all flex flex-col cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tk-accent ${
                    isSelected
                      ? 'bg-tk-ink text-white border border-tk-accent shadow-[0_0_0_1px_rgb(var(--c-accent)/0.35)] dark:bg-tk-gold dark:text-tk-night dark:border-tk-gold dark:shadow-[0_0_0_1px_rgb(var(--c-gold)/0.45)]'
                      : 'bg-white text-tk-ink border border-tk-accent/45 hover:border-tk-accent dark:bg-transparent dark:text-white dark:border-tk-gold/40 dark:hover:border-tk-gold'
                  }`}
                >
                  <span className={`text-[13px] font-medium ${soldOut ? 'line-through opacity-60' : ''}`}>{sz.label}</span>
                  <span className={`text-[12px] ${isSelected ? 'opacity-85' : 'text-[#5C5C5C] dark:text-white/65'}`}>{soldOut ? words.sold_out : formatPrice(sz.price)}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      ) : null}

      {/* 4b. Price with MRP, price per ml and stock */}
      <motion.div variants={monographItemVariants} className="flex items-end justify-between gap-3 mb-5">
        <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
          <span className="text-[26px] font-medium tracking-[-0.01em] text-tk-ink dark:text-white">{formatPrice(currentPrice)}</span>
          {currentCompare && currentCompare > currentPrice && (
            <>
              <span className="text-[14px] line-through text-[#666666] dark:text-white/60">{formatPrice(currentCompare)}</span>
              <span className="px-1.5 py-0.5 rounded-[2px] text-[12px] font-semibold bg-[#E9F5EC] text-[#1F6B3A] dark:bg-emerald-400/15 dark:text-emerald-300">
                {Math.round((1 - currentPrice / currentCompare) * 100)}% off
              </span>
            </>
          )}
          {perMl && <span className="basis-full text-[12px] text-[#5C5C5C] dark:text-white/60">{formatPrice(perMl)} per ml</span>}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-[12.5px] ${stockTone.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${stockTone.dot}`} aria-hidden />
          {!selectedSize ? 'Currently unavailable' : selectedSize.stock <= 0 ? words.sold_out : selectedSize.stock <= 5 ? `Only ${selectedSize.stock} left` : words.in_stock}
        </span>
      </motion.div>

      {/* 5. Tenet Line + Quantity Stepper Row */}
      <motion.div variants={monographItemVariants} className="flex items-center justify-between gap-4 mb-5">
        {claims.length > 0 ? (
          <span className="text-[12.5px] sm:text-[12.5px] text-[#444444] dark:text-[#AAAAAA] font-normal tracking-wide flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-tk-accent dark:bg-tk-accent-night" />
            {claims.map((c, i) => (
              <span key={c} className="contents">
                {i > 0 && <span className="text-tk-accent/60 dark:text-tk-accent-night/60">•</span>}
                <span>{c}</span>
              </span>
            ))}
          </span>
        ) : (
          <span aria-hidden />
        )}

        {/* Stepper Box */}
        <div className="border border-tk-accent/45 dark:border-tk-gold/40 rounded-[2px] h-10 flex items-center px-0.5 bg-white dark:bg-transparent hover:border-tk-accent/40 dark:hover:border-tk-accent-night/40 transition-colors">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="w-8 h-8 flex items-center justify-center text-[15px] text-[#666666] dark:text-white/60 hover:text-tk-accent dark:hover:text-tk-accent-night transition-colors cursor-pointer"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className="w-7 text-center font-medium text-[12.5px] text-tk-ink dark:text-white">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
            className="w-8 h-8 flex items-center justify-center text-[15px] text-[#666666] dark:text-white/60 hover:text-tk-accent dark:hover:text-tk-accent-night transition-colors cursor-pointer"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      </motion.div>

      {selectedSize && selectedSize.stock <= 0 && (
        <motion.div variants={monographItemVariants}>
          <NotifyMe variantId={selectedSize.variantId} label={selectedSize.label} />
        </motion.div>
      )}

      {/* 6. Add To Cart Button + Wishlist Save Bookmark Button */}
      <motion.div ref={isMobile ? mobileBuyRef : undefined} variants={monographItemVariants} className="flex items-center gap-2.5">
        <button
          onClick={handleAddToCartClick}
          disabled={!canBuy}
          className="disabled:opacity-50 disabled:cursor-not-allowed flex-1 h-[46px] bg-tk-ink hover:bg-tk-accent text-white dark:bg-tk-gold dark:hover:bg-tk-accent-night dark:text-tk-night rounded-[2px] flex items-center shadow-[0_4px_16px_rgba(0,0,0,0.18)] hover:shadow-[0_6px_20px_rgba(196,130,63,0.3)] dark:shadow-[0_4px_16px_rgba(212,175,55,0.25)] active:scale-[0.99] transition-all cursor-pointer select-none group font-medium"
        >
          <span className="flex-1 text-center text-[12.5px] font-medium tracking-[0.03em]">
            {canBuy ? words.add_to_bag : words.sold_out}
          </span>
          <span className="w-[1px] h-[20px] bg-white/20 dark:bg-black/20 shrink-0" />
          <span className="px-4 sm:px-5 text-center text-[12.5px] font-medium tracking-[0.02em] whitespace-nowrap text-[#FFF7ED] dark:text-tk-night">
            {formatPrice(currentPrice * Math.min(quantity, maxQty))}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onToggleWishlist && onToggleWishlist(product.id)}
          className={`w-[46px] h-[46px] shrink-0 rounded-[2px] border transition-all duration-300 flex items-center justify-center cursor-pointer ${
            isCurrentWishlisted
              ? 'border-tk-accent bg-[#FFF7ED] text-tk-accent dark:border-tk-accent-night dark:bg-tk-gold/15 dark:text-tk-accent-night shadow-xs'
              : 'border-tk-accent/45 dark:border-tk-gold/40 bg-white dark:bg-transparent text-[#5F5F5F] dark:text-white/60 hover:border-tk-accent hover:text-tk-accent dark:hover:border-tk-accent-night dark:hover:text-tk-accent-night'
          }`}
          title={isCurrentWishlisted ? 'Remove from saved wishlist' : 'Save to private wishlist'}
          aria-label="Wishlist"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill={isCurrentWishlisted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </motion.div>

      {/* 6b. The notes at a glance (the full pyramid is further down) */}
      {noteRows.length > 0 && (
        <motion.dl variants={monographItemVariants} className="mt-6 space-y-1.5 text-[12.5px]">
          {noteRows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[52px_1fr] gap-2">
              <dt className="text-[#666666] dark:text-white/55">{label}</dt>
              <dd className="text-[#2B2B2B] dark:text-white/85">{value}</dd>
            </div>
          ))}
        </motion.dl>
      )}

      {/* 7. Delivery & Trust Micro-lines */}
      <motion.div
        variants={monographItemVariants}
        className="mt-5 pt-4 border-t border-tk-accent/25 dark:border-tk-gold/25 space-y-2 text-[12.5px] text-[#4F4F4F] dark:text-[#A8A8A8] leading-relaxed"
      >
        <div className="flex items-start gap-2.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-[3px] shrink-0 text-tk-accent-ink dark:text-tk-accent-night" aria-hidden>
            <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <span>{etaText}</span>
        </div>
        {sampleCopy && (
          <div className="flex items-start gap-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-[3px] shrink-0 text-tk-accent-ink dark:text-tk-accent-night" aria-hidden>
              <polyline points="20 12 20 22 4 22 4 12" />
              <rect x="2" y="7" width="20" height="5" />
              <line x1="12" y1="22" x2="12" y2="7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
            <span>{sampleCopy}</span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  return (
    <div className="w-full bg-[#FFFFFF] dark:bg-tk-night text-tk-ink dark:text-white transition-colors duration-300 flex flex-col font-sans select-none">
      
      {/* ============================================================== */}
      {/* ================= 1. DESKTOP VIEW (>= lg) =================== */}
      {/* ============================================================== */}
      <div
        ref={trackRef}
        className="hidden lg:block relative w-full"
        style={{ height: `${Math.max(1, images.length) * 100}vh` }}
      >
        {/* Sticky 100vh Split-Screen Viewport */}
        <div
          className="sticky w-full overflow-hidden grid grid-cols-2 z-10"
          style={{ top: 'var(--site-header-h, 68px)', height: 'calc(100vh - var(--site-header-h, 68px))' }}
        >
          
          {/* Left Half: Pedestal with Parallax Vertical Images */}
          <div className="bg-[#F8F8F8] dark:bg-[#141318] border-r border-tk-accent/25 dark:border-tk-gold/25 h-full relative overflow-hidden flex flex-col justify-between transition-colors duration-300">
            
            {/* Vertical Animated Flacon Stack (Driven by Desktop Scroll) */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
              <motion.div
                style={{ y: yTransform }}
                className="w-full h-full flex flex-col will-change-transform"
              >
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className="w-full h-full shrink-0 flex items-center justify-center px-8 sm:px-14 pt-8 pb-16 relative"
                  >
                    <motion.div
                      key={`${product.id}-${idx}`}
                      variants={idx === 0 ? flaconHeroVariants : undefined}
                      initial={idx === 0 ? "hidden" : undefined}
                      animate={idx === 0 ? "visible" : undefined}
                      className="relative w-full max-w-[380px] aspect-[4/5] flex items-center justify-center"
                    >
                      {/* Warm glow behind every bottle (it fades in with the first one) */}
                      <motion.div
                        variants={auraVariants}
                        initial={idx === 0 ? 'hidden' : false}
                        animate="visible"
                        className="absolute w-64 h-64 rounded-full bg-amber-400/15 dark:bg-tk-accent-night/12 blur-3xl pointer-events-none"
                      />
                      <img
                        src={img}
                        alt={`${product.name} perspective ${idx + 1}`}
                        fetchPriority={idx === 0 ? "high" : "auto"}
                        loading={idx === 0 ? "eager" : "lazy"}
                        decoding="async"
                        className="relative z-10 max-h-[58vh] w-auto object-contain object-center filter drop-shadow-[0_20px_35px_rgba(0,0,0,0.14)]"
                      />
                    </motion.div>
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Pinned Bottom Dots Indicator */}
            {images.length > 1 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: 0.3 }}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center select-none pointer-events-auto"
              >
                {images.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleDotClick(idx)}
                    className="group/dot h-8 px-2.5 flex items-center cursor-pointer"
                    aria-label={`View photo ${idx + 1}`}
                    aria-current={activeImgIdx === idx ? 'true' : undefined}
                  >
                    <span
                      className={`block h-1.5 rounded-full transition-all ${
                        activeImgIdx === idx
                          ? 'w-6 bg-tk-accent dark:bg-tk-accent-night'
                          : 'w-1.5 bg-[#C9BFC1] dark:bg-white/40 group-hover/dot:bg-[#6B6B6B]'
                      }`}
                    />
                  </button>
                ))}
              </motion.div>
            )}
          </div>

          {/* Right Half: Editorial Details (Pinned with internal scroll) */}
          <div className="bg-[#FFFFFF] dark:bg-tk-night h-full flex flex-col p-10 xl:p-14 transition-colors duration-300 overflow-y-auto">
            
            {/* Buy box, centred in the space beside the bottle */}
            <div className="my-auto w-full">{renderMonographDetails(false)}</div>
          </div>

        </div>
      </div>

      {/* ============================================================== */}
      {/* ================= 2. MOBILE VIEW (< lg) ====================== */}
      {/* ============================================================== */}
      <div className="block lg:hidden w-full">
        
        {/* Mobile Dedicated Flacon Vitrine (NEVER CROPPED, Full Bottle Visible) */}
        <div className="relative w-full h-[46vh] min-h-[350px] max-h-[440px] bg-[#F8F8F8] dark:bg-[#141318] flex items-center justify-center overflow-hidden border-b border-tk-accent/25 dark:border-tk-gold/25 select-none">
          {/* Ambient Warm Studio Aura */}
          <div className="absolute w-56 h-56 rounded-full bg-amber-400/15 dark:bg-tk-accent-night/12 blur-3xl pointer-events-none" />

          {/* Back, on phones (desktop has it beside the breadcrumb) */}
          <button
            type="button"
            onClick={goBack}
            className="absolute top-3 left-3 z-30 h-9 pl-2 pr-3 inline-flex items-center gap-1 rounded-[2px] bg-white/90 dark:bg-black/60 text-tk-ink dark:text-white text-[12.5px] shadow-xs backdrop-blur-xs cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
            <span>Back</span>
          </button>

          {/* Swipeable Flacon Image Container with Horizontal Left/Right Drag */}
          <div className="relative w-full h-full flex items-center justify-center p-6 touch-pan-y">
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={`${product.id}-${mobileImgIdx}`}
                drag={images.length > 1 ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.22}
                onDragEnd={handleMobileSwipe}
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
              >
                <img
                  src={images[mobileImgIdx]}
                  alt={`${product.name} perspective ${mobileImgIdx + 1}`}
                  fetchPriority="high"
                  loading="eager"
                  decoding="async"
                  className="max-h-[300px] sm:max-h-[340px] max-w-[80%] w-auto h-auto object-contain object-center filter drop-shadow-[0_16px_30px_rgba(0,0,0,0.12)] pointer-events-none"
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Left & Right Subtle Chevron Controls (Tap to change) */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setMobileImgIdx((prev) => (prev - 1 + images.length) % images.length)}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-[2px] bg-white/90 dark:bg-black/60 text-tk-ink dark:text-white flex items-center justify-center text-xs backdrop-blur-xs shadow-xs hover:bg-white dark:hover:bg-black transition-colors cursor-pointer"
                aria-label="Previous view angle"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setMobileImgIdx((prev) => (prev + 1) % images.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-[2px] bg-white/90 dark:bg-black/60 text-tk-ink dark:text-white flex items-center justify-center text-xs backdrop-blur-xs shadow-xs hover:bg-white dark:hover:bg-black transition-colors cursor-pointer"
                aria-label="Next view angle"
              >
                ›
              </button>
            </>
          )}

          {/* Swipe Helper & Angle Dots Indicator */}
          {images.length > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center select-none pointer-events-auto">
              {images.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setMobileImgIdx(idx)}
                  className="h-8 px-2.5 flex items-center cursor-pointer"
                  aria-label={`View photo ${idx + 1}`}
                  aria-current={mobileImgIdx === idx ? 'true' : undefined}
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all ${
                      mobileImgIdx === idx ? 'w-6 bg-tk-accent dark:bg-tk-accent-night' : 'w-1.5 bg-[#C9BFC1] dark:bg-white/40'
                    }`}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mobile Monograph Details Section */}
        <div className="w-full px-5 sm:px-8 py-6 bg-white dark:bg-tk-night transition-colors">
          {renderMonographDetails(true)}
        </div>

      </div>

      {/* ================= 3. EVERYTHING BELOW: Admin → Pages → Product page ================= */}
      <SectionContext.Provider value={sectionCtx}>
        <CmsSections slug="product-page" fallback={PRODUCT_PAGE_DEFAULT} />
      </SectionContext.Provider>

      {/* Sticky mobile add-to-bag bar */}
      <AnimatePresence>
        {showStickyBar && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="lg:hidden fixed left-0 right-0 bottom-[64px] z-30 px-4 py-2.5 bg-white/95 dark:bg-[#0E0C10]/95 backdrop-blur-md border-t border-tk-accent/25 dark:border-tk-gold/25 flex items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-tk-ink dark:text-white truncate">{cleanTitle}</p>
              <p className="text-[12px] text-[#5F5F5F] dark:text-[#999999]">{selectedSize?.label} · {formatPrice(currentPrice)}</p>
            </div>
            <button
              type="button"
              onClick={handleAddToCartClick}
              disabled={!canBuy}
              className="shrink-0 h-10 px-5 bg-tk-ink hover:bg-tk-accent text-white dark:bg-tk-gold dark:text-tk-night text-[12.5px] font-medium rounded-[2px] disabled:opacity-50"
            >
              {canBuy ? words.add_to_bag : words.sold_out}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
