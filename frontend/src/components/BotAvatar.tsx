import { useMemo } from 'react';
import { motion } from 'motion/react';

interface BotAvatarProps {
  seed: string;
  size?: number;
  className?: string;
}

/**
 * Deterministic animated bot avatar keyed on `seed` (usually an agent_id).
 * Same seed -> same colors + eye shape, so each agent gets a stable identity.
 */
export function BotAvatar({ seed, size = 48, className = '' }: BotAvatarProps) {
  const { hue, secondaryHue, eyeShape, scale } = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return {
      hue: h,
      secondaryHue: (h + 120) % 360,
      eyeShape: Math.abs(hash) % 4,
      scale: 0.8 + (Math.abs(hash) % 20) / 100,
    };
  }, [seed]);

  const mainColor = `hsl(${hue}, 80%, 65%)`;
  const eyeColor = `hsl(${secondaryHue}, 90%, 75%)`;

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-xl shadow-inner ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue}, 40%, 20%), hsl(${hue}, 30%, 10%))`,
      }}
    >
      <motion.div
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="relative flex flex-col items-center justify-center"
        style={{ transform: `scale(${scale})` }}
      >
        {/* Antenna */}
        <div className="h-3 w-1 rounded-t-sm" style={{ backgroundColor: mainColor }} />
        <div
          className="-mt-1 h-2 w-2 rounded-full shadow-lg"
          style={{ backgroundColor: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }}
        />

        {/* Visor */}
        <div className="mt-1 flex h-6 w-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-black/40 px-2 shadow-md backdrop-blur-sm">
          {eyeShape === 0 && (
            <>
              <motion.div
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }}
              />
              <motion.div
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity, delay: 0.2 }}
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }}
              />
            </>
          )}
          {eyeShape === 1 && (
            <motion.div
              animate={{ scaleX: [1, 1.2, 1] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="h-1 w-6 rounded-full"
              style={{ backgroundColor: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }}
            />
          )}
          {eyeShape === 2 && (
            <>
              <div
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }}
              />
              <div
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }}
              />
            </>
          )}
          {eyeShape === 3 && (
            <motion.div
              animate={{ x: [-4, 4, -4] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: eyeColor, boxShadow: `0 0 10px ${eyeColor}` }}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}
