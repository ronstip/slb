// Scolto brand logo - the single source of truth for the app's logo and
// wordmark. Update the constants below to change the brand everywhere.
//
// Mark: four corner brackets in a square frame, around a solid orange dot.
// Wordmark: "Scolto" set in Fraunces italic (loaded in index.html).

export const BRAND_NAME = 'Scolto';
const BRAND_DOT_COLOR = '#D97757'; // matches LP_BRAND.orange on the landing page
// Brand ink - dark navy used for the wordmark + headings on light surfaces.
// Mirrors LP_BRAND.ink on the landing page; single source of truth for both.
export const BRAND_INK = '#0F1F4D';

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

// viewBox dimensions for the mark. Square 64x64 so the brackets sit at the
// corners of a perfect square frame.
const MARK_W = 64;
const MARK_H = 64;
const BRACKET_ARM = 14;

export function ScoltoMark({ size = 28 }: { size?: number }) {
  // size = height of the mark; width follows MARK_W / MARK_H.
  const height = size;
  const width = size * (MARK_W / MARK_H);
  // Stroke width: floor keeps brackets readable at small sizes; scales with
  // mark height above the floor.
  const sw = Math.max(3, size / 22);
  const armRight = MARK_W - BRACKET_ARM; // x where right-side brackets begin
  const armBottom = MARK_H - BRACKET_ARM; // y where bottom brackets begin
  return (
    <svg
      // viewBox padded by 1 unit on every side so bracket strokes (which sit
      // at the original 0/MARK_W/MARK_H edges) are fully inside the viewport
      // and don't get asymmetrically clipped or anti-aliased - that's what
      // made the left brackets look heavier than the right.
      viewBox={`-1 -1 ${MARK_W + 2} ${MARK_H + 2}`}
      width={width}
      height={height}
      aria-label={BRAND_NAME}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
    >
      <path d={`M0 ${BRACKET_ARM} V0 H${BRACKET_ARM}`} />
      <path d={`M${armRight} 0 H${MARK_W} V${BRACKET_ARM}`} />
      <path d={`M${MARK_W} ${armBottom} V${MARK_H} H${armRight}`} />
      <path d={`M${BRACKET_ARM} ${MARK_H} H0 V${armBottom}`} />
      <circle cx={MARK_W / 2} cy={MARK_H / 2} r="7" fill={BRAND_DOT_COLOR} stroke="none" />
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
