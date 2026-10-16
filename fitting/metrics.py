"""Angles / distances per frame, pedal-cycle detection, per-session aggregates."""
import numpy as np

from .config import SIDES


def _angle(a, b, c):
    """Interior angle at b (deg), vectorized over frames. a,b,c: (n,2)."""
    v1, v2 = a - b, c - b
    cos = (v1 * v2).sum(-1) / (np.linalg.norm(v1, axis=-1) * np.linalg.norm(v2, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def series(lm, w, h, side, facing):
    """Per-frame arrays in pixel space. lm: (n,33,3) normalized."""
    ix = SIDES[side]
    px = lm[:, :, :2] * np.array([w, h])
    P = {k: px[:, v] for k, v in ix.items()}
    torso_v = P["shoulder"] - P["hip"]
    arm_v = P["elbow"] - P["shoulder"]
    fore_v = P["wrist"] - P["elbow"]
    return dict(
        knee_int=_angle(P["hip"], P["knee"], P["ankle"]),
        hip_int=_angle(P["shoulder"], P["hip"], P["knee"]),
        shoulder_int=_angle(P["hip"], P["shoulder"], P["elbow"]),
        elbow_int=_angle(P["shoulder"], P["elbow"], P["wrist"]),
        ankle_int=_angle(P["knee"], P["ankle"], P["toe"]),
        # 軀幹對水平:0=平躺,90=直立
        torso=np.degrees(np.arctan2(-torso_v[:, 1], torso_v[:, 0] * facing)),
        # 上臂偏離垂直:向前為正
        upper_arm=np.degrees(np.arctan2(arm_v[:, 0] * facing, arm_v[:, 1])),
        # 前臂對水平:手腕高於手肘為正
        forearm=np.degrees(np.arctan2(-fore_v[:, 1], fore_v[:, 0] * facing)),
        knee_elbow_px=np.linalg.norm(P["knee"] - P["elbow"], axis=-1),
        thigh_px=np.linalg.norm(P["hip"] - P["knee"], axis=-1),
        shank_px=np.linalg.norm(P["knee"] - P["ankle"], axis=-1),
        hip_ankle_px=np.linalg.norm(P["hip"] - P["ankle"], axis=-1),
        pedal_y=P["ankle"][:, 1] - P["hip"][:, 1],
    )


def _smooth(x, k=5):
    k = max(1, k | 1)
    pad = np.pad(x, k // 2, mode="edge")
    return np.convolve(pad, np.ones(k) / k, mode="valid")


def find_cycles(pedal_y, fps):
    """BDC = ankle lowest (max y), TDC = highest. Returns (bdc, tdc) frame index arrays."""
    if len(pedal_y) < 10:
        return np.array([], int), np.array([], int)
    s = _smooth(pedal_y, 5)
    lo, hi = np.percentile(s, 5), np.percentile(s, 95)
    rng, mid = hi - lo, np.median(s)
    win = max(2, int(0.2 * fps))

    def peaks(sign):
        sig = s * sign
        thr = mid * sign + 0.25 * rng
        out = []
        for i in range(len(sig)):
            a, b = max(0, i - win), min(len(sig), i + win + 1)
            if sig[i] >= sig[a:b].max() and sig[i] > thr:
                if not out or i - out[-1] > win:
                    out.append(i)
        return np.array(out, int)

    return peaks(1), peaks(-1)


def _agg(vals):
    vals = np.asarray(vals, float)
    vals = vals[np.isfinite(vals)]
    if len(vals) == 0:
        return None
    return dict(value=float(np.median(vals)), std=float(vals.std()), n=int(len(vals)))


def compute(lm, w, h, fps, side, facing, rng=None, px_per_mm=None):
    n = len(lm)
    a, b = (0, n - 1) if not rng else (max(0, rng[0]), min(n - 1, rng[1]))
    S = series(lm, w, h, side, facing)
    bdc, tdc = find_cycles(S["pedal_y"], fps)
    bdc = bdc[(bdc >= a) & (bdc <= b)]
    tdc = tdc[(tdc >= a) & (tdc <= b)]
    sl = slice(a, b + 1)

    m = {}
    m["knee_flexion_bdc"] = _agg(180 - S["knee_int"][bdc])
    m["ankle_angle_bdc"] = _agg(S["ankle_int"][bdc])
    # 閉合髖角:TDC 時的肩-髖-膝 (沿大腿量,40-45° 這類標準的量法)
    m["hip_closed_tdc"] = _agg(S["hip_int"][tdc])
    m["elbow_angle"] = _agg(S["elbow_int"][sl])
    m["shoulder_angle"] = _agg(S["shoulder_int"][sl])
    m["upper_arm_angle"] = _agg(S["upper_arm"][sl])
    m["forearm_angle"] = _agg(S["forearm"][sl])
    m["torso_angle"] = _agg(S["torso"][sl])
    if px_per_mm:
        m["knee_elbow_gap_mm"] = _agg(S["knee_elbow_px"][tdc] / px_per_mm)
        m["leg_extension_mm"] = _agg(S["hip_ankle_px"][bdc] / px_per_mm)
    cadence = None
    if len(bdc) >= 2:
        cadence = float(60.0 * fps / np.diff(bdc).mean())
    geo = None
    if len(bdc):
        geo = dict(thigh_px=float(np.median(S["thigh_px"][bdc])), shank_px=float(np.median(S["shank_px"][bdc])),
                   hip_ankle_px=float(np.median(S["hip_ankle_px"][bdc])),
                   knee_int=float(np.median(S["knee_int"][bdc])))
    return dict(metrics={k: v for k, v in m.items() if v}, bdc=bdc.tolist(), tdc=tdc.tolist(),
                cadence=cadence, geo=geo, px_per_mm=px_per_mm, range=[a, b])
