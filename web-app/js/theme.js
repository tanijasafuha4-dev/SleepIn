/**
 * Theme & Color utilities matching Material Design 3 and SleepIn Color.kt.
 */

export const DEFAULT_COURSE_COLOR_INT = 0xFF4A90D9;
export const DEFAULT_COURSE_COLOR_HEX = '#4A90D9';
export const THEME_COLOR_LIGHT = '#36618E';
export const THEME_COLOR_DARK = '#111418';

export const DEFAULT_COURSE_COLORS = [
  DEFAULT_COURSE_COLOR_INT, // Blue
  0xFF67C23A, // Green
  0xFFE6A23C, // Yellow/Amber
  0xFFF56C6C, // Coral Red
  0xFF909399, // Gray
  0xFF9B59B6, // Purple
  0xFF1ABC9C, // Emerald
  0xFFE91E63, // Pink
  0xFF3F51B5, // Indigo
  0xFF00BCD4, // Cyan
  0xFF8BC34A, // Light Green
  0xFFFF9800  // Orange
];

export function intToHexColor(intVal) {
  if (intVal == null) return DEFAULT_COURSE_COLOR_HEX;
  // Strip alpha if present (take lower 24 bits)
  const hex = (intVal & 0x00FFFFFF).toString(16).padStart(6, '0');
  return '#' + hex;
}

export function hexToIntColor(hexStr) {
  if (!hexStr) return DEFAULT_COURSE_COLOR_INT;
  const clean = hexStr.replace('#', '');
  const parsed = parseInt(clean, 16);
  // Add 0xFF000000 alpha channel
  return (0xFF000000 | parsed) >>> 0;
}

export function getContrastTextColor(hexColor) {
  const hex = String(hexColor || DEFAULT_COURSE_COLOR_HEX).replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 165) ? '#1E293B' : '#FFFFFF';
}

export function applyTheme(themeMode = 'SYSTEM') {
  const root = document.documentElement;
  let isDark = false;

  if (themeMode === 'DARK') {
    isDark = true;
  } else if (themeMode === 'LIGHT') {
    isDark = false;
  } else {
    // SYSTEM
    isDark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  root.classList.toggle('dark', isDark);

  // Update theme meta color for mobile browser status bar
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.content = isDark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
  }
}

export function listenSystemThemeChange(onThemeChange) {
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onThemeChange);
  }
}
