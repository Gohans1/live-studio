"""What the timeline shows of the voice: python voice_map.py OUT.json. The demo knows its sentences; use a speech recognizer for a real take."""
import array
import json
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEP = 0.04
LINES = [(0.5, 3.0, "This is a demo scene for the studio."), (4.0, 7.0, "Tap anything in the picture and leave a note."), (8.0, 11.0, "The note keeps the moment, the tap and the words."), (12.0, 15.0, "Then an AI agent reads them and makes the changes.")]

with wave.open(str(ROOT / "assets/public/agent/full_voice.wav")) as w:
    rate = w.getframerate()
    samples = array.array("h", w.readframes(w.getnframes()))
size = int(rate * STEP)
peaks = [round(max((abs(v) for v in samples[i : i + size]), default=0) / 32768, 3) for i in range(0, len(samples), size)]
lines = []
for s, e, text in LINES:
    parts = text.split()
    each = (e - s) / len(parts)
    lines.append({"s": s, "e": e, "text": text, "words": [{"w": p, "s": round(s + i * each, 3), "e": round(s + (i + 1) * each, 3)} for i, p in enumerate(parts)]})
Path(sys.argv[1]).write_text(json.dumps({"step": STEP, "peaks": peaks, "lines": lines}))
print("words", len(lines), flush=True)
