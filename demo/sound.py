"""Demo mix: the voice alone. Replace with your own: python sound.py OUT.wav --dry writes OUT.wav and trials.json beside it."""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
out = Path(sys.argv[1])
shutil.copyfile(ROOT / "assets/public/agent/full_voice.wav", out)
out.with_name("trials.json").write_text("{}")
