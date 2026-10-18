import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as CANNON from 'cannon-es';

/**
 * A 3D die thrown by physics, landing on the number the server rolled.
 *
 * The owner asked for a real physics die. The server decides every roll, so
 * physics cannot be allowed to decide the result. The "hybrid trick" games
 * use: the throw is simulated in full (cannon-es, a few milliseconds), which
 * says which face physics put on top; the pips are then turned inside the
 * cube so that face carries the server's number, and the recorded throw is
 * replayed on screen (three.js on expo-gl). Every bounce is real physics and
 * the result is always the real roll.
 *
 * Rendering runs only while something moves; at rest one frame is drawn.
 */

/** Where each value's face points, in the die's own frame. Opposites sum to 7. */
const FACE: Record<number, [number, number, number]> = {
  1: [0, 1, 0], 6: [0, -1, 0], 2: [1, 0, 0], 5: [-1, 0, 0], 3: [0, 0, 1], 4: [0, 0, -1],
};
/** Pip positions on a face, in its own two axes, for a die of size 1. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.22, -0.22], [0.22, 0.22]],
  3: [[-0.22, -0.22], [0, 0], [0.22, 0.22]],
  4: [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]],
  5: [[-0.22, -0.22], [0.22, -0.22], [0, 0], [-0.22, 0.22], [0.22, 0.22]],
  6: [[-0.22, -0.24], [0.22, -0.24], [-0.22, 0], [0.22, 0], [-0.22, 0.24], [0.22, 0.24]],
};
const UP = new THREE.Vector3(0, 1, 0);
/** The box the die is thrown into: inside what the camera sees. */
const ARENA = 0.85;
const STEP = 1 / 60;
/** The replay runs a little faster than real time; a throw should be snappy. */
const REPLAY_SPEED = 1.35;
const MAX_FRAMES = 110;

const normal = (v: number) => new THREE.Vector3(...FACE[v]);

/** Which value's face points most nearly up for a die turned by `q`. */
function topValue(q: THREE.Quaternion): number {
  let best = 1;
  let bestY = -Infinity;
  for (const v of [1, 2, 3, 4, 5, 6]) {
    const y = normal(v).applyQuaternion(q).y;
    if (y > bestY) { bestY = y; best = v; }
  }
  return best;
}

type Frame = { p: THREE.Vector3; q: THREE.Quaternion };

/** Throws a die in a physics world and records where it went. */
function simulateThrow(): Frame[] {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -42, 0) });
  world.allowSleep = true;
  const material = new CANNON.Material('die');
  world.addContactMaterial(new CANNON.ContactMaterial(material, material, { friction: 0.25, restitution: 0.38 }));

  const plane = (pos: CANNON.Vec3, axis: CANNON.Vec3, angle: number) => {
    const b = new CANNON.Body({ mass: 0, material, shape: new CANNON.Plane() });
    b.position.copy(pos);
    b.quaternion.setFromAxisAngle(axis, angle);
    world.addBody(b);
  };
  plane(new CANNON.Vec3(0, 0, 0), new CANNON.Vec3(1, 0, 0), -Math.PI / 2);          // floor
  plane(new CANNON.Vec3(-ARENA, 0, 0), new CANNON.Vec3(0, 1, 0), Math.PI / 2);      // left wall
  plane(new CANNON.Vec3(ARENA, 0, 0), new CANNON.Vec3(0, 1, 0), -Math.PI / 2);      // right wall
  plane(new CANNON.Vec3(0, 0, -ARENA), new CANNON.Vec3(0, 1, 0), 0);               // back wall
  plane(new CANNON.Vec3(0, 0, ARENA), new CANNON.Vec3(0, 1, 0), Math.PI);           // front wall

  const r = (a: number, b: number) => a + Math.random() * (b - a);
  const die = new CANNON.Body({
    mass: 1, material, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    sleepSpeedLimit: 0.2, sleepTimeLimit: 0.15,
  });
  die.position.set(r(-0.3, 0.3), 1.8, r(-0.3, 0.3));
  die.quaternion.setFromEuler(r(0, 6.3), r(0, 6.3), r(0, 6.3));
  die.velocity.set(r(-2.2, 2.2), r(-1.5, 0), r(-2.2, 2.2));
  die.angularVelocity.set(r(-16, 16), r(-16, 16), r(-16, 16));
  world.addBody(die);

  const frames: Frame[] = [];
  for (let i = 0; i < MAX_FRAMES; i++) {
    world.step(STEP);
    frames.push({
      p: new THREE.Vector3(die.position.x, die.position.y, die.position.z),
      q: new THREE.Quaternion(die.quaternion.x, die.quaternion.y, die.quaternion.z, die.quaternion.w),
    });
    if (die.sleepState === CANNON.Body.SLEEPING) break;
  }

  // A die cocked against a wall still has to read clearly: ease it flat onto
  // whichever face is nearest to up, down onto the floor.
  const last = frames[frames.length - 1];
  const top = topValue(last.q);
  const flat = new THREE.Quaternion()
    .setFromUnitVectors(normal(top).applyQuaternion(last.q), UP)
    .multiply(last.q);
  const rest = new THREE.Vector3(last.p.x, 0.5, last.p.z);
  for (let i = 1; i <= 8; i++) {
    frames.push({ p: last.p.clone().lerp(rest, i / 8), q: last.q.clone().slerp(flat, i / 8) });
  }
  return frames;
}

/** A die of size 1: a rounded cube and its pips, which turn as one inside `pips`. */
function buildDie(color: string) {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  outer.add(inner);
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(1, 1, 1, 4, 0.14),
    new THREE.MeshPhongMaterial({ color, shininess: 60, specular: 0x444444 }),
  );
  outer.add(body);
  const pipGeo = new THREE.CircleGeometry(0.085, 20);
  const pipMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const v of [1, 2, 3, 4, 5, 6]) {
    const n = normal(v);
    // Two axes lying in the face.
    const u = Math.abs(n.y) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const w = new THREE.Vector3().crossVectors(n, u);
    for (const [a, b] of PIPS[v]) {
      const pip = new THREE.Mesh(pipGeo, pipMat);
      pip.position.copy(n.clone().multiplyScalar(0.502).add(u.clone().multiplyScalar(a)).add(w.clone().multiplyScalar(b)));
      pip.lookAt(pip.position.clone().add(n));
      inner.add(pip);
    }
  }
  return { outer, inner, body };
}

type Props = {
  /** The rolled value; a change throws the die onto it. */
  value: number | null;
  /** Our own roll is waiting on the server: the die spins in the air. */
  rolling: boolean;
  /** Goes up with every roll at the table (room.lastRoll.seq); each new one is thrown. */
  rollSeq?: number;
  /** Turn colour, hex. */
  color: string;
  size: number;
  reduceMotion: boolean;
  /** The die has come to rest showing `value`. */
  onLanded?: (value: number) => void;
  /** The 3D view could not start; the caller shows the flat die instead. */
  onUnavailable?: () => void;
};

export function Die3D({ value, rolling, rollSeq = 0, color, size, reduceMotion, onLanded, onUnavailable }: Props) {
  const lastSeq = useRef(rollSeq);
  /** The roll counter when our own roll started. */
  const seqAtRoll = useRef(rollSeq);
  /** Our own roll was thrown before its counter arrived: that arrival is not a new roll. */
  const ownUnseen = useRef(false);
  const three = useRef<{
    gl: ExpoWebGLRenderingContext;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    die: ReturnType<typeof buildDie>;
    shadow: THREE.Mesh;
  } | null>(null);
  const loop = useRef<number | null>(null);
  const mode = useRef<'idle' | 'spin' | 'throw'>('idle');
  const shown = useRef<number | null>(value);
  const lastValue = useRef<number | null>(value);
  const props = useRef({ onLanded, value, reduceMotion, rolling });
  props.current = { onLanded, value, reduceMotion, rolling };

  const draw = useCallback(() => {
    const t = three.current;
    if (!t) return;
    t.shadow.position.set(t.die.outer.position.x, 0.01, t.die.outer.position.z);
    const lift = Math.max(0, t.die.outer.position.y - 0.5);
    t.shadow.scale.setScalar(1 + lift * 0.35);
    (t.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.06, 0.28 - lift * 0.08);
    t.renderer.render(t.scene, t.camera);
    t.gl.endFrameEXP();
  }, []);

  const stop = () => {
    if (loop.current !== null) cancelAnimationFrame(loop.current);
    loop.current = null;
  };

  /** At rest, the value face up, turned a little so two sides show. */
  const rest = useCallback((v: number | null) => {
    const t = three.current;
    if (!t) return;
    stop();
    mode.current = 'idle';
    t.die.inner.quaternion.identity();
    const face = v ?? 1;
    const q = new THREE.Quaternion().setFromUnitVectors(normal(face), UP);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, 0.55));
    t.die.outer.quaternion.copy(q);
    t.die.outer.position.set(0, 0.5, 0);
    draw();
  }, [draw]);

  const spin = useCallback(() => {
    const t = three.current;
    if (!t) return;
    stop();
    mode.current = 'spin';
    const axis = new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
    const started = Date.now();
    const tick = () => {
      const s = (Date.now() - started) / 1000;
      t.die.outer.position.set(Math.sin(s * 9) * 0.08, 0.95 + Math.sin(s * 14) * 0.08, 0);
      t.die.outer.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, 0.32));
      draw();
      loop.current = requestAnimationFrame(tick);
    };
    tick();
  }, [draw]);

  const throwTo = useCallback((v: number) => {
    const t = three.current;
    if (!t) return;
    stop();
    if (props.current.reduceMotion) {
      rest(v);
      props.current.onLanded?.(v);
      return;
    }
    mode.current = 'throw';
    const frames = simulateThrow();
    // The trick: physics put `landed` on top; turn the pips so that face reads `v`.
    const landed = topValue(frames[frames.length - 1].q);
    t.die.inner.quaternion.setFromUnitVectors(normal(v), normal(landed));
    const started = Date.now();
    const tick = () => {
      const i = Math.min(frames.length - 1, Math.floor(((Date.now() - started) / 1000) * 60 * REPLAY_SPEED));
      t.die.outer.position.copy(frames[i].p);
      t.die.outer.quaternion.copy(frames[i].q);
      draw();
      if (i >= frames.length - 1) {
        loop.current = null;
        mode.current = 'idle';
        shown.current = v;
        props.current.onLanded?.(v);
        return;
      }
      loop.current = requestAnimationFrame(tick);
    };
    tick();
  }, [draw, rest]);

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    try {
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const canvas = {
        width: w, height: h, style: {}, clientWidth: w, clientHeight: h,
        addEventListener: () => {}, removeEventListener: () => {}, getContext: () => gl,
      };
      const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, context: gl as any, antialias: true, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(2, 6, 4);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
      camera.position.set(0, 2.9, 1.9);
      camera.lookAt(0, 0.35, 0);

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 28),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
      );
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);

      const die = buildDie(color);
      scene.add(die.outer);
      three.current = { gl, renderer, scene, camera, die, shadow };
      if (props.current.rolling) spin(); else rest(props.current.value);
    } catch (e) {
      console.warn('[Die3D] 3D view unavailable, using the flat die', e);
      onUnavailable?.();
    }
    // Set up once per GL context; later prop changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The turn colour.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    (t.die.body.material as THREE.MeshPhongMaterial).color.set(color);
    if (mode.current === 'idle') draw();
  }, [color, draw]);

  // Our roll in flight: spin. A value arriving -- ours or anyone's -- throws.
  useEffect(() => {
    if (!three.current) return;
    if (rolling) {
      if (mode.current !== 'spin') {
        seqAtRoll.current = lastSeq.current;
        spin();
      }
      lastSeq.current = rollSeq;
      return;
    }
    const changed = value !== lastValue.current;
    const seqChanged = rollSeq !== lastSeq.current;
    lastValue.current = value;
    lastSeq.current = rollSeq;
    if (value == null) {
      if (mode.current !== 'throw') rest(shown.current);
      return;
    }
    if (mode.current === 'spin') {
      // Our own roll came back. If its counter has not arrived yet, the next
      // counter change is this same roll, not somebody else's.
      ownUnseen.current = rollSeq === seqAtRoll.current;
      throwTo(value);
      return;
    }
    if (seqChanged && ownUnseen.current) {
      ownUnseen.current = false;
      return;
    }
    // Every new roll at the table is thrown, even the same number again;
    // a table from before lastRoll existed falls back to the value changing.
    if (rollSeq ? seqChanged : changed) throwTo(value);
  }, [rolling, value, rollSeq, spin, throwTo, rest]);

  useEffect(() => () => stop(), []);

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});
