/**
 * Coin amounts are billed per second, so balances and charges are fractional in
 * the ledger (553.498). Screens must never show that raw: every place a user
 * sees coins goes through these, so the same balance reads the same everywhere.
 */

/** A balance: rounded down, so the app never shows coins the user cannot spend. */
export const formatCoinBalance = (value: number | null | undefined): string => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.floor(n).toLocaleString('en-IN');
};

/** A charge or total spent: nearest whole coin. */
export const formatCoinAmount = (value: number | null | undefined): string => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.round(n).toLocaleString('en-IN');
};

/** Rupee prices, grouped the Indian way: ₹1,799. */
export const formatInr = (value: number, decimals = 0): string =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
