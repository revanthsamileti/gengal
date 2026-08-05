import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_COOLDOWN_MS = 900;

/**
 * Guards an action against double-firing.
 *
 * Screens that spend coins or start a paid call were relying on a `useState`
 * boolean set inside the handler. That leaves a window: the tap handler runs
 * before React re-renders with the disabled prop, so a fast double-tap fires
 * twice and charges twice. The ref below closes that window synchronously,
 * while `locked` remains available for driving `disabled`/spinner UI.
 *
 * The cooldown matters for the navigation case: `navigate('Call', ...)` returns
 * immediately, so releasing on settle would unlock before the second tap of a
 * double-tap lands. Holding briefly covers that, and self-heals if the
 * navigation never happens.
 */
export function useActionLock(cooldownMs: number = DEFAULT_COOLDOWN_MS) {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(
    async (action: () => void | Promise<void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (mounted.current) setLocked(true);
      try {
        await action();
      } finally {
        timer.current = setTimeout(() => {
          inFlight.current = false;
          if (mounted.current) setLocked(false);
        }, cooldownMs);
      }
    },
    [cooldownMs]
  );

  return { locked, run };
}
