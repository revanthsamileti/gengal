export const colors = {
  // Base — deep luxury
  background: '#080408',
  backgroundElevated: '#110810',
  backgroundCard: '#160818',
  backgroundCardHover: '#1E0A22',

  // Brand
  primary: '#2A0128',
  primaryDark: '#0A0509',
  primaryLight: '#4A1A52',
  plum: '#6B2D6E',
  plumMuted: '#3D1A40',

  // Gold metallics
  gold: '#C9A84C',
  goldLight: '#E8D5A3',
  goldPale: '#F5E6C8',
  goldDark: '#8B6914',
  goldGradientStart: '#F5E6C8',
  goldGradientMid: '#C9A84C',
  goldGradientEnd: '#8B6914',

  // Text
  textPrimary: '#FAF7F2',
  textSecondary: '#C4B8BE',
  textMuted: '#7A6E74',
  textGold: '#E8D5A3',

  // Accents
  rose: '#D4A0A0',
  roseMuted: '#8B5A5A',
  live: '#E85D75',
  success: '#5CB88A',
  white: '#FFFFFF',

  // Borders & glass
  borderGold: 'rgba(201, 168, 76, 0.28)',
  borderGoldStrong: 'rgba(201, 168, 76, 0.55)',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  glass: 'rgba(22, 8, 24, 0.82)',
  glassLight: 'rgba(255, 255, 255, 0.04)',
  overlay: 'rgba(8, 4, 8, 0.75)',
  overlayLight: 'rgba(8, 4, 8, 0.45)',

  // Legacy aliases (screens may reference)
  onSurface: '#FAF7F2',
  onSurfaceVariant: '#C4B8BE',
  onSurfaceMuted: '#7A6E74',
  secondary: '#C9A84C',
  secondaryBright: '#E8D5A3',
  secondaryContainer: '#C9A84C',
  accentGold: '#C9A84C',
  surfaceContainer: '#160818',
  onTertiaryContainer: '#D4A0A0',
};

export const gradients = {
  page: ['#080408', '#110810', '#0A0509'] as const,
  hero: ['#2A0128', '#160818', '#0A0509'] as const,
  heroOverlay: ['transparent', 'rgba(8, 4, 8, 0.3)', 'rgba(8, 4, 8, 0.92)'] as const,
  gold: [colors.goldGradientStart, colors.goldGradientMid, colors.goldGradientEnd] as const,
  goldButton: ['#F5E6C8', '#C9A84C', '#A08030'] as const,
  goldCTA: ['#E8D5A3', '#C9A84C', '#8B6914'] as const,
  goldBorder: ['rgba(201,168,76,0.6)', 'rgba(201,168,76,0.15)', 'rgba(201,168,76,0.5)'] as const,
  card: ['rgba(30,10,34,0.95)', 'rgba(16,8,24,0.98)'] as const,
  spotlight: ['rgba(201,168,76,0.18)', 'transparent'] as const,
};
