"""Compare metrics with target ranges and produce adjustment advice (tri-bike oriented)."""
import math

# (key, direction) -> advice text. direction: "low" = below range, "high" = above range
TEXT = {
    ("knee_flexion_bdc", "low"): "膝在 BDC 伸得太直 → 座墊偏高。降低座墊。",
    ("knee_flexion_bdc", "high"): "膝在 BDC 彎曲太多 → 座墊偏低。升高座墊。",
    ("hip_closed_tdc", "low"): "TDC 時髖角太閉(影響功率與呼吸)→ 抬高手墊、座墊前移/加大座管角,或換短曲柄(換後需重調座高)。",
    ("knee_elbow_gap_mm", "low"): "膝蓋離手肘太近(可能碰到)→ 手墊前移或抬高、或座墊後移。",
    ("shoulder_angle", "low"): "肩角太小(手肘收在肩膀下方偏後)→ 手墊前移或加長 reach。",
    ("shoulder_angle", "high"): "肩角太大(手臂伸得太前)→ 手墊後移或縮短 reach。",
    ("upper_arm_angle", "low"): "上臂向後傾 → 手墊偏後(手肘在肩膀後方),手墊可前移。",
    ("upper_arm_angle", "high"): "上臂向前傾太多 → 手墊太靠前,可把手墊後移。",
    ("torso_angle", "low"): "軀幹很平(<20°):空力好,但較易頸肩痠痛,確認能維持整場。",
    ("torso_angle", "high"): "軀幹偏高:若髖角與舒適度允許,可逐步降低手墊。",
    ("forearm_angle", "low"): "前臂往下傾:可考慮延伸把上翹 5–10° 起步。",
    ("forearm_angle", "high"): "前臂上翹角偏大:注意 UCI 約 30° 上限與側風時的空力。",
}
# 先處理座墊,再處理髖,最後手臂:一次只動一個變數
PRIORITY = ["knee_flexion_bdc", "hip_closed_tdc", "knee_elbow_gap_mm", "shoulder_angle", "upper_arm_angle"]
MIN_NOISE_DEG = 3.0  # 2D 姿態估計的典型誤差下限 (文獻 3-9°)


def _status(v, low, high):
    if low is None and high is None:
        return "tracked"
    if low is not None and v < low:
        return "low"
    if high is not None and v > high:
        return "high"
    return "ok"


def evaluate(result, ranges):
    items = []
    for key, r in ranges.items():
        m = result["metrics"].get(key)
        if not m:
            continue
        v = m["value"]
        low, high = r.get("low"), r.get("high")
        status = _status(v, low, high)
        noise = max(m["std"], MIN_NOISE_DEG) if r.get("unit") == "°" else m["std"]
        dev = 0.0
        if status in ("low", "high"):
            dev = low - v if status == "low" else v - high
        items.append(dict(key=key, label=r["label"], unit=r["unit"], value=v, std=m["std"], n=m["n"],
                          low=low, high=high, ideal=r.get("ideal"),
                          confidence=r["confidence"], role=r.get("role", "fix"), status=status, deviation=dev,
                          within_noise=status in ("low", "high") and dev <= noise))
    return items


def saddle_delta_mm(result, ranges):
    """Vertical-ish saddle change needed to bring BDC knee flexion to its ideal (law of cosines)."""
    g, px = result.get("geo"), result.get("px_per_mm")
    ideal = ranges.get("knee_flexion_bdc", {}).get("ideal")
    if not g or not px or ideal is None:
        return None
    a, b = g["thigh_px"], g["shank_px"]
    theta = math.radians(180 - ideal)
    d_target = math.sqrt(a * a + b * b - 2 * a * b * math.cos(theta))
    return (d_target - g["hip_ankle_px"]) / px


def _line(i):
    return dict(key=i["key"], text=TEXT.get((i["key"], i["status"]), ""), deviation=round(i["deviation"], 1),
                unit=i["unit"])


def advise(result, ranges):
    items = evaluate(result, ranges)
    off = [i for i in items if i["status"] in ("low", "high")]
    todo = [i for i in off if i["role"] == "fix"]
    todo.sort(key=lambda i: PRIORITY.index(i["key"]) if i["key"] in PRIORITY else 99)
    lines = [_line(i) for i in todo if not i["within_noise"]]
    hints = [_line(i) for i in off if i["role"] == "hint" and not i["within_noise"]]
    delta = saddle_delta_mm(result, ranges)
    out = dict(items=items, fix_first=lines[0] if lines else None, others=lines[1:], hints=hints,
               good=[i["label"] for i in items if i["status"] == "ok"],
               noise_note=[i["label"] for i in off if i["within_noise"]],
               saddle_delta_mm=None if delta is None else round(delta, 1))
    return out
