import { useMemo } from 'react';
import { motion } from 'motion/react';

/**
 * Seed-based animated bot avatar — unique color + eye style per agent.
 */
export function BotAvatar({ seed, size = 48, className = '' }: { seed: string; size?: number; className?: string }) {
  const { hue, eyeShape, eyeColor, mainColor } = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return {
      hue: h,
      eyeShape: Math.abs(hash) % 4,
      eyeColor: `hsl(${(h + 120) % 360}, 90%, 75%)`,
      mainColor: `hsl(${h}, 80%, 65%)`,
    };
  }, [seed]);

  const eyeSize = Math.max(4, Math.round(size * 0.14));
  const visorW = Math.round(size * 0.7);
  const visorH = Math.round(size * 0.35);

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-xl shadow-inner ${className}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue}, 70%, 32%), hsl(${hue}, 60%, 18%))` }}
    >
      <motion.div
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="relative flex flex-col items-center justify-center"
      >
        <div style={{ width: 2, height: Math.round(size * 0.2), backgroundColor: mainColor, borderRadius: 1 }} />
        <div style={{ width: 6, height: 6, borderRadius: '50%', marginTop: -2, backgroundColor: eyeColor, boxShadow: `0 0 6px ${eyeColor}` }} />
        <div
          className="mt-0.5 flex items-center justify-center gap-1 rounded-md border border-white/25 bg-black/55"
          style={{ width: visorW, height: visorH, padding: '0 3px' }}
        >
          {eyeShape === 0 && (
            <>
              <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }} style={{ width: eyeSize, height: eyeSize, borderRadius: '50%', backgroundColor: eyeColor, boxShadow: `0 0 6px ${eyeColor}`, flexShrink: 0 }} />
              <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity, delay: 0.25 }} style={{ width: eyeSize, height: eyeSize, borderRadius: '50%', backgroundColor: eyeColor, boxShadow: `0 0 6px ${eyeColor}`, flexShrink: 0 }} />
            </>
          )}
          {eyeShape === 1 && (
            <motion.div animate={{ scaleX: [1, 1.2, 1] }} transition={{ duration: 3, repeat: Infinity }} style={{ width: Math.round(visorW * 0.55), height: 3, borderRadius: 2, backgroundColor: eyeColor, boxShadow: `0 0 6px ${eyeColor}` }} />
          )}
          {eyeShape === 2 && (
            <>
              <div style={{ width: eyeSize, height: eyeSize, borderRadius: 2, backgroundColor: eyeColor, boxShadow: `0 0 6px ${eyeColor}`, flexShrink: 0 }} />
              <div style={{ width: eyeSize, height: eyeSize, borderRadius: 2, backgroundColor: eyeColor, boxShadow: `0 0 6px ${eyeColor}`, flexShrink: 0 }} />
            </>
          )}
          {eyeShape === 3 && (
            <motion.div
              animate={{ x: [-(eyeSize * 0.8), eyeSize * 0.8, -(eyeSize * 0.8)] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              style={{ width: eyeSize + 4, height: eyeSize + 4, borderRadius: '50%', backgroundColor: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Pulsing green dot — signals an "active"/"running" state.
 * Size: 12px outer hit area, 8px inner dot.
 */
export function RadarPulse() {
  return (
    <div className="relative flex h-3 w-3 items-center justify-center">
      <motion.div
        className="absolute h-full w-full rounded-full bg-emerald-400"
        animate={{ scale: [1, 2], opacity: [0.6, 0] }}
        transition={{
          duration: 2.8,
          repeat: Infinity,
          scale: { ease: 'easeOut' },
          opacity: { ease: 'linear' },
        }}
      />
      <div className="relative h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
    </div>
  );
}

/**
 * Decorative static grid background for hero sections.
 * Position absolutely; parent needs `position: relative`.
 */
export function GeometricMesh() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.07]">
      <svg className="absolute h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="brand-mesh-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.75"
              className="text-primary"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#brand-mesh-grid)" />
      </svg>
    </div>
  );
}

/**
 * Brand mark: purple rounded square with a swirling sonar sweep behind a white "V".
 * Sizes match the Logo component's sm/md/lg scale.
 */
export function AnimatedLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dimensions = {
    sm: { box: 'h-7 w-7 rounded-md', sweep: 'h-14 w-14', text: 'text-sm' },
    md: { box: 'h-8 w-8 rounded-lg', sweep: 'h-16 w-16', text: 'text-lg' },
    lg: { box: 'h-10 w-10 rounded-lg', sweep: 'h-20 w-20', text: 'text-xl' },
  }[size];

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-primary shadow-[0_0_15px_rgba(110,86,207,0.5)] ${dimensions.box}`}
    >
      <motion.div
        className={`absolute bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.4)_45deg,transparent_90deg)] ${dimensions.sweep}`}
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
      />
      <span
        className={`relative z-10 font-heading font-bold leading-none text-white ${dimensions.text}`}
      >
        V
      </span>
    </div>
  );
}
