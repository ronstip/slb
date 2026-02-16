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
        <svg viewBox="0 0 40 40" className={dim.svg}>
          {/* Outer wave rings (social listening) */}
          <circle cx="20" cy="20" r="18" className={inverted ? 'fill-none stroke-white/15' : 'fill-none stroke-primary/10'} strokeWidth="1.5" />
          <circle cx="20" cy="20" r="14" className={inverted ? 'fill-none stroke-white/25' : 'fill-none stroke-primary/20'} strokeWidth="1.5" />
          <circle cx="20" cy="20" r="10" className={inverted ? 'fill-none stroke-white/35' : 'fill-none stroke-primary/30'} strokeWidth="1.5" />

          {/* Center node (represents social network hub) */}
          <circle cx="20" cy="20" r="6" className={inverted ? 'fill-white' : 'fill-primary'} />

          {/* Small satellite nodes (social connections) */}
          <circle cx="28" cy="12" r="2" className="fill-chart-5" />
          <circle cx="32" cy="24" r="2" className="fill-chart-2" />
          <circle cx="12" cy="28" r="2" className="fill-chart-4" />

          {/* Connection lines */}
          <line x1="20" y1="20" x2="28" y2="12" className={inverted ? 'stroke-white/30' : 'stroke-primary/30'} strokeWidth="1" />
          <line x1="20" y1="20" x2="32" y2="24" className={inverted ? 'stroke-white/30' : 'stroke-primary/30'} strokeWidth="1" />
          <line x1="20" y1="20" x2="12" y2="28" className={inverted ? 'stroke-white/30' : 'stroke-primary/30'} strokeWidth="1" />
        </svg>
      </div>
      {showText && (
        <span className={`font-semibold ${dim.text} ${inverted ? 'text-white' : ''}`}>InsightStream</span>
      )}
    </div>
  );
}
