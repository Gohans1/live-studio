// @ts-nocheck
// What the studio edits, in one file: when each action and sound happens, where cuts fall, how the voice is paced.
// Every time in the film is written in the voice's original seconds ("source"); the voice edit stretches those into the seconds
// you hear ("out"). So moving a sentence carries the actions on its words along with it.
// The film's data comes in once, through setEdit from the film's own src/edit.ts, when the page loads. Saving edit.json
// rebuilds the page like any code ("Có bản mới"), so the film may also merge in keys it keeps in other files there.

export const EDIT = {};
export const setEdit = (d) => { for (const k of Object.keys(EDIT)) delete EDIT[k]; Object.assign(EDIT, d); };

const map = (x, a, b) => {
  const w = EDIT.voice?.warp ?? [];
  if (w.length < 2) return x;
  if (x <= w[0][a]) return x - w[0][a] + w[0][b];
  const last = w[w.length - 1];
  if (x >= last[a]) return x - last[a] + last[b];
  let lo = 0, hi = w.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w[m][a] <= x) lo = m; else hi = m; }
  return w[lo][b] + ((x - w[lo][a]) / (w[hi][a] - w[lo][a])) * (w[hi][b] - w[lo][b]);
};
export const toSource = (out) => map(out, 1, 0);
export const fromSource = (src) => map(src, 0, 1);
