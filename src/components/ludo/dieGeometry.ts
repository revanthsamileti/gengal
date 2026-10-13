/**
 * Geometry for the tumbling die.
 *
 * The die is a cube that only ever turns a quarter at a time, about one axis
 * per turn. That is deliberate: React Native on Android does not render a
 * general 3D matrix -- it decomposes it and drops the depth -- so a free-spinning
 * cube built from six transformed views comes apart at the edges. A single-axis
 * turn needs nothing but translate, scale and one rotateX or rotateY under
 * perspective, which both platforms draw faithfully, and at most two faces are
 * ever in view.
 *
 * Positions run along one number, `t`, in quarter turns. Four views stand in
 * for the faces passing the front in order; view `j` faces the viewer when
 * `t` is `j` (mod 4), is arriving for the quarter before and leaving for the
 * quarter after. Turns alternate: an even step rolls the cube forward (the next
 * face comes down from the top), an odd step rolls it sideways (the next face
 * comes in from the right).
 */

export const RING = 4;
/** Samples per quarter turn. The pose is not linear in `t`, so it is tabulated. */
const STEPS = 12;
/** The table repeats so a roll can run on past one lap without wrapping. */
const LAPS = 3;
export const MAX_T = RING * LAPS;

export type FacePose = {
  visible: boolean;
  translateX: number;
  translateY: number;
  scale: number;
  /** Degrees. Only one of the two is ever non-zero. */
  rotateX: number;
  rotateY: number;
  /** 0..1 darkening for a face that is turned away from the light. */
  shade: number;
};

const HIDDEN: FacePose = {
  visible: false, translateX: 0, translateY: 0, scale: 1, rotateX: 0, rotateY: 0, shade: 0,
};

export function facePose(j: number, t: number, size: number, perspective: number): FacePose {
  const half = size / 2;
  const d = (((t - j) % RING) + RING) % RING;

  let incoming: boolean;
  let progress: number;
  if (d <= 1) {
    incoming = false;
    progress = d;
  } else if (d >= RING - 1) {
    incoming = true;
    progress = d - (RING - 1);
  } else {
    return HIDDEN;
  }

  // How far the face is from square-on: a leaving face has turned this much, an
  // arriving one still has this much to go.
  const tilt = (incoming ? 1 - progress : progress) * (Math.PI / 2);
  if (tilt > Math.PI / 2 - 1e-6) return HIDDEN;

  // The face's centre swings round the cube's centre: towards the viewer by
  // `depth`, and off to one side by `reach`.
  const depth = half * Math.cos(tilt);
  const reach = half * Math.sin(tilt);
  // Nearer things draw larger. Normalised so the square-on face is exactly `size`.
  const k = (perspective / (perspective - depth)) / (perspective / (perspective - half));

  const step = incoming ? j - 1 : j;
  const sideways = Math.abs(step % 2) === 1;
  const degrees = (tilt * 180) / Math.PI;
  // A leaving face darkens as it turns under; an arriving one is catching light.
  const shade = (incoming ? 0.2 : 0.46) * (1 - Math.cos(tilt));

  if (sideways) {
    // Leaves to the left, arrives from the right.
    return {
      visible: true,
      translateX: (incoming ? reach : -reach) * k,
      translateY: 0,
      scale: k,
      rotateX: 0,
      rotateY: incoming ? degrees : -degrees,
      shade,
    };
  }
  // Leaves downward, arrives from above.
  return {
    visible: true,
    translateX: 0,
    translateY: (incoming ? -reach : reach) * k,
    scale: k,
    rotateX: incoming ? degrees : -degrees,
    rotateY: 0,
    shade,
  };
}

/**
 * The `perspective` to put in each face's own transform. The face is scaled to
 * keep the square-on one at `size`, and its perspective has to shrink by the
 * same factor for the foreshortening within the face to match the cube's.
 */
export function facePerspective(size: number, perspective: number): number {
  return perspective - size / 2;
}

export type FaceTrack = {
  input: number[];
  opacity: number[];
  translateX: number[];
  translateY: number[];
  scale: number[];
  rotateX: string[];
  rotateY: string[];
  shade: number[];
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** View `j`'s pose tabulated along `t`, in the shape Animated.interpolate takes. */
export function buildFaceTrack(j: number, size: number, perspective: number): FaceTrack {
  const track: FaceTrack = {
    input: [], opacity: [], translateX: [], translateY: [], scale: [], rotateX: [], rotateY: [], shade: [],
  };
  for (let i = 0; i <= MAX_T * STEPS; i++) {
    const t = i / STEPS;
    const pose = facePose(j, t, size, perspective);
    track.input.push(round(t));
    track.opacity.push(pose.visible ? 1 : 0);
    track.translateX.push(round(pose.translateX));
    track.translateY.push(round(pose.translateY));
    track.scale.push(round(pose.scale));
    track.rotateX.push(`${round(pose.rotateX)}deg`);
    track.rotateY.push(`${round(pose.rotateY)}deg`);
    track.shade.push(round(pose.shade));
  }
  return track;
}

/**
 * Where a roll that is at `current` should come to rest. Two views are in sight
 * at any moment -- floor(current) and the one after it -- so the next one along
 * is the nearest that can be given the rolled value without it changing in view.
 */
export function landingIndex(current: number): number {
  return Math.floor(current) + 2;
}

/**
 * A value for the face glimpsed beside the one showing. On a real die it can be
 * anything but the showing value or its opposite (opposite faces sum to seven).
 */
export function sideValue(front: number): number {
  const order = [2, 3, 1, 6, 4, 5];
  return order.find((v) => v !== front && v !== 7 - front) ?? 1;
}
