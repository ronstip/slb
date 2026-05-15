// Scolto brand logo — the single source of truth for the app's logo and
// wordmark. Update the constants below to change the brand everywhere.
//
// Mark: four corner brackets framing a solid orange dot.
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

// Mark px, wordmark px, gap px — chosen to match the visual mass of the
// previous logo at each size step.
const SIZES: Record<NonNullable<LogoProps['size']>, { mark: number; text: number; gap: number }> = {
  sm: { mark: 22, text: 16, gap: 6 },
  md: { mark: 28, text: 20, gap: 8 },
  lg: { mark: 38, text: 28, gap: 10 },
};

export function ScoltoMark({ size = 28 }: { size?: number }) {
  // Stroke width scales with size so the brackets stay crisp at small sizes.
  const sw = Math.max(1.4, 2 * (size / 32));
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-label={BRAND_NAME}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M4 18 V4 H18" />
      <path d="M46 4 H60 V18" />
      <path d="M60 46 V60 H46" />
      <path d="M18 60 H4 V46" />
      <circle cx="32" cy="32" r="7" fill={BRAND_DOT_COLOR} stroke="none" />
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
            letterSpacing: -0.6,
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
