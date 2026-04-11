interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  inverted?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, inverted = false, className = '' }: LogoProps) {
  const dimensions = {
    sm: { container: 'h-7 w-7', svg: 'h-7 w-7', text: 'text-sm' },
    md: { container: 'h-10 w-10', svg: 'h-10 w-10', text: 'text-xl' },
    lg: { container: 'h-12 w-12', svg: 'h-12 w-12', text: 'text-2xl' },
  };

  const dim = dimensions[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className={`relative flex items-center justify-center ${dim.container}`}>
        <svg viewBox="0 0 200 180" className={dim.svg}>
          <defs>
            <linearGradient id="vGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              {inverted ? (
                <>
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.8" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#a855f7" />
                  <stop offset="100%" stopColor="#7f22fe" />
                </>
              )}
            </linearGradient>
          </defs>
          <path
            d="M 60 40 L 100 140 L 140 40"
            stroke="url(#vGradient)"
            strokeWidth="30"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
      {showText && (
        <span className={`font-semibold ${dim.text} ${inverted ? 'text-white' : ''}`}>Veille</span>
      )}
    </div>
  );
}
