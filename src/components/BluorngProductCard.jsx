import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatINR as formatPrice } from '../lib/money';

export default function BluorngProductCard({
  product,
  isWishlisted = false,
  onToggleWishlist,
  onSelectProduct,
  onQuickBuy
}) {
  const [currentImgIdx, setCurrentImgIdx] = useState(0);

  const images = product.images && product.images.length > 0
    ? product.images
    : [product.image || '/images/crystal_square_flacon.png'];

  const hasDiscount = product.compareAtPrice && product.compareAtPrice > product.price;
  const discountPct = hasDiscount ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;
  // "30 / 50 / 100 ml" for perfumes; sets and combos have no ml sizes.
  const mlSizes = [...new Set((product.sizes || []).map((s) => Number(s.ml)).filter((n) => n > 0))].sort((a, b) => a - b);
  const sizeLine = mlSizes.length ? `${mlSizes.join(' / ')} ml` : '';
  const prices = (product.sizes || []).map((s) => Number(s.price)).filter((n) => n > 0);
  const fromPrice = prices.length > 1 && Math.max(...prices) > Math.min(...prices);
  const soldOut = product.sizes?.length > 0 && product.sizes.every((s) => s.stock <= 0);

  const handleNextImage = (e) => {
    e.stopPropagation();
    setCurrentImgIdx((prev) => (prev + 1) % images.length);
  };

  const handlePrevImage = (e) => {
    e.stopPropagation();
    setCurrentImgIdx((prev) => (prev - 1 + images.length) % images.length);
  };

  const handleCardClick = () => {
    onSelectProduct && onSelectProduct(product.id);
  };

  const handleMouseEnter = () => {
    // Prefetch product images on hover for instant opening
    images.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  };

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleCardClick();
        }
      }}
      onMouseEnter={handleMouseEnter}
      role="link"
      tabIndex={0}
      aria-label={product.name}
      className="group relative flex flex-col cursor-pointer transition-all duration-300 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-tk-accent"
    >
      {/* ================= SOFT PEDESTAL FLACON STAGE (No harsh borders) ================= */}
      <div className="relative w-full aspect-[4/5] rounded-[2px] flex items-center justify-center p-4 sm:p-5 overflow-hidden transition-all duration-500 select-none bg-[#F8F7F5] dark:bg-[#141318] group-hover:bg-[#F2EFEA] dark:group-hover:bg-[#1C1A22] border border-tk-accent/20 dark:border-tk-gold/20 group-hover:border-tk-accent/60 dark:group-hover:border-tk-gold/55">
        {/* Soft Pedestal Ground Shadow */}
        <div className="absolute bottom-4 w-3/5 h-2.5 rounded-[100%] blur-[5px] transition-all duration-500 pointer-events-none z-0 bg-black/[0.06] dark:bg-black/40 group-hover:scale-110 group-hover:opacity-60" />

        {/* Flacon Image with Gentle Scale on Hover */}
        <AnimatePresence mode="wait">
          <motion.img
            key={images[currentImgIdx]}
            src={images[currentImgIdx]}
            alt={product.name}
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0.9 }}
            transition={{ duration: 0.25 }}
            className="relative z-10 w-full h-full object-contain object-center group-hover:scale-105 transition-transform duration-700 ease-out filter drop-shadow-[0_8px_18px_rgba(0,0,0,0.12)]"
            loading="lazy"
          />
        </AnimatePresence>

        {/* Minimal Discrete Badge (Top-Left) */}
        {product.badge && (
          <span className="absolute top-2.5 left-2.5 z-20 max-w-[calc(100%-3.75rem)] truncate px-2 py-0.5 text-[11.5px] uppercase tracking-wider font-medium rounded-[2px] bg-black/5 dark:bg-white/10 text-[#555555] dark:text-white/90">
            {product.badge}
          </span>
        )}

        {/* Wishlist Button (Top-Right) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleWishlist && onToggleWishlist(product.id);
          }}
          className="absolute top-2 right-2 z-20 w-8 h-8 rounded-[2px] flex items-center justify-center transition-all duration-200 cursor-pointer bg-white/85 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 text-tk-ink dark:text-white"
          title={isWishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          aria-label={isWishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          aria-pressed={isWishlisted}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            className={isWishlisted ? 'text-tk-accent-ink dark:text-tk-accent-night' : 'text-tk-ink dark:text-white'}
            fill={isWishlisted ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Gallery Slider Controls (hover-only if multiple images) */}
        {images.length > 1 && (
          <>
            <button
              onClick={handlePrevImage}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-[2px] bg-white/90 dark:bg-black/75 text-tk-ink dark:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm text-xs cursor-pointer"
              aria-label="Previous photo"
            >
              ‹
            </button>
            <button
              onClick={handleNextImage}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-[2px] bg-white/90 dark:bg-black/75 text-tk-ink dark:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm text-xs cursor-pointer"
              aria-label="Next photo"
            >
              ›
            </button>
          </>
        )}

        {/* Discount, top-left under the badge */}
        {hasDiscount && (
          <span className={`absolute left-2.5 z-20 px-1.5 py-0.5 text-[11.5px] font-semibold rounded-[2px] bg-[#1F6B3A] text-white dark:bg-emerald-400 dark:text-[#062814] ${product.badge ? 'top-9' : 'top-2.5'}`}>
            {discountPct}% off
          </span>
        )}

        {soldOut && (
          <span className="absolute inset-x-2.5 bottom-2.5 z-20 py-1.5 text-center text-[12px] rounded-[2px] bg-white/90 text-[#5C5C5C] dark:bg-black/70 dark:text-white/80">
            Sold out
          </span>
        )}

        {/* Quick add: a full button on hover (desktop), a small always-visible button on touch screens */}
        {!soldOut && (
          <>
            <div className="hidden lg:block absolute bottom-2.5 left-2.5 right-2.5 z-20 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-300">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickBuy && onQuickBuy(product);
                }}
                className="w-full py-2.5 text-[12.5px] font-medium rounded-[2px] shadow-md transition-colors cursor-pointer bg-tk-ink text-white hover:bg-tk-accent dark:bg-tk-gold dark:text-tk-night dark:hover:bg-tk-accent-night"
              >
                Add to bag
              </button>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQuickBuy && onQuickBuy(product);
              }}
              className="lg:hidden absolute bottom-2 right-2 z-20 w-9 h-9 rounded-[2px] flex items-center justify-center shadow-sm cursor-pointer bg-tk-ink text-white dark:bg-tk-gold dark:text-tk-night"
              aria-label={`Add ${product.name} to bag`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M6 7h12l-1 13H7L6 7z" />
                <path d="M9 7a3 3 0 0 1 6 0" />
                <path d="M12 11v5M9.5 13.5h5" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Category, name, sizes, then price */}
      <div className="pt-3 pb-1 flex flex-col">
        {product.category && (
          <p className="text-[12px] tracking-wide truncate text-[#666666] dark:text-white/60">{product.category}</p>
        )}
        <h3 className="mt-0.5 text-[14px] sm:text-[14.5px] leading-[1.35] min-h-[2.7em] font-medium line-clamp-2 transition-colors text-tk-ink dark:text-white group-hover:text-tk-accent-ink dark:group-hover:text-tk-accent-night">
          {product.name}
        </h3>
        {sizeLine && <p className="mt-0.5 text-[12px] text-[#5C5C5C] dark:text-white/60">{sizeLine}</p>}
        <div className="mt-2 flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
          <span className="text-[14px] sm:text-[15px] font-semibold text-tk-ink dark:text-white">
            {fromPrice && <span className="text-[12px] font-normal text-[#5C5C5C] dark:text-white/60 mr-1">From</span>}
            {formatPrice(product.price)}
          </span>
          {hasDiscount && <span className="text-[12px] line-through text-[#6B6B6B] dark:text-white/55">{formatPrice(product.compareAtPrice)}</span>}
        </div>
      </div>
    </div>
  );
}
