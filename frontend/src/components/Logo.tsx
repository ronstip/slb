import { AnimatedLogo } from './BrandElements.tsx';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
  flat?: boolean;
}

const TEXT_SIZE: Record<NonNullable<LogoProps['size']>, string> = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-xl',
};

export function Logo({ size = 'md', showText = true, className = '', flat = false }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <AnimatedLogo size={size} flat={flat} />
      {showText && (
        <span className={`font-heading font-semibold tracking-wide ${TEXT_SIZE[size]}`}>
          Veille
        </span>
      )}
    </div>
  );
}
