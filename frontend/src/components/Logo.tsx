import { AnimatedLogo } from './BrandElements.tsx';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const TEXT_SIZE: Record<NonNullable<LogoProps['size']>, string> = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-xl',
};

export function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <AnimatedLogo size={size} />
      {showText && (
        <span className={`font-heading font-semibold tracking-wide ${TEXT_SIZE[size]}`}>
          Veille
        </span>
      )}
    </div>
  );
}
