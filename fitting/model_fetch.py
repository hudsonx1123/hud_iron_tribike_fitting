"""Download the MediaPipe pose model on first use (not bundled with this repo)."""
import os
import urllib.request

URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
       "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task")
MIN_BYTES = 20 * 1024 * 1024


def ensure_model(path):
    """Make sure the model file exists; download it from Google's official MediaPipe storage if not."""
    if path.exists() and path.stat().st_size > MIN_BYTES:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    print(f"[HudIRON] Downloading pose model (~30 MB) from Google MediaPipe → {path}", flush=True)
    last = [-1]

    def hook(n, bs, total):
        if total > 0:
            pct = min(100, int(n * bs * 100 / total))
            if pct // 10 != last[0]:
                last[0] = pct // 10
                print(f"  {pct}%", flush=True)

    urllib.request.urlretrieve(URL, tmp, hook)
    if tmp.stat().st_size < MIN_BYTES:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("Model download looks incomplete; check your network and try again.")
    os.replace(tmp, path)
    return path
