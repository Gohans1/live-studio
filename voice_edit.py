"""Demo: the voice stays as it was taken. Replace with a script that applies edit.json's voice.edits and prints {"lines", "warp"}."""
import json
import sys
from pathlib import Path

voice = json.loads((Path(__file__).resolve().parent / "src/edit.json").read_text(encoding="utf8"))["voice"]
if voice["edits"]:
    sys.exit("voice_edit.py is a stub in this demo: leave voice.edits empty")
print(json.dumps({"lines": voice["lines"], "warp": []}))
