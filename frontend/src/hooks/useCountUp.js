import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/motion.js';

/**
 * Animate an integer from 0 to `target` once, on mount. Returns the current
 * value to render. Respects reduced-motion (returns `target` immediately) and
 * only runs for finite numbers.
 */
export function useCountUp(target, { duration = 650 } = {}) {
  const [value, setValue] = useState(() =>
    typeof target === 'number' && Number.isFinite(target) && !prefersReducedMotion() ? 0 : target,
  );
  const raf = useRef(0);

  useEffect(() => {
    if (typeof target !== 'number' || !Number.isFinite(target) || prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return value;
}
