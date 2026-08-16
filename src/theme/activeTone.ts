/**
 * Which shell is currently on screen.
 *
 * Most of the app is the cream `light` shell, but the immersive screens — an
 * in-call CallScreen, Match, ExpertRoom, DumCharades — run the `dark` one. A
 * dialog has no way to read that from its own position, because it renders at
 * the app root rather than inside the screen, so the shells publish it here and
 * `Alert.alert` reads it at the moment an alert is raised.
 */

export type Tone = 'dark' | 'light';

/**
 * A stack rather than a single value: React mounts the incoming screen before
 * unmounting the outgoing one, so a plain last-writer-wins would leave the tone
 * pinned to whichever shell happened to unmount second.
 */
let stack: { id: number; tone: Tone }[] = [];
let nextId = 1;

/** Light is the default: it is what the app wears everywhere but the rooms. */
export const getActiveTone = (): Tone => stack[stack.length - 1]?.tone ?? 'light';

export function pushTone(tone: Tone): number {
  const id = nextId++;
  stack.push({ id, tone });
  return id;
}

export function popTone(id: number): void {
  stack = stack.filter((entry) => entry.id !== id);
}
