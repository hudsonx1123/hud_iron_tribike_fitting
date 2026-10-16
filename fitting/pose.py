"""Run MediaPipe PoseLandmarker over a video; save frames (jpeg) and normalized landmarks."""
import traceback

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

from . import store
from .config import MAX_FRAME_WIDTH, MODEL, SIDES


def analyze(sid, video_path):
    meta = store.get_meta(sid)
    try:
        meta.update(status="analyzing", progress=0.0, error=None)
        store.save_meta(sid, meta)

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError("無法開啟影片")
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

        opts = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL)),
            running_mode=vision.RunningMode.VIDEO,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        frames, w, h = [], None, None
        fdir = store.sdir(sid) / "frames"
        with vision.PoseLandmarker.create_from_options(opts) as lmk:
            i = 0
            while True:
                ok, img = cap.read()
                if not ok:
                    break
                if img.shape[1] > MAX_FRAME_WIDTH:
                    s = MAX_FRAME_WIDTH / img.shape[1]
                    img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
                h, w = img.shape[:2]
                cv2.imwrite(str(fdir / f"{i:05d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
                rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
                res = lmk.detect_for_video(rgb, int(i * 1000 / fps))
                if res.pose_landmarks:
                    frames.append([[p.x, p.y, p.visibility] for p in res.pose_landmarks[0]])
                else:
                    frames.append(None)
                i += 1
                if i % 10 == 0:
                    meta["progress"] = min(0.99, i / total)
                    store.save_meta(sid, meta)
        cap.release()

        if not any(f is not None for f in frames):
            raise RuntimeError("整支影片都偵測不到人")
        # 偵測失敗的影格:沿用最近一次偵測,vis 設極低以便辨識
        last = next(f for f in frames if f is not None)
        for k, f in enumerate(frames):
            if f is None:
                frames[k] = [[x, y, 0.01] for x, y, _ in last]
            else:
                last = f
        store.write_json(store.sdir(sid) / "pose.json",
                         dict(fps=fps, width=w, height=h, n=len(frames), frames=frames))
        store.invalidate(sid)
        lm = store.effective_landmarks(sid)
        side = meta.get("side") or store.detect_side(lm)
        meta.update(status="ready", progress=1.0, side=side, facing=store.detect_facing(lm, side))
        store.save_meta(sid, meta)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        meta = store.get_meta(sid)
        meta.update(status="error", error=str(e))
        store.save_meta(sid, meta)
