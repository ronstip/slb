import { useEffect, useState } from 'react';

/**
 * Tracks whether the viewport is below the given breakpoint (default 768px -
 * Tailwind's `md`). Use for the handful of places that need to switch layout
 * in JS (e.g. forcing the card view on the agents list); prefer Tailwind
 * `md:` utilities for pure-CSS responsiveness.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
