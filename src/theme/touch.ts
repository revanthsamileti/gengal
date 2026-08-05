/**
 * Touch-target helpers.
 *
 * Several controls in this app are visually small on purpose — a 28pt close
 * cross on a photo, a 30pt queue chip in a crowded room header. Growing the
 * painted box would wreck those layouts, so instead we grow only the touch
 * area with `hitSlop`, which is invisible.
 *
 * The 44pt floor is the Apple HIG / Material minimum, and it's what the
 * production audit measured these controls against.
 */
export const MIN_TAP_SIZE = 44;

/**
 * hitSlop that brings a control of `renderedSize` up to at least `MIN_TAP_SIZE`.
 *
 * Pass the painted width/height in points. Square controls need one call;
 * for a non-square control call it per axis and merge.
 */
export const expandTap = (renderedSize: number) => {
  const slop = Math.max(0, Math.ceil((MIN_TAP_SIZE - renderedSize) / 2));
  return { top: slop, bottom: slop, left: slop, right: slop };
};

/** Common sizes, precomputed so call sites stay readable. */
export const tap28 = expandTap(28);
export const tap30 = expandTap(30);
export const tap33 = expandTap(33);
export const tap34 = expandTap(34);
export const tap36 = expandTap(36);
export const tap38 = expandTap(38);
export const tap40 = expandTap(40);
export const tap42 = expandTap(42);
