// How long a passed note stays on the picture, in the creator's seconds: 2x speed doesn't make it shorter to read
export const NOTE_FADE = 3;

// Opacity of a note's pin and words at film second t: full on its frame (0.05 s early counts, a seek lands near it), then
// fading to nothing over NOTE_FADE seconds of watching. Paused, it holds
export const pinFade = (at: number, t: number, rate = 1) => {
  const d = t - at, span = NOTE_FADE * rate;
  return d < -0.05 || d > span ? 0 : Math.min(1, 1 - d / span);
};
