import { Platform } from 'react-native';

export const skeuo = {
  surface: '#FFFCF7',
  surfaceRaised: '#FFFDF8',
  surfaceInset: '#F3EBDD',
  creamTop: '#FFFFFF',
  creamBottom: '#F5EBDD',
  goldTop: '#F9E8AE',
  goldMid: '#CBA72F',
  goldBottom: '#967407',
  plum: '#4B0054',
  gold: '#9A7A05',
  border: '#E9D9BE',
  borderLight: '#FFFFFF',
  raisedShadow: Platform.OS === 'web' ? '0 10px 22px rgba(83, 58, 29, 0.15)' : '0 10px 22px rgba(83, 58, 29, 0.15)',
  deepShadow: Platform.OS === 'web' ? '0 16px 32px rgba(83, 58, 29, 0.2)' : '0 16px 32px rgba(83, 58, 29, 0.2)',
  insetShadow: Platform.OS === 'web' ? 'inset 0 2px 5px rgba(83, 58, 29, 0.10), inset 0 -2px 4px rgba(255, 255, 255, 0.75)' : '0 2px 5px rgba(83, 58, 29, 0.10)',
  goldShadow: Platform.OS === 'web' ? '0 10px 18px rgba(154, 122, 5, 0.24)' : '0 10px 18px rgba(154, 122, 5, 0.24)',
};

export const skeuoGradients = {
  page: ['#FFFDF8', '#F8F0E3', '#FFFCF7'] as const,
  raised: ['#FFFFFF', '#FFF8EA', '#F2E6D4'] as const,
  inset: ['#EDE1D0', '#FFF9EF'] as const,
  gold: ['#FFF1BB', '#D0A92E', '#8F6D05'] as const,
  plumButton: ['#6E0875', '#4B0054', '#2B0030'] as const,
};
