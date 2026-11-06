// ---------- 空力指數 + 風洞示意 ----------
// 指數是依「側面姿勢角度」的經驗趨勢算出的啟發式分數(0–100,越高越空力),不是風洞或 CFD 結果:
// 軀幹越平、頭越貼著背線、手臂收得越緊,通常阻力越小。權重與門檻是假設值,
// 只適合拿來比較你自己各次紀錄(以及職業選手),不能換算成瓦數或秒數。
const AERO_ZONES = [
  { k: "torso", w: 0.5, lo: 10, hi: 40, name: "aero.torso" }, // 軀幹對水平 ≤10° 滿分、≥40° 零分
  { k: "head", w: 0.3, lo: 10, hi: 50, name: "aero.head" },   // 頭相對背線上抬 ≤10° 滿分、≥50° 零分
  { k: "arm", w: 0.2, lo: 85, hi: 125, name: "aero.arm" },    // 手肘角 ≤85° 滿分、≥125° 零分
];
const aeroClamp = (x) => Math.max(0, Math.min(1, x));
const aeroScore = (z, v) => aeroClamp(1 - (v - z.lo) / (z.hi - z.lo));
const aeroMedian = (a) => { const s = a.slice().sort((p, q) => p - q), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

// 單一影格的三個角度。L: (33,3) 正規化座標,ix: 該側的關節索引,facing: 1 = 面向右、-1 = 面向左
function aeroAngles(L, ix, facing, W, H) {
  const p = (k) => [L[ix[k]][0] * W, L[ix[k]][1] * H];
  const sh = p("shoulder"), hp = p("hip"), ear = p("ear"), el = p("elbow"), wr = p("wrist");
  const up = (a, b) => [(b[0] - a[0]) * facing, -(b[1] - a[1])]; // 前進方向為 +x、向上為 +y
  const deg = (v) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  const torso = deg(up(hp, sh));
  const head = ((deg(up(sh, ear)) - torso + 540) % 360) - 180;    // 頭相對背線延伸方向的上抬量
  const v1 = [sh[0] - el[0], sh[1] - el[1]], v2 = [wr[0] - el[0], wr[1] - el[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1e-9);
  const arm = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  return { torso, head, arm };
}

// 整段紀錄(有效範圍內)取中位角度 → 各區分數與指數
function aeroSession(lm, ix, facing, W, H, range) {
  const a = range ? range[0] : 0, b = range ? Math.min(range[1], lm.length - 1) : lm.length - 1;
  const per = { torso: [], head: [], arm: [] };
  for (let f = a; f <= b; f++) {
    const g = aeroAngles(lm[f], ix, facing, W, H);
    for (const k in per) if (isFinite(g[k])) per[k].push(g[k]);
  }
  if (!per.torso.length) return null;
  const zones = AERO_ZONES.map((z) => {
    const angle = aeroMedian(per[z.k]), score = aeroScore(z, angle);
    return { ...z, angle, score, loss: z.w * (1 - score) * 100 };
  });
  return { index: zones.reduce((s, z) => s + z.w * z.score, 0) * 100, zones, byKey: Object.fromEntries(zones.map((z) => [z.k, z])) };
}

// 發散色階(dataviz):暖橘紅(阻力大)→ 中性灰 → 冷藍(阻力小)。灰色放在 65 分(約為一般業餘騎士),
// 這樣你的分數偏低的區塊會偏暖、職業等級的區塊偏冷;若灰色放在 50 分,45 分左右幾乎看不出顏色。
const AERO_PIVOT = 0.65;
const AERO_RAMP = [[0, [226, 87, 38]], [AERO_PIVOT, [226, 224, 218]], [1, [42, 125, 225]]];
function aeroRGB(s) {
  s = aeroClamp(s);
  const i = s < AERO_PIVOT ? 0 : 1, [s0, c0] = AERO_RAMP[i], [s1, c1] = AERO_RAMP[i + 1], u = (s - s0) / (s1 - s0);
  return c0.map((v, j) => Math.round(v + (c1[j] - v) * u));
}
const AERO_NEUTRAL = [226, 224, 218], AERO_LEG = [150, 156, 166];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (c0, c1, u) => c0.map((v, j) => Math.round(v + (c1[j] - v) * u));

// ---------- 風洞動畫(示意:氣流繞過身體,顏色與尾流抖動依該區分數) ----------
const AERO = { on: false, cv: null, ctx: null, parts: [], raf: 0, last: 0, t: 0, sess: null };
const AERO_N = 100, AERO_TRAIL = 14; // 線條數:越少越簡潔

function aeroBody(W, H) {
  const P = pts(), q = (k) => [P[k][0] * W, P[k][1] * H];
  const sh = q("shoulder"), hp = q("hip"), ear = q("ear"), el = q("elbow"), wr = q("wrist"), kn = q("knee"), an = q("ankle");
  const Lt = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]) || 1;
  return [
    { z: "head", a: ear, b: ear, r: 0.2 * Lt },
    { z: "torso", a: sh, b: hp, r: 0.24 * Lt },
    { z: "arm", a: sh, b: el, r: 0.1 * Lt }, { z: "arm", a: el, b: wr, r: 0.09 * Lt },
    { z: "legs", a: hp, b: kn, r: 0.17 * Lt }, { z: "legs", a: kn, b: an, r: 0.1 * Lt },
  ];
}
function aeroSdf(x, y, c) { // → [到軸線距離, 單位外法向 nx, ny]
  const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], l2 = dx * dx + dy * dy;
  const u = l2 ? aeroClamp(((x - c.a[0]) * dx + (y - c.a[1]) * dy) / l2) : 0;
  const px = x - (c.a[0] + dx * u), py = y - (c.a[1] + dy * u), d = Math.hypot(px, py) || 1e-6;
  return [d, px / d, py / d];
}
const zoneScore = (z) => (AERO.sess && AERO.sess.byKey[z] ? AERO.sess.byKey[z].score : null); // legs → null(不計分)

// 風洞範圍:上游 2.5 倍身高、下游 3.5 倍身高;bt/bb = 身體最高/最低點(粒子在其上下各留一段)
function aeroWin(caps, facing) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  caps.forEach((c) => [c.a, c.b].forEach((q) => {
    x0 = Math.min(x0, q[0] - c.r); x1 = Math.max(x1, q[0] + c.r); y0 = Math.min(y0, q[1] - c.r); y1 = Math.max(y1, q[1] + c.r);
  }));
  const h = Math.max(40, y1 - y0), cx = (x0 + x1) / 2;
  return { h, bt: y0, bb: y1, up: cx + facing * 2.5 * h, down: cx - facing * 3.5 * h };
}

function aeroSpawn(p, win, anywhere) {
  p.x = anywhere ? win.down + Math.random() * (win.up - win.down) : win.up;
  p.y = win.bt - 0.6 * win.h + Math.random() * 2.1 * win.h;
  p.trail = []; p.touch = 0; p.turb = 0; p.s = null; p.ph = Math.random() * 6.28;
}

// 每顆粒子順著氣流前進,遇到身體就沿表面繞過;經過分數低的區塊,下游會抖動(尾流)、顏色轉暖
function aeroStep(dt, win, caps, facing) {
  const U = win.h * 3, wx = -facing;
  AERO.parts.forEach((p) => {
    let vx = wx * U, vy = 0, near = null;
    for (const c of caps) {
      const [d, nx, ny] = aeroSdf(p.x, p.y, c), gap = d - c.r, margin = c.r * 1.1 + 6;
      if (gap >= margin) continue;
      const k = 1 - Math.max(gap, 0) / margin;
      let tx = -ny, ty = nx;                                  // 沿表面的切線,朝氣流方向
      if (Math.abs(tx * wx) < 0.2) { if (ny < 0 !== ty < 0) { tx = -tx; ty = -ty; } } else if (tx * wx < 0) { tx = -tx; ty = -ty; }
      vx = vx * (1 - k) + tx * U * k + nx * U * 0.35 * k * k;
      vy = vy * (1 - k) + ty * U * k + ny * U * 0.35 * k * k;
      if (gap < 0) { p.x += nx * (1 - gap); p.y += ny * (1 - gap); }
      if (!near || gap < near.gap) near = { c, gap };
    }
    if (near) { p.touch = 1; p.s = zoneScore(near.c.z); p.turb = p.s == null ? 0.3 : 0.15 + 0.85 * (1 - p.s); } // 分數越低,尾流越亂
    p.touch *= Math.exp(-dt * 0.6); p.turb *= Math.exp(-dt * 1.0);
    vy += Math.sin(p.ph + AERO.t * 9 + p.x * 0.02) * U * 0.4 * p.turb;
    p.x += vx * dt; p.y += vy * dt;
    const tc = Math.min(1, p.touch * 1.4);
    p.trail.push([p.x, p.y, p.touch < 0.02 ? AERO_NEUTRAL : mix(AERO_NEUTRAL, p.s == null ? AERO_LEG : aeroRGB(p.s), tc), 0.45 + 0.5 * tc]);
    if (p.trail.length > AERO_TRAIL) p.trail.shift();
    if ((p.x - win.down) * facing < 0 || p.y < win.bt - 1.6 * win.h || p.y > win.bb + 1.5 * win.h) aeroSpawn(p, win, false);
  });
}

function aeroDraw(W, H, caps, facing, win) {
  const g = AERO.ctx, u = W / 1000;
  g.clearRect(0, 0, W, H);
  g.lineCap = "round"; g.lineJoin = "round";
  caps.forEach((c) => {                                         // 身體各區依分數上色
    const col = c.z === "legs" ? AERO_LEG : aeroRGB(zoneScore(c.z) ?? 0.5);
    g.strokeStyle = rgba(col, 0.38); g.lineWidth = c.r * 2;
    g.beginPath(); g.moveTo(c.a[0], c.a[1]); g.lineTo(c.b[0], c.b[1]); g.stroke();
  });
  AERO.parts.forEach((p) => {                                   // 氣流軌跡
    const sw = Math.max(2.2 * u, win.h * 0.018), tr = p.trail;
    if (tr.length < 2) return;
    g.strokeStyle = "rgba(0,0,0,.12)"; g.lineWidth = sw + 2 * u;           // 深色底線,亮暗背景都看得到
    g.beginPath(); g.moveTo(tr[0][0], tr[0][1]); for (let i = 1; i < tr.length; i++) g.lineTo(tr[i][0], tr[i][1]); g.stroke();
    g.lineWidth = sw;
    for (let i = 1; i < tr.length; i++) {
      g.strokeStyle = rgba(tr[i][2], tr[i][3] * (i / tr.length));
      g.beginPath(); g.moveTo(tr[i - 1][0], tr[i - 1][1]); g.lineTo(tr[i][0], tr[i][1]); g.stroke();
    }
  });
  // 區塊標籤(分數用文字再標一次,不只靠顏色);以各部位為錨點、依前進方向偏移,避免互相重疊
  const label = (cx, cy, txt) => {
    g.font = `600 ${15 * u}px sans-serif`; const w = g.measureText(txt).width + 8 * u, h = 21 * u;
    const x = Math.max(4, Math.min(W - w - 4, cx - w / 2)), y = Math.max(4, Math.min(H - h - 4, cy - h / 2));
    g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(x, y, w, h);
    g.fillStyle = "#fff"; g.fillText(txt, x + 4 * u, y + 15.5 * u);
  };
  const cap = (z, i = 0) => caps.filter((c) => c.z === z)[i], r = cap("torso").r, f = facing;
  const text = (z) => { const s = AERO.sess && AERO.sess.byKey[z]; return s ? `${t(s.name)} ${Math.round(s.score * 100)}` : t("aero.legs"); };
  const head = cap("head"), torso = cap("torso"), fore = cap("arm", 1), shank = cap("legs", 1);
  label(head.a[0] + f * 2.6 * r, head.a[1] - 3.6 * r, text("head"));
  label((torso.a[0] + torso.b[0]) / 2 - f * 3.2 * r, (torso.a[1] + torso.b[1]) / 2 - 3.6 * r, text("torso"));
  label(fore.b[0] + f * 1.5 * r, fore.b[1] + 2.8 * r, text("arm"));
  label(shank.b[0] - f * 3 * r, shank.b[1] + 2.5 * r, t("aero.legs"));
  // 圖例:低 ← → 高
  const lx = 16 * u, ly = H - 34 * u, lw = 190 * u, lh = 11 * u, gr = g.createLinearGradient(lx, 0, lx + lw, 0);
  AERO_RAMP.forEach(([s, c]) => gr.addColorStop(s, rgba(c, 1)));
  g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(lx - 8 * u, ly - 22 * u, lw + 16 * u, lh + 46 * u);
  g.fillStyle = "#fff"; g.font = `600 ${13 * u}px sans-serif`;
  g.fillText(`${t("aero.title")}${AERO.sess ? " " + Math.round(AERO.sess.index) : ""}`, lx, ly - 6 * u);
  g.fillStyle = gr; g.fillRect(lx, ly, lw, lh);
  g.fillStyle = "#fff"; g.font = `${12 * u}px sans-serif`;
  g.fillText(t("aero.low"), lx, ly + lh + 14 * u); g.textAlign = "right"; g.fillText(t("aero.high"), lx + lw, ly + lh + 14 * u); g.textAlign = "left";
}

function aeroLoop(now) {
  AERO.raf = 0;
  if (!AERO.on) return;
  AERO.raf = requestAnimationFrame(aeroLoop);
  if ($("#tab-analyze").hidden || !S.info || !S.lm || !S.info.width) return;
  const cvEl = $("#cv"), W = cvEl.width, H = cvEl.height;
  if (!W || !H) return;
  const facing = S.info.meta.facing || 1, cvA = AERO.cv;
  if (cvA.width !== W || cvA.height !== H) { cvA.width = W; cvA.height = H; AERO.parts = []; }
  const caps = aeroBody(W, H), win = aeroWin(caps, facing);
  while (AERO.parts.length < AERO_N) { const p = {}; aeroSpawn(p, win, true); AERO.parts.push(p); }
  const dt = Math.max(0, Math.min(0.05, (now - (AERO.last || now)) / 1000)); AERO.last = now; AERO.t += dt;
  aeroStep(dt, win, caps, facing);
  aeroDraw(W, H, caps, facing, win);
}

function aeroSetOn(on) {
  AERO.on = on;
  $("#b-aero").classList.toggle("on", on);
  if (!AERO.cv) {
    AERO.cv = document.createElement("canvas"); AERO.cv.id = "aero-cv"; AERO.ctx = AERO.cv.getContext("2d");
    $("#cv").parentElement.appendChild(AERO.cv);
  }
  AERO.cv.hidden = !on; AERO.parts = []; AERO.last = 0;
  if (!on) AERO.ctx.clearRect(0, 0, AERO.cv.width, AERO.cv.height);
  else if (!AERO.raf) AERO.raf = requestAnimationFrame(aeroLoop);
  if (S.info && S.lm) draw();
}
$("#b-aero").onclick = () => aeroSetOn(!AERO.on);

// 分析頁側欄的卡片;同時更新風洞用的分數(換紀錄、改範圍、拖曳關節後都會重算)
function aeroCard() {
  const m = S.info.meta, a = S.info.width && S.lm && aeroSession(S.lm, IDX[m.side], m.facing || 1, S.info.width, S.info.height, S.met && S.met.range);
  AERO.sess = a || null;
  if (!a) return "";
  const worst = a.zones.slice().sort((p, q) => q.loss - p.loss)[0];
  return `<div class="card"><div class="srow"><b>${t("aero.title")} <span class="aeronum">${Math.round(a.index)}</span> / 100</b></div>
    <table><tr><th></th><th class="num">${t("aero.angle")}</th><th class="num">${t("aero.score")}</th><th class="num">${t("aero.loss")}</th></tr>` +
    a.zones.map((z) => `<tr><td>${t(z.name)}</td><td class="num">${z.angle.toFixed(1)}°</td><td class="num">${Math.round(z.score * 100)}</td><td class="num ${z === worst && z.loss >= 5 ? "gapbig" : ""}">−${z.loss.toFixed(0)}</td></tr>`).join("") +
    `</table><p class="hint" style="margin:6px 0 0">${worst.loss >= 5 ? t("aero.worst", { z: t(worst.name), v: worst.loss.toFixed(0) }) : t("aero.noWorst")}</p>
    <p class="hint" style="margin:4px 0 0">${t("aero.note")}</p></div>`;
}
