import { useTheme } from '../../hooks/useTheme';
import { StrokeIcon } from './StrokeIcon';

const SUN_PATHS = ['M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'];
const MOON_PATHS = ['M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'];
const SYSTEM_PATHS = ['M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'];

export const ThemeToggle = () => {
  const {
    theme, toggleTheme 
  } = useTheme();

  const getIconPaths = () => {
    if (theme === 'light') return SUN_PATHS;
    if (theme === 'dark') return MOON_PATHS;
    return SYSTEM_PATHS;
  };

  const getLabel = () => {
    if (theme === 'light') return 'Light mode';
    if (theme === 'dark') return 'Dark mode';
    return 'System theme';
  };

  return (
    <button
      onClick={toggleTheme}
      className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
      title={getLabel()}
      aria-label={`Current: ${getLabel()}. Click to change.`}
    >
      <StrokeIcon className="w-5 h-5" paths={getIconPaths()} />
    </button>
  );
};
