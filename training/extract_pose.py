"""Run MediaPipe Pose (the same pose_landmarker_full model the web app uses) over downloaded exercise videos, so
training and analysis see what the browser sees. Cached: finished videos are skipped on rerun.

  python training/extract_pose.py rehab24       videos from scripts/get_rehab24.py     (every frame)
  python training/extract_pose.py mobiphysio    videos from scripts/get_mobiphysio.py  (every 2nd frame)
  python training/extract_pose.py mobiphysio E01 E02   only videos whose name starts with these

Writes data/<dataset>/mp/<name>_3d.npy  (rows x 33 x 4: world x, y, z in meters + visibility)
   and data/<dataset>/mp/<name>_2d.npy  (rows x 33 x 4: image x, y in 0..1, z, visibility)
Row k is video frame k * stride (stride in data/<dataset>/mp/meta.json). Frames with no person are NaN.
Frames are shrunk to at most 1280 px before detection (landmarks are normalized, so this only saves time).
"""

import glob
import json
import os
import re
import sys
import time
from multiprocessing import Pool

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = os.path.join(ROOT, "web", "models", "pose_landmarker_full.task")
MAX_SIDE = 1280
DATASETS = {
    "rehab24": {"glob": "videos/Ex*/*.mp4", "stride": 1,
                "name": lambda v: "{}_cam{}".format(*re.search(r"(PM_\d+)-Camera(\d+)", v).groups())},
    "mobiphysio": {"glob": "videos/*.mp4", "stride": 2, "name": lambda v: os.path.basename(v)[:-4]},
}


def extract(job):
    video, base, stride = job
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    p3, p2 = base + "_3d.npy", base + "_2d.npy"
    if os.path.exists(p3) and os.path.exists(p2):
        return video, "cached", 0
    opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=MODEL),
                                        running_mode=vision.RunningMode.VIDEO, num_poses=1)
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    W, I = [], []
    t0, i = time.time(), 0
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        while True:
            ok = cap.grab()
            if not ok:
                break
            if i % stride == 0:
                ok, frame = cap.retrieve()
                if not ok:
                    break
                h, w = frame.shape[:2]
                if max(h, w) > MAX_SIDE:
                    s = MAX_SIDE / max(h, w)
                    frame = cv2.resize(frame, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
                img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                res = lm.detect_for_video(img, int(round(i * 1000 / fps)))
                if res.pose_world_landmarks:
                    W.append([[p.x, p.y, p.z, p.visibility] for p in res.pose_world_landmarks[0]])
                    I.append([[p.x, p.y, p.z, p.visibility] for p in res.pose_landmarks[0]])
                else:
                    W.append(np.full((33, 4), np.nan)); I.append(np.full((33, 4), np.nan))
            i += 1
    cap.release()
    np.save(p3, np.asarray(W, np.float32)); np.save(p2, np.asarray(I, np.float32))
    return video, f"{len(W)} rows", time.time() - t0


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in DATASETS:
        sys.exit(f"usage: python training/extract_pose.py {{{'|'.join(DATASETS)}}}")
    name = sys.argv[1]
    cfg, data = DATASETS[name], os.path.join(ROOT, "data", name)
    out = os.path.join(data, "mp")
    os.makedirs(out, exist_ok=True)
    json.dump({"stride": cfg["stride"], "model": os.path.basename(MODEL), "max_side": MAX_SIDE}, open(os.path.join(out, "meta.json"), "w"))
    videos = sorted(glob.glob(os.path.join(data, cfg["glob"])))
    if sys.argv[2:]:
        videos = [v for v in videos if os.path.basename(v).startswith(tuple(sys.argv[2:]))]
    if not videos:
        sys.exit(f"No videos in data/{name}: run the matching scripts/get_*.py first")
    jobs = [(v, os.path.join(out, cfg["name"](v)), cfg["stride"]) for v in videos]
    workers = max(1, min(8, (os.cpu_count() or 2) - 2))
    print(f"{len(jobs)} videos, {workers} workers, every {cfg['stride']} frame(s)")
    with Pool(workers) as pool:
        for k, (video, info, secs) in enumerate(pool.imap_unordered(extract, jobs), 1):
            if info != "cached":
                print(f"  [{k}/{len(jobs)}] {os.path.basename(video)}: {info} ({secs:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
