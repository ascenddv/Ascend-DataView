import { useOptionalPreferences } from './PreferencesProvider.jsx';
import { IconSun, IconMoon, IconMonitor } from '../lib/icons.jsx';
import { IconButton } from './ui/primitives.jsx';

const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: IconMonitor, light: IconSun, dark: IconMoon };
const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

/** One-click theme cycle (System → Light → Dark) for the public pages' headers. */
export default function ThemeToggle() {
  const prefs = useOptionalPreferences();
  if (!prefs) return null;
  const Icon = ICON[prefs.theme] || IconMonitor;
  return (
    <IconButton
      label={`Theme: ${LABEL[prefs.theme]}. Switch to ${LABEL[NEXT[prefs.theme]]}.`}
      title={`Theme: ${LABEL[prefs.theme]}`}
      onClick={() => prefs.setTheme(NEXT[prefs.theme])}
    >
      <Icon size={18} />
    </IconButton>
  );
}
