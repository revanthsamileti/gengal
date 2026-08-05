/**
 * Seeded demo profiles.
 *
 * These are not Firestore documents and no account exists behind them — they
 * exist so the app never looks empty before real people sign up. Anything
 * rendering them must keep them visibly inert: never place a call, never imply
 * a real person is reachable. Callers key off `isSampleProfile`.
 *
 * Shared between the Connect list and the More Connects directory so the two
 * screens cannot drift apart.
 */
export type SampleProfile = {
  uid: string;
  isSampleProfile: true;
  name: string;
  age: number;
  language: string;
  /** Matches MatchNode's tier union so these slot straight into the Connect list. */
  tier: 'VIP' | 'ELITE' | 'STANDARD';
  image: string;
  modes: Array<'call' | 'video'>;
  city: string;
  isOnline: boolean;
  popularityScore: number;
};

export const SAMPLE_PROFILES: SampleProfile[] = [
  {
    uid: 'ref_elena',
    isSampleProfile: true,
    name: 'Elena',
    age: 26,
    language: 'ENGLISH',
    tier: 'ELITE',
    image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=400&auto=format&fit=crop',
    modes: ['call', 'video'],
    city: 'Maharashtra',
    isOnline: true,
    popularityScore: 980,
  },
  {
    uid: 'ref_sophia',
    isSampleProfile: true,
    name: 'Sophia',
    age: 24,
    language: 'SPANISH',
    tier: 'VIP',
    image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=400&auto=format&fit=crop',
    modes: ['video'],
    city: 'Karnataka',
    isOnline: true,
    popularityScore: 850,
  },
  {
    uid: 'ref_aanya',
    isSampleProfile: true,
    name: 'Aanya',
    age: 22,
    language: 'HINDI',
    tier: 'ELITE',
    image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=400&auto=format&fit=crop',
    modes: ['call', 'video'],
    city: 'Delhi',
    isOnline: true,
    popularityScore: 950,
  },
  {
    uid: 'ref_chloe',
    isSampleProfile: true,
    name: 'Chloe',
    age: 25,
    language: 'ENGLISH',
    tier: 'VIP',
    image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=400&auto=format&fit=crop',
    modes: ['call', 'video'],
    city: 'Tamil Nadu',
    isOnline: true,
    popularityScore: 920,
  },
  {
    uid: 'ref_meera',
    isSampleProfile: true,
    name: 'Meera',
    age: 23,
    language: 'HINDI',
    tier: 'VIP',
    image: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?q=80&w=400&auto=format&fit=crop',
    modes: ['video', 'call'],
    city: 'Telangana',
    isOnline: true,
    popularityScore: 880,
  },
  {
    uid: 'ref_valeria',
    isSampleProfile: true,
    name: 'Valeria',
    age: 24,
    language: 'SPANISH',
    tier: 'ELITE',
    image: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?q=80&w=400&auto=format&fit=crop',
    modes: ['call', 'video'],
    city: 'Kerala',
    isOnline: true,
    popularityScore: 790,
  },
];
