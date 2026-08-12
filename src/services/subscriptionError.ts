/**
 * The error arm every Firestore `onSnapshot` in this app is required to have.
 *
 * `onSnapshot(ref, next)` with no third argument is not "no error handling" —
 * it is *worse* than that. When the listener fails, the Firebase SDK raises an
 * unhandled rejection ("Uncaught Error in snapshot listener"), which surfaces as
 * a context-free redbox on whatever screen happens to be mounted, and then the
 * listener is torn down for good. Nothing re-subscribes. The screen keeps
 * rendering whatever it last received, forever.
 *
 * That failure mode is genuinely hard to diagnose from the outside, because it
 * does not look like an error — it looks like a room where nobody is talking,
 * a lobby with no rooms in it, or a game that stopped taking turns. This exact
 * bug was already found and fixed once on the two incoming-call listeners
 * (commit 7f40407), where a listener dying silently meant an account looked
 * online and simply never rang. The room and game services had the same hole.
 *
 * Failing loudly is not enough on its own: a lobby that errors must not be
 * indistinguishable from a lobby that is genuinely empty, or users are told
 * "no rooms" when the truth is "we could not read". So callers get to pass an
 * `onError` and render a real error state, and the subscription helpers supply
 * a `fallback` that resets the data to a defined value rather than leaving a
 * stale snapshot on screen pretending to be live.
 */

/** What a screen supplies when it wants to render its own error state. */
export type SubscriptionErrorHandler = (error: Error) => void;

/**
 * Builds the third argument to `onSnapshot`.
 *
 * @param tag       Identifies the subscription in logs. Use `service:what`, so a
 *                  log line says which stream died without needing a stack.
 * @param onError   Optional; lets the mounted screen show a retry affordance
 *                  instead of an empty state that reads as "there is nothing
 *                  here".
 * @param fallback  Optional; clears the stream's data. Use it wherever showing
 *                  the last good snapshot would be actively misleading — a room
 *                  document is the clearest case, since a frozen copy of it
 *                  keeps the user sitting in a room that may have already
 *                  closed underneath them.
 */
export const snapshotError =
  (tag: string, onError?: SubscriptionErrorHandler, fallback?: () => void) =>
  (error: Error) => {
    console.error(`[${tag}] realtime subscription stopped:`, error?.message ?? error);
    fallback?.();
    onError?.(error);
  };
