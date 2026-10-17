import { useCallback, useEffect, useState } from 'react';

/**
 * Per-browser visual preferences (Stage 5 UI overhaul). Purely presentational -
 * theme, density and reduced-motion are applied as `data-*` attributes on
 * <html>, which the token layer in index.css keys off. There is no backend
 * settings endpoint; this persists to localStorage only. An inline boot script
 * in index.html applies the same attributes before first paint to avoid a flash.
 */
const STORAGE_KEY = 'ascenddv.prefs';

export const DEFAULTS = { theme: 'system', density: 'comfortable', reduceMotion: false };
const THEMES = ['system', 'light', 'dark'];
const DENSITIES = ['comfortable', 'compact'];

function read() {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
      density: DENSITIES.includes(raw.density) ? raw.density : DEFAULTS.density,
      reduceMotion: raw.reduceMotion === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function apply(prefs) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;

  if (prefs.theme === 'light' || prefs.theme === 'dark') el.setAttribute('data-theme', prefs.theme);
  else el.removeAttribute('data-theme');

  if (prefs.density === 'compact') el.setAttribute('data-density', 'compact');
  else el.removeAttribute('data-density');

  if (prefs.reduceMotion) el.setAttribute('data-reduce-motion', 'true');
  else el.removeAttribute('data-reduce-motion');
}

export function usePreferences() {
  const [prefs, setPrefs] = useState(read);

  useEffect(() => {
    apply(prefs);
  }, [prefs]);

  const update = useCallback((patch) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode / storage disabled, the in-memory value still applies */
      }
      return next;
    });
  }, []);

  return {
    theme: prefs.theme,
    density: prefs.density,
    reduceMotion: prefs.reduceMotion,
    setTheme: (theme) => update({ theme }),
    setDensity: (density) => update({ density }),
    setReduceMotion: (reduceMotion) => update({ reduceMotion }),
  };
}
