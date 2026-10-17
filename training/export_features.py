"""Export the compact, ready-to-train dataset: dataset/rehab26_features.npz

  python training/export_features.py        (needs the full data in data/rehab26, see scripts/get_data.sh)

Every labeled rep-view of REHAB26-ViewAngles (5 people x 3 cameras) already turned into the model's features, so
training/train_rehab26.py can retrain right after cloning, without downloading the 690 MB of skeletons.
To change the features themselves, use the full data.
"""

import json
import os

import numpy as np

import rehab_features as RF
import train_rehab26 as T

OUT = os.path.join(T.ROOT, "dataset", "rehab26_features.npz")


def main():
    samples = T.build_samples()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    f32 = lambda key: np.array([s[key] for s in samples], dtype=np.float32)
    meta = {
        "feature_version": RF.FEATURE_VERSION, "n_resample": RF.N_RESAMPLE, "signals": RF.SIGNAL_NAMES,
        "live_copies": T.LIVE_COPIES, "live_offsets": T.LIVE_OFFSETS, "front_deg": T.FRONT,
        "source": "REHAB26-ViewAngles (Janosova, Lang, Budikova, Sedmidubsky 2026), doi:10.5281/zenodo.23018127",
        "license": "CC BY-NC 4.0. Derived data: features computed from the dataset's MediaPipe skeletons.",
    }
    np.savez_compressed(
        OUT,
        x=f32("x"), d=f32("d"), xv=f32("xv"), dv=f32("dv"),
        label=np.array([s["label"] for s in samples]), ex=np.array([s["ex"] for s in samples]),
        person=np.array([s["person"] for s in samples]), video=np.array([s["video"] for s in samples]),
        session=np.array([s["session"] for s in samples]),
        cam=np.array([s["cam"] for s in samples], dtype=np.int8), angle=np.array([s["angle"] for s in samples], dtype=np.int16),
        a=np.array([s["a"] for s in samples], dtype=np.int32), b=np.array([s["b"] for s in samples], dtype=np.int32),
        meta=np.array(json.dumps(meta)),
    )
    print(f"wrote {OUT}: {len(samples)} rep-views, {os.path.getsize(OUT) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
