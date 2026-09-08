import { createContext, useContext } from 'react';
import { usePreferences } from '../hooks/usePreferences.js';

/**
 * Shares one visual-preferences state between the top-bar quick toggle and the
 * Settings → Appearance controls. Kept out of the render-smoke component bundle
 * on purpose — only the shell (Topbar, SettingsPage) reads it.
 */
const PreferencesContext = createContext(null);

export function PreferencesProvider({ children }) {
  const prefs = usePreferences();
  return <PreferencesContext.Provider value={prefs}>{children}</PreferencesContext.Provider>;
}

export function usePreferencesContext() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferencesContext must be used within <PreferencesProvider>');
  return ctx;
}
