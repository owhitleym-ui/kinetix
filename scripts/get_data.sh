#!/usr/bin/env bash
# Download the REHAB26-ViewAngles skeleton data used for training (about 690 MB) into data/rehab26/.
# Dataset: https://doi.org/10.5281/zenodo.23018127  (CC BY-NC 4.0: non-commercial use, cite the paper)
# Only the MediaPipe skeletons and labels are downloaded, not the 8.4 GB of videos.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/rehab26"
BASE="https://zenodo.org/api/records/23018128/files"
ZIP_MD5="303ba8e1c236ee52dac7c0b8ac23789f"

mkdir -p "$DEST"
cd "$DEST"

for f in Segmentation.csv Segmentation.txt Error_types.csv joint_names.txt; do
  echo "Downloading $f"
  curl -fsSL --retry 5 -o "$f" "$BASE/$f/content"
done

if [ ! -d mp ]; then
  echo "Downloading jointSequences-mediapipe.zip (about 690 MB)"
  curl -fL --retry 5 -C - -o jointSequences-mediapipe.zip "$BASE/jointSequences-mediapipe.zip/content"
  got="$( (md5 -q jointSequences-mediapipe.zip 2>/dev/null) || md5sum jointSequences-mediapipe.zip | cut -d' ' -f1)"
  if [ "$got" != "$ZIP_MD5" ]; then
    echo "Checksum mismatch ($got). Delete data/rehab26/jointSequences-mediapipe.zip and run again." >&2
    exit 1
  fi
  unzip -q jointSequences-mediapipe.zip -d mp
  rm jointSequences-mediapipe.zip
fi

echo "Done: $(find mp -name '*_3d.npy' | wc -l | tr -d ' ') skeleton files in data/rehab26/mp"
