import json
from pathlib import Path

p = Path.home() / "AppData/Local/Temp/pt-plan-out.json"
d = json.loads(p.read_text(encoding="utf-8"))
print("source:", d.get("source"))
print("suggestions:", len(d.get("suggestions") or []))
print()
print("PATIENT MESSAGE:")
print(d.get("patient_message"))
print()
for s in d.get("suggestions") or []:
    print(f"[{s.get('kind')}] {s.get('ex')} (progress={s.get('progress')})")
    for w in s.get("why") or []:
        print("  -", w)
    print()
