// Scolto brand logo — the single source of truth for the app's logo and
// wordmark. Update the constants below to change the brand everywhere.
//
// Mark: four corner brackets in a phone-rect (9:16-ish) frame, around a
// solid orange dot. Brackets stay the same physical size as the square
// variant; only the frame narrows.
// Wordmark: "Scolto" set in Fraunces italic (loaded in index.html).

export const BRAND_NAME = 'Scolto';
const BRAND_DOT_COLOR = '#D97757'; // matches LP_BRAND.orange on the landing page

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
  /** Kept for API compatibility with the previous logo; currently a no-op. */
  flat?: boolean;
}

// Mark height px, wordmark px, gap px. Ratios match the brand standalone:
// font-size ≈ mark-height × 1.31 (so the cap-height of "S" reads at the
// mark's height), gap ≈ mark-height × 0.375.
const SIZES: Record<NonNullable<LogoProps['size']>, { mark: number; text: number; gap: number }> = {
  sm: { mark: 22, text: 28, gap: 8 },
  md: { mark: 28, text: 36, gap: 10 },
  lg: { mark: 38, text: 50, gap: 14 },
};

export function ScoltoMark({ size = 28 }: { size?: number }) {
  // size = height of the mark; width narrows to a phone-rect (36:64) proportion.
  const height = size;
  const width = size * (36 / 64);
  // Stroke width matches the brand standalone (2 viewBox units in a 64-tall
  // mark) with a floor so brackets read at the same absolute thickness as the
  // reference even when the mark is displayed smaller than 64px.
  const sw = Math.max(2, size / 32);
  const half = sw / 2;
  // Each bracket is a 14×14 L flush with a corner: arm length 14, anchored
  // via miter joins so the outer corner of the stroke sits exactly on the
  // viewBox edge (matching how the standalone draws brackets with CSS
  // borders along the box edges).
  return (
    <svg
      viewBox="0 0 36 64"
      width={width}
      height={height}
      aria-label={BRAND_NAME}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d={`M${half} 14 V${half} H14`} />
      <path d={`M22 ${half} H${36 - half} V14`} />
      <path d={`M${36 - half} 50 V${64 - half} H22`} />
      <path d={`M14 ${64 - half} H${half} V50`} />
      <circle cx="18" cy="32" r="7" fill={BRAND_DOT_COLOR} stroke="none" />
    </svg>
  );
}

export function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  const { mark, text, gap } = SIZES[size];
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap, lineHeight: 1 }}
    >
      <ScoltoMark size={mark} />
      {showText && (
        <span
          style={{
            fontFamily: "'Fraunces', serif",
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: text,
            letterSpacing: '-0.026em',
            lineHeight: 1,
            color: 'currentColor',
            display: 'inline-flex',
            alignItems: 'baseline',
          }}
        >
          {BRAND_NAME}
        </span>
      )}
    </span>
  );
}
