"""Download the part of MobiPhysio (Harvard Dataverse, CC0) used for the mistake buckets into data/mobiphysio/:
front-camera videos of 8 exercises in 5 takes (full / medium / low light, low / high camera jitter) that the
physiotherapists scored, + the marking sheet. ~20 GB; files download 4 at a time; finished files are skipped on rerun.

  python scripts/get_mobiphysio.py

Skipped: wrist extension (E06: almost all reps scored good, and body pose can't see the wrist bend), the left/right
cameras, occluded and low-resolution takes.
MobiPhysio: Iqbal et al., Harvard Dataverse 2025, doi:10.7910/DVN/XSI0QN (CC0 1.0).
"""

import json
import os
import shutil
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://dataverse.harvard.edu/api/"
DOI = "doi:10.7910/DVN/XSI0QN"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "mobiphysio")
EXERCISES = {"E01", "E02", "E03", "E04", "E05", "E07", "E08", "E09"}
ANGLES = {"AF"}
TAKES = {"VFL", "VML", "VLL", "VLJ", "VHJ"}
UA = {"User-Agent": "form-check-data/1.0 (research; curl-compatible)"}  # Dataverse refuses urllib's default agent


def get(url, dest):
    for attempt in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(dest + ".part", "wb") as f:
                shutil.copyfileobj(r, f, 8 << 20)
            os.replace(dest + ".part", dest)
            return
        except OSError:
            if attempt == 7:
                raise
            time.sleep(5 * (attempt + 1))


def wanted(name):
    p = name[:-4].split("_")
    return name.endswith(".mp4") and len(p) == 5 and p[0] in EXERCISES and p[2] in ANGLES and p[3] in TAKES


def scores():
    """Video name -> average physiotherapist score (0-100) from the marking sheet (3 judges per video)."""
    import csv
    path = next(p for p in (os.path.join(OUT, n) for n in os.listdir(OUT)) if p.endswith(".csv"))
    out, cur = {}, None
    for r in list(csv.reader(open(path, encoding="utf-8-sig")))[2:]:
        if r and r[0].strip():
            cur = r[0].strip()
            try:
                out[cur] = float(r[11])
            except (IndexError, ValueError):
                pass
    return out


def fetch(item):
    fid, name = item
    dest = os.path.join(OUT, "videos" if name.endswith(".mp4") else "", name)
    if os.path.exists(dest):
        return name, "skip"
    get(f"{API}access/datafile/{fid}", dest)
    return name, "ok"


def main():
    os.makedirs(os.path.join(OUT, "videos"), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(f"{API}datasets/:persistentId/?persistentId={DOI}", headers=UA), timeout=120) as r:
        files = json.load(r)["data"]["latestVersion"]["files"]
    docs = [(f["dataFile"]["id"], f["dataFile"]["filename"]) for f in files if not f["dataFile"]["filename"].endswith(".mp4")]
    for item in docs:                                  # README + the physiotherapists' marking sheet first
        fetch(item)
    scored = set(scores())
    vids = [f for f in files if wanted(f["dataFile"]["filename"]) and f["dataFile"]["filename"][:-4] in scored]
    # full-light takes of every exercise first, then the other takes, so all exercises can be analyzed early
    order = {t: i for i, t in enumerate(["VFL", "VML", "VLJ", "VHJ", "VLL"])}
    vids.sort(key=lambda f: (order[f["dataFile"]["filename"].split("_")[3]], f["dataFile"]["filename"].split("_")[1], f["dataFile"]["filename"]))
    items = [(f["dataFile"]["id"], f["dataFile"]["filename"]) for f in vids]
    gb = sum(f["dataFile"].get("filesize", 0) for f in vids) / 1e9
    print(f"{len(items)} scored videos ({gb:.1f} GB) -> {OUT}/videos")
    with ThreadPoolExecutor(4) as pool:
        for i, (name, state) in enumerate(pool.map(fetch, items), 1):
            if state != "skip" or i == len(items):
                print(f"  [{i}/{len(items)}] {state} {name}", flush=True)


if __name__ == "__main__":
    main()
