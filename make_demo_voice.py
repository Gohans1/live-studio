"""Writes the demo's stand-in voice: a soft tone during each sentence, so sound and timeline have something to show. Stdlib only."""
import array
import math
import wave
from pathlib import Path

RATE, END = 8000, 17.0
LINES = [(0.5, 3.0), (4.0, 7.0), (8.0, 11.0), (12.0, 15.0)]
data = array.array("h", [0] * int(RATE * END))
for s, e in LINES:
    for i in range(int(s * RATE), int(e * RATE)):
        x = i / RATE
        pulse = 0.5 + 0.5 * math.sin(x * 2 * math.pi * 2.5)
        data[i] = int(5000 * pulse * math.sin(x * 2 * math.pi * 180))
out = Path(__file__).resolve().parent / "assets/public/agent/full_voice.wav"
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(data.tobytes())
