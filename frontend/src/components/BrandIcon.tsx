import { useState } from 'react';
import { brandDomain } from '../lib/brands.ts';

interface BrandIconProps {
  /** Raw brand value (e.g. "Nike", "Coca-Cola"). */
  brand: string;
  className?: string;
}

/** Deterministic chip background from the brand name — no Math.random so the
 *  same brand always gets the same color across renders/rows. */
const CHIP_COLORS = [
  '#E05A00', '#1DA1F2', '#C13584', '#4285F4', '#E03030',
  '#0F9D58', '#9C27B0', '#FB8C00', '#00897B', '#5C6BC0',
];

function chipColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return CHIP_COLORS[Math.abs(h) % CHIP_COLORS.length];
}

function InitialChip({ brand, className }: BrandIconProps) {
  const letter = brand.trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className={`flex items-center justify-center rounded-sm text-white font-semibold leading-none ${className ?? ''}`}
      style={{ backgroundColor: chipColor(brand), fontSize: '0.6em' }}
      aria-hidden
    >
      {letter}
    </div>
  );
}

/**
 * Brand logo for table dimension cells. Resolves a curated brand -> domain
 * (see lib/brands.ts) and renders the domain's favicon via Google's favicon
 * service (logo.dev). Falls back to a colored initial chip when the brand is
 * uncovered, the token is unset, or the logo fails to load — so it never
 * renders blank.
 */

// logo.dev publishable token (pk_...). Safe to expose client-side — it's a
// browser-scoped publishable key. Set VITE_LOGODEV_TOKEN in the env to enable
// real brand logos; without it, brands render as initial chips.
const LOGODEV_TOKEN = import.meta.env.VITE_LOGODEV_TOKEN as string | undefined;

export function BrandIcon({ brand, className }: BrandIconProps) {
  const [failed, setFailed] = useState(false);
  const domain = brandDomain(brand);

  if (!domain || !LOGODEV_TOKEN || failed) {
    return <InitialChip brand={brand} className={className} />;
  }

  // size 64 covers retina at our 14px render; format=png for transparent bg.
  return (
    <img
      src={`https://img.logo.dev/${domain}?token=${LOGODEV_TOKEN}&size=64&format=png&retina=true`}
      alt=""
      className={`rounded-sm object-contain ${className ?? ''}`}
      loading="lazy"
      onError={() => setFailed(true)}
      aria-hidden
    />
  );
}
