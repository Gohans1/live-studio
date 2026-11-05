// The free camera's walking keys, held like a game's: moved every frame by the time that passed, so the speed doesn't depend
// on the keyboard's repeat rate (half a second of nothing, then ~30 small steps a second) or on the frame rate
export const SPEED = 4; // units a second: Minecraft walking pace in a block-sized world
export const FAST = 3; // with Shift
const EASE = 0.08; // seconds to get most of the way to full speed, and to stop

const AXES: Record<string, [axis: number, sign: number]> = {
  KeyW: [0, 1], KeyS: [0, -1], KeyD: [1, 1], KeyA: [1, -1], KeyE: [2, 1], KeyQ: [2, -1],
};

export const createFlight = () => {
  const held = new Set<string>(), v = [0, 0, 0];
  let fast = false;
  return {
    // Takes the key (true) only if it walks; Shift is read along the way
    press(code: string) { if (code.startsWith("Shift")) fast = true; if (!AXES[code]) return false; held.add(code); return true; },
    release(code: string) { if (code.startsWith("Shift")) fast = false; held.delete(code); },
    clear() { held.clear(); fast = false; },
    // How far to move this frame as [forward, right, up], or null once standing still
    step(dt: number): [number, number, number] | null {
      const want = [0, 0, 0];
      for (const code of held) { const [axis, sign] = AXES[code]; want[axis] += sign * SPEED * (fast ? FAST : 1); }
      const k = 1 - Math.exp(-dt / EASE);
      for (let i = 0; i < 3; i++) { v[i] += (want[i] - v[i]) * k; if (!want[i] && Math.abs(v[i]) < 0.01) v[i] = 0; }
      if (!v[0] && !v[1] && !v[2]) return null;
      return [v[0] * dt, v[1] * dt, v[2] * dt];
    },
  };
};
