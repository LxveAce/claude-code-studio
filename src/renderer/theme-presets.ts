export interface ThemePreset {
  name: string;
  accent: string;
  accentLight: string;
  gradient: string;
  gradientSoft: string;
  borderActive: string;
  glow: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Purple',
    accent: '#7c3aed',
    accentLight: '#a78bfa',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(109,40,217,0.1) 100%)',
    borderActive: 'rgba(124, 58, 237, 0.3)',
    glow: '0 0 20px rgba(124, 58, 237, 0.15)',
  },
  {
    name: 'Blue',
    accent: '#3b82f6',
    accentLight: '#93c5fd',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(37,99,235,0.1) 100%)',
    borderActive: 'rgba(59, 130, 246, 0.3)',
    glow: '0 0 20px rgba(59, 130, 246, 0.15)',
  },
  {
    name: 'Emerald',
    accent: '#10b981',
    accentLight: '#6ee7b7',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(5,150,105,0.1) 100%)',
    borderActive: 'rgba(16, 185, 129, 0.3)',
    glow: '0 0 20px rgba(16, 185, 129, 0.15)',
  },
  {
    name: 'Rose',
    accent: '#f43f5e',
    accentLight: '#fda4af',
    gradient: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 50%, #be123c 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(244,63,94,0.2) 0%, rgba(225,29,72,0.1) 100%)',
    borderActive: 'rgba(244, 63, 94, 0.3)',
    glow: '0 0 20px rgba(244, 63, 94, 0.15)',
  },
  {
    name: 'Amber',
    accent: '#f59e0b',
    accentLight: '#fcd34d',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(217,119,6,0.1) 100%)',
    borderActive: 'rgba(245, 158, 11, 0.3)',
    glow: '0 0 20px rgba(245, 158, 11, 0.15)',
  },
  {
    name: 'Cyan',
    accent: '#06b6d4',
    accentLight: '#67e8f9',
    gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 50%, #0e7490 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(8,145,178,0.1) 100%)',
    borderActive: 'rgba(6, 182, 212, 0.3)',
    glow: '0 0 20px rgba(6, 182, 212, 0.15)',
  },
];

export function applyTheme(preset: ThemePreset): void {
  const root = document.documentElement;
  const rgb = hexToRgb(preset.accent);
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--accent-light', preset.accentLight);
  root.style.setProperty('--accent-gradient', preset.gradient);
  root.style.setProperty('--accent-gradient-soft', preset.gradientSoft);
  root.style.setProperty('--border-active', preset.borderActive);
  root.style.setProperty('--shadow-glow', preset.glow);
  root.style.setProperty('--accent-dim', `rgba(${rgb}, 0.15)`);
  root.style.setProperty('--gauge-purple', preset.accent);
  root.style.setProperty('--bg-hover', `rgba(${rgb}, 0.08)`);
  localStorage.setItem('claude-studio-theme', preset.name);
}

export function findThemePreset(name: string | null): ThemePreset | undefined {
  if (!name) return undefined;
  return THEME_PRESETS.find((p) => p.name === name);
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
