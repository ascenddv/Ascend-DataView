/**
 * Single source of truth for "should motion play right now", honours both the
 * OS `prefers-reduced-motion` setting and the explicit Settings toggle
 * (`<html data-reduce-motion="true">`, applied by usePreferences + the pre-paint
 * boot script). CSS animations are already handled in index.css; this is for
 * JS-driven motion (count-ups, Recharts' own animation prop).
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (document.documentElement.dataset.reduceMotion === 'true') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
