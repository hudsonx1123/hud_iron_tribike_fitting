// ---------- 職業選手對照 tab ----------
// 「選手」= 紀錄中 meta.pro === true 的 session(meta.short 為圓點代號,meta.lowconf 為低可信度指標)。
// 「你」= 其餘紀錄中由下拉選的一筆。數值取自各 session 的指標,新增紀錄後這個分頁會自動更新。
const PRO_METRICS = [
  { key: "knee_flexion_bdc", desc: "踏板最低點時膝蓋的彎曲量,反映座墊高度。數字越大,座墊越低。" },
  { key: "hip_closed_tdc", desc: "踏板最高點時肩、髖、膝的夾角,太小會影響呼吸與功率。" },
  { key: "shoulder_angle", desc: "軀幹與上臂的夾角,反映手墊離肩膀有多遠。" },
  { key: "upper_arm_angle", desc: "上臂對垂直線的角度,向前為正;0° 表示手肘在肩膀正下方。" },
  { key: "torso_angle", desc: "背部與水平線的夾角,越小越平、越省空氣阻力,也越吃柔軟度。" },
  { key: "forearm_angle", desc: "前臂相對水平的上翹量,由延伸把的傾角決定。" },
  { key: "elbow_angle", desc: "手肘的彎曲角度,只追蹤,沒有目標範圍。" },
];
const PRO_BIG_GAP = 8; // 小於此差距視為雜訊(追車鏡頭與固定機位的系統誤差)
let PROS = { sessions: null, fields: null, youId: null };

async function loadPros() {
  const [ss, fl] = await Promise.all([fetch("/api/sessions").then((r) => r.json()), PROS.fields || fetch("/api/fields").then((r) => r.json())]);
  PROS.sessions = ss.filter((s) => s.status === "ready" && s.summary);
  PROS.fields = fl;
  const mine = PROS.sessions.filter((s) => !s.pro).sort((a, b) => a.created.localeCompare(b.created));
  if (!mine.some((s) => s.id === PROS.youId)) PROS.youId = mine.length ? mine[mine.length - 1].id : null;
  $("#pros-you").innerHTML = mine.map((s) => `<option value="${s.id}" ${s.id === PROS.youId ? "selected" : ""}>${esc(s.name)}(${esc(s.created.slice(0, 10))})</option>`).join("");
  renderPros();
}

function prosColors() {
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
  return { you: g("--you") || "#e2561f", pro: g("--acc"), mut: g("--mut"), line: g("--line"), card: g("--card"), band: g("--okbg") || "#cfe7e2", bandLine: g("--ok") };
}

function prosStack(items, minGap) { // 垂直分層,避免圓點重疊
  const lanes = [], out = [];
  items.slice().sort((a, b) => a.x - b.x).forEach((it) => {
    let l = 0;
    while (lanes[l] !== undefined && it.x - lanes[l] < minGap) l++;
    lanes[l] = it.x; out.push({ it, l });
  });
  return out;
}

function prosStrip(m, you, pros, rng, w, C) {
  const padL = 18, padR = 18, top = 18, R = 11, laneH = 26;
  const vals = [you.val, ...pros.map((p) => p.val)];
  if (rng) { if (rng.low != null) vals.push(rng.low); if (rng.high != null) vals.push(rng.high); }
  const step = Math.max(...vals) - Math.min(...vals) > 60 ? 20 : Math.max(...vals) - Math.min(...vals) > 30 ? 10 : 5;
  const min = Math.floor((Math.min(...vals) - 3) / step) * step, max = Math.ceil((Math.max(...vals) + 3) / step) * step;
  const x = (v) => padL + ((v - min) / (max - min)) * (w - padL - padR);
  const pts = [{ k: "你", val: you.val, you: 1, name: "你" }, ...pros].map((p) => ({ ...p, x: x(p.val) }));
  const st = prosStack(pts, R * 2 + 2), lanes = Math.max(...st.map((s) => s.l)) + 1;
  const axisY = top + lanes * laneH + 8, H = axisY + 22;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(m.label)}">`;
  if (rng && (rng.low != null || rng.high != null)) {
    const a = rng.low == null ? min : Math.max(min, rng.low), b = rng.high == null ? max : Math.min(max, rng.high);
    s += `<rect x="${x(a)}" y="${top - 8}" width="${Math.max(2, x(b) - x(a))}" height="${axisY - top + 8}" fill="${C.band}" stroke="${C.bandLine}" stroke-opacity=".5" rx="3"/>`;
  }
  s += `<line x1="${padL}" x2="${w - padR}" y1="${axisY}" y2="${axisY}" stroke="${C.line}"/>`;
  for (let t = Math.ceil(min / step) * step; t <= max; t += step)
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${axisY}" y2="${axisY + 4}" stroke="${C.mut}"/><text x="${x(t)}" y="${axisY + 16}" text-anchor="middle" fill="${C.mut}" font-size="11">${t}°</text>`;
  st.forEach(({ it, l }) => {
    const cy = top + l * laneH + R / 2, col = it.you ? C.you : C.pro;
    s += `<line x1="${it.x}" x2="${it.x}" y1="${cy}" y2="${axisY}" stroke="${col}" stroke-opacity=".35" stroke-dasharray="2 3"/>`;
    s += `<circle cx="${it.x}" cy="${cy}" r="${it.you ? R + 2 : R}" fill="${it.low ? C.card : col}" stroke="${col}" stroke-width="${it.low ? 1.8 : 0}"/>`;
    s += `<text x="${it.x}" y="${cy + 4}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${it.low ? col : "#fff"}">${esc(it.k)}</text>`;
    s += `<title>${esc(it.name)}: ${it.val.toFixed(1)}°${it.low ? "(可信度低)" : ""}</title>`;
  });
  return s + "</svg>";
}

function prosMedian(a) {
  const s = a.slice().sort((p, q) => p - q), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}


// 依你與選手中位的差距(>= PRO_BIG_GAP)產生調整順序;小於門檻一律視為雜訊、不動。
function prosPlan(rows, you) {
  const by = Object.fromEntries(rows.map((x) => [x.pm.key, x]));
  const d = (k) => (by[k] ? by[k].yv - by[k].med : null);
  const inR = (k) => by[k] && (by[k].r.low == null || by[k].yv >= by[k].r.low) && (by[k].r.high == null || by[k].yv <= by[k].r.high);
  const big = (k) => d(k) != null && Math.abs(d(k)) >= PRO_BIG_GAP;
  const f = (k) => by[k].yv.toFixed(1), m = (k) => by[k].med.toFixed(1);
  const steps = [];
  // 1. 座高 / 髖角
  if (by.knee_flexion_bdc && by.hip_closed_tdc) {
    const dev = (k) => { const x = by[k]; return x.r.low != null && x.yv < x.r.low ? x.r.low - x.yv : x.r.high != null && x.yv > x.r.high ? x.yv - x.r.high : 0; };
    const kd = dev("knee_flexion_bdc"), hd = dev("hip_closed_tdc"), NOISE = 3; // 2D 姿態估計誤差下限約 3°
    const note = (k, v) => (v > 0 ? `${k}離目標 ${v.toFixed(1)}°` : "");
    if (kd > NOISE || hd > NOISE) steps.push({ t: "go", h: "先處理座高 / 髖角", p: `膝角 ${f("knee_flexion_bdc")}° 或髖角 ${f("hip_closed_tdc")}° 明顯超出目標範圍,請先照「分析」分頁的建議處理,再回頭比較手臂。` });
    else steps.push({ t: "hold", h: "座高與髖角", p: `膝角 ${f("knee_flexion_bdc")}°、髖角 ${f("hip_closed_tdc")}°。${[note("膝角", kd), note("髖角", hd)].filter(Boolean).join("、")}${kd || hd ? ",小於量測誤差(約 3°)," : "都在目標範圍內,"}不用動。` });
  }
  // 2. 前臂上翹
  if (by.forearm_angle) {
    const x = d("forearm_angle");
    steps.push(big("forearm_angle") && x < 0 ? { t: "go", h: "延伸把上翹 5–10°", p: `前臂上翹你是 ${f("forearm_angle")}°,選手中位 ${m("forearm_angle")}°。改動可還原,先做這個,改完重拍。` }
      : big("forearm_angle") ? { t: "go", h: "檢查前臂上翹是否過大", p: `你 ${f("forearm_angle")}°,比選手中位 ${m("forearm_angle")}° 大很多;注意 UCI 約 30° 上限與側風時的空力。` }
      : { t: "hold", h: "前臂上翹", p: `你 ${f("forearm_angle")}°,與選手中位 ${m("forearm_angle")}° 的差距在誤差內,不動。` });
  }
  // 3. 軀幹角
  if (by.torso_angle) {
    const x = d("torso_angle"), hipRoom = by.hip_closed_tdc && by.hip_closed_tdc.r.low != null ? by.hip_closed_tdc.yv - by.hip_closed_tdc.r.low : null;
    if (big("torso_angle") && x > 0) {
      const tight = hipRoom != null && hipRoom < 5;
      steps.push(tight ? { t: "hold", h: "軀幹角:先不要再降手墊", p: `軀幹 ${f("torso_angle")}° 比選手中位 ${m("torso_angle")}° 高,但髖角只剩 ${hipRoom.toFixed(1)}° 就碰到底線,降手墊會擠壓髖部;先考慮座墊前移或較短曲柄。` }
        : { t: "go", h: "手墊每次降 5–10 mm", p: `軀幹 ${f("torso_angle")}°,選手中位 ${m("torso_angle")}°。${hipRoom != null ? `髖角還有 ${hipRoom.toFixed(1)}° 的空間,降到接近目標下限就停;` : ""}出現下背痠痛或呼吸變淺就退回一步。` });
    } else if (big("torso_angle")) steps.push({ t: "hold", h: "軀幹角", p: `你 ${f("torso_angle")}° 比選手中位 ${m("torso_angle")}° 低很多,已經很平,確認能維持整場。` });
    else steps.push({ t: "hold", h: "軀幹角", p: `你 ${f("torso_angle")}°,與選手中位 ${m("torso_angle")}° 差距在誤差內,不動。` });
  }
  // 4. 手肘角(跟著變)
  if (by.elbow_angle) steps.push(big("elbow_angle") ? { t: "follow", h: "手肘角", p: `你 ${f("elbow_angle")}°,選手中位 ${m("elbow_angle")}°。通常隨前臂與軀幹調整一起變小,不單獨調。` }
    : { t: "hold", h: "手肘角", p: `你 ${f("elbow_angle")}°,與選手中位差距在誤差內。` });
  // 5. 上臂角
  if (by.upper_arm_angle) steps.push({ t: "hold", h: "上臂角", p: `你 ${f("upper_arm_angle")}°${inR("upper_arm_angle") ? "" : "(超出你的目標範圍)"},選手中位 ${m("upper_arm_angle")}°。選手之間分兩種風格(手肘在肩下 / 手肘在肩前),除非肩頸痠痛,否則不追。` });
  let n = 0;
  return steps.map((s) => ({ ...s, tag: s.t === "go" ? `第 ${++n} 步` : s.t === "follow" ? "跟著變" : "不動" }));
}

function renderPros() {
  const out = $("#pros-out");
  const you = PROS.sessions.find((s) => s.id === PROS.youId);
  const pros = PROS.sessions.filter((s) => s.pro);
  if (!you || !pros.length) {
    out.innerHTML = `<div class="card"><p>還沒有可比較的資料。需要至少一筆自己的紀錄,以及一筆標記為職業選手(<code>pro: true</code>)的紀錄。</p></div>`;
    return;
  }
  const C = prosColors(), ranges = PROS.fields.ranges;
  const w = Math.max(280, out.clientWidth - 30);
  const rows = PRO_METRICS.map((pm) => {
    const r = ranges[pm.key] || {};
    const yv = you.summary[pm.key];
    const pv = pros.filter((p) => p.summary[pm.key] != null).map((p) => ({ k: p.short || p.name[0], val: p.summary[pm.key], low: (p.lowconf || []).includes(pm.key), name: p.name }));
    if (yv == null || !pv.length) return null;
    return { pm, r, yv, pv, med: prosMedian(pv.map((p) => p.val)) };
  }).filter(Boolean);
  const label = (x) => x.r.label || x.pm.key;
  const tg = (r) => (r.low == null && r.high == null ? "追蹤,沒有目標範圍" : r.high == null ? `目標 ≥ ${r.low}°` : r.low == null ? `目標 ≤ ${r.high}°` : `目標 ${r.low}–${r.high}°`);

  let h = `<div class="legend"><span><i class="pchip you">你</i>${esc(you.name)}</span>` +
    pros.map((p) => `<span><i class="pchip">${esc(p.short || "?")}</i>${esc(p.name.replace(/\s*\(.*\)$/, ""))}</span>`).join("") +
    `<span><i class="pchip low">?</i>可信度低</span><span><i class="pband"></i>你的目標範圍</span></div>`;

  const gaps = rows.map((x) => ({ x, d: x.yv - x.med })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const big = gaps.filter((g) => Math.abs(g.d) >= PRO_BIG_GAP);
  h += `<div class="card"><b>差距總覽</b><p class="hint" style="margin:4px 0 0">${big.length
    ? "與選手中位差 " + PRO_BIG_GAP + "° 以上(較可信的差距):" + big.map((g) => `${esc(label(g.x))} <b class="gapbig">${g.d > 0 ? "+" : ""}${g.d.toFixed(1)}°</b>`).join("、")
    : "所有項目與選手中位的差距都小於 " + PRO_BIG_GAP + "°,視為雜訊。"}</p></div>`;

  h += rows.map((x) => {
    const d = x.yv - x.med, bigGap = Math.abs(d) >= PRO_BIG_GAP;
    const inRange = (x.r.low == null || x.yv >= x.r.low) && (x.r.high == null || x.yv <= x.r.high);
    return `<div class="card prow"><div class="srow"><b>${esc(label(x))}</b><span class="hint">你 ${x.yv.toFixed(1)}° · 選手中位 ${x.med.toFixed(1)}° · <span class="${bigGap ? "gapbig" : ""}">差 ${d > 0 ? "+" : ""}${d.toFixed(1)}°</span></span></div>
      <div class="hint">${esc(x.pm.desc)} ${tg(x.r)}${x.r.high != null || x.r.low != null ? (inRange ? "(你在範圍內)" : "(你超出範圍)") : ""}</div>
      ${prosStrip(x.pm, { val: x.yv }, x.pv, x.r, w, C)}</div>`;
  }).join("");

  h += `<div class="card scroll"><table><tr><th>指標</th><th class="num">你</th>` + pros.map((p) => `<th class="num" title="${esc(p.name)}">${esc(p.short || "?")}</th>`).join("") + `<th class="num">選手中位</th><th class="num">差距</th></tr>` +
    rows.map((x) => {
      const d = x.yv - x.med;
      return `<tr><td>${esc(label(x))}</td><td class="num yourv">${x.yv.toFixed(1)}</td>` +
        pros.map((p) => { const v = p.summary[x.pm.key]; return `<td class="num ${(p.lowconf || []).includes(x.pm.key) ? "lowv" : ""}">${v == null ? "—" : v.toFixed(1)}</td>`; }).join("") +
        `<td class="num">${x.med.toFixed(1)}</td><td class="num ${Math.abs(d) >= PRO_BIG_GAP ? "gapbig" : ""}">${d > 0 ? "+" : ""}${d.toFixed(1)}°</td></tr>`;
    }).join("") + `</table></div>`;

  h += `<div class="card"><b>調整順序</b><p class="hint" style="margin:4px 0 8px">一次只動一個變數,改完用同樣的拍攝條件重拍,看數字有沒有變、人舒不舒服,再做下一步。</p><ol class="plan">` +
    prosPlan(rows, you).map((st) => `<li><span class="ptag ${st.t}">${esc(st.tag)}</span><div><b>${esc(st.h)}</b><div class="hint">${esc(st.p)}</div></div></li>`).join("") + `</ol></div>`;

  h += `<div class="card"><b>資料的限制</b><ul class="hint" style="margin:6px 0 0;padding-left:1.2em">
    <li>選手都是追車轉播鏡頭,不是固定機位,鏡頭旋轉與斜拍會帶來幾度的誤差,所以只看 ${PRO_BIG_GAP}° 以上的差距。</li>
    <li>空心圓(斜體數字)表示該數字可信度低,例如偏俯視的畫面、腳踝被截在畫面外、或有效週期太少。</li>
    <li>選手的身高、柔軟度和車款都和你不同,這些角度是方向參考,不是你的目標值。</li>
    <li>調整時一次只動一個變數;髖角降到接近 40° 就停。選手資料取自 Kona 轉播截取,僅供個人姿勢研究。</li></ul></div>`;
  out.innerHTML = h;
}

$("#pros-you").onchange = (e) => { PROS.youId = e.target.value; renderPros(); };
let _prosRt;
addEventListener("resize", () => { if (!$("#tab-pros").hidden) { clearTimeout(_prosRt); _prosRt = setTimeout(renderPros, 120); } });
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (PROS.sessions && !$("#tab-pros").hidden) renderPros(); });
if (location.hash === "#pros") showTab("pros");
