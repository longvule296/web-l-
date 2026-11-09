/* =============================================================
   script.js — Digital Love Letter (cinematic)
   -------------------------------------------------------------
   ⭐ CHỈNH NHANH: xem khối CONFIG ngay bên dưới
      (tên, nội dung thư, màu sắc, thời gian, số lượng particle)

   Cấu trúc:
     0. CONFIG
     1. Helpers, easing, tween & timeline
     2. Sprites (vẽ sẵn → vẽ cực nhanh)
     3. Canvas, kích thước, ngân sách particle
     4. Particle pool (burst, click, trail)
     5. Nền: bụi sáng nhiều lớp chiều sâu + tim nhỏ
     6. Trái tim lớn 3D + particle tạo hình + tia sáng
     7. Heart burst
     8. Con trỏ / chạm / parallax
     9. Âm thanh (Web Audio, không cần file)
    10. Luồng trải nghiệm: nhập tên → ánh sáng → tim → burst
        → tên → phong thư → bức thư
    11. Vòng lặp requestAnimationFrame
   ============================================================= */
(() => {
  'use strict';

  /* =========================================================
     0. CONFIG — chỉnh ở đây
     ========================================================= */
  const CONFIG = {
    // Đặt một tên cố định (vd 'Lan') để bỏ qua tên người dùng nhập. null = dùng tên nhập.
    forceName: null,

    // ---- NỘI DUNG THƯ ----
    // {name} sẽ được thay bằng tên người nhận. Dòng rỗng '' = khoảng trống giữa các đoạn.
    letter: {
      greeting: 'Dear {name} 💗',
      lines: [
        'Cảm ơn vì đã xuất hiện trong thế giới này.',
        'Mong rằng hôm nay của bạn sẽ thật dịu dàng,',
        'và luôn có những điều nhỏ bé khiến bạn mỉm cười.',
        '',
        'Nếu có lúc nào đó thấy mệt, hãy nhớ rằng',
        'luôn có một góc nhỏ ở đây dành cho bạn.'
      ],
      signature: 'Gửi bạn, với thật nhiều yêu thương ✨'   // '' = không hiển thị
    },

    // ---- THỜI GIAN (giây) ----
    time: {
      light: 4.2,        // ánh sáng ở giữa mạnh dần
      formStart: 2.8,    // lúc các hạt bắt đầu tụ thành trái tim (tính từ khi nhấn "Mở ra")
      form: 2.8,         // thời gian tạo hình trái tim
      hold: 2.0,         // trái tim đập nhịp trước khi phát sáng mạnh
      glow: 1.5,         // thời gian phát sáng mạnh trước khi burst
      nameDelay: 1.3,    // từ burst đến lúc hiện lời chào
      nameHold: 4.6      // lời chào hiển thị bao lâu trước khi hiện phong thư
    },

    // ---- SỐ LƯỢNG PARTICLE (bản desktop; điện thoại/tablet tự giảm) ----
    count: {
      dust: 230,            // bụi sáng nền (nhiều lớp chiều sâu)
      bokeh: 10,            // đốm bokeh lớn mờ
      ambientHearts: 12,    // tim nhỏ trôi nền
      formParticles: 280,   // hạt tạo hình + bao quanh trái tim lớn
      burstHearts: 70,      // tim nhỏ khi burst
      burstSparks: 70       // sparkle khi burst
    },

    // ---- MÀU (RGB) ----
    colors: {
      dust:  ['255,70,90', '255,125,175', '255,150,80', '255,255,255'],   // đỏ, hồng, cam, trắng
      hearts: [['#ff7a9c', '#ff2d6a'], ['#ffc2d6', '#ff7dae'], ['#ffffff', '#ffd0e0'], ['#ffb07a', '#ff5a5f']]
    },

    // ---- GÕ CHỮ (ms) ----
    typing: { speed: 42, linePause: 520 },

    // Nhịp tim (lần/giây) và biên độ phóng to/thu nhỏ
    heartbeat: { rate: 0.95, amp: 0.045 }
  };

  /* =========================================================
     1. HELPERS, EASING, TWEEN & TIMELINE
     ========================================================= */
  const $ = (s, r = document) => r.querySelector(s);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceMQ.matches;
  const onReduce = (e) => { reduced = e.matches; };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduce);
  else if (reduceMQ.addListener) reduceMQ.addListener(onReduce);

  // Thời lượng tự rút ngắn nếu người dùng bật "giảm chuyển động"
  const d = (sec) => sec * (reduced ? 0.4 : 1);

  // Trạng thái cảnh (được tween bởi timeline)
  const S = {
    light: 0,        // ánh sáng trung tâm 0..1
    particleA: 0.3,  // độ hiện của bụi sáng
    emit: 0,         // tốc độ phát hạt xoáy (hạt/giây)
    heartForm: 0,    // tiến độ các hạt tụ thành tim 0..1
    heartA: 0,       // độ hiện của thân trái tim
    glow: 1,         // cường độ phát sáng của tim
    beatRate: CONFIG.heartbeat.rate,
    diss: 0,         // trái tim tan ra 0..1
    flare: 0,        // ánh chớp trung tâm
    hearts: 0.25,    // độ hiện của tim nhỏ nền
    burstDone: false
  };

  let clock = 0;                 // giờ của cảnh (giây) — dừng khi tab ẩn
  const tweens = [], timers = [];

  /** Tween một thuộc tính của S */
  function tw(key, to, dur, ease = easeInOut, delay = 0) {
    tweens.push({ key, from: null, to, dur: Math.max(dur, 0.0001), delay, t: 0, ease });
  }
  /** Chạy fn sau `sec` giây (theo giờ cảnh) */
  function at(sec, fn) { timers.push({ t: clock + sec, fn }); }

  function stepTimeline(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const w = tweens[i];
      w.t += dt;
      if (w.t < w.delay) continue;
      if (w.from === null) w.from = S[w.key];
      const k = clamp((w.t - w.delay) / w.dur, 0, 1);
      S[w.key] = w.from + (w.to - w.from) * w.ease(k);
      if (k >= 1) tweens.splice(i, 1);
    }
    for (let i = timers.length - 1; i >= 0; i--) {
      if (clock >= timers[i].t) { const f = timers[i].fn; timers.splice(i, 1); f(); }
    }
  }

  /* =========================================================
     2. SPRITES — vẽ sẵn một lần
     ========================================================= */
  const mk = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; return c; };
  const rgba = (rgb, a) => `rgba(${rgb},${a})`;

  // Đường cong trái tim chuẩn (toán học) — dùng chung cho sprite & hạt tạo hình
  const hx = (t) => 16 * Math.pow(Math.sin(t), 3);
  const hy = (t) => 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  const HY_OFFSET = 2.5;   // dịch để trái tim nằm giữa

  function traceHeart(g, cx, cy, u, n = 160) {
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * TAU;
      const x = cx + hx(t) * u, y = cy - (hy(t) + HY_OFFSET) * u;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  }

  function softDot(rgb) {
    const c = mk(128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(rgb, 1)); gr.addColorStop(0.25, rgba(rgb, 0.55));
    gr.addColorStop(0.6, rgba(rgb, 0.12)); gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return c;
  }
  function crispDot(rgb) {
    const c = mk(64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.14, rgba(rgb, 1));
    gr.addColorStop(0.4, rgba(rgb, 0.3)); gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  function sparkle(rgb) {
    const c = mk(64), g = c.getContext('2d'), r = 20;
    g.translate(32, 32); g.shadowColor = rgba(rgb, 1); g.shadowBlur = 10; g.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) {
      g.beginPath(); g.moveTo(0, -r);
      g.quadraticCurveTo(0, 0, r, 0); g.quadraticCurveTo(0, 0, 0, r);
      g.quadraticCurveTo(0, 0, -r, 0); g.quadraticCurveTo(0, 0, 0, -r); g.fill();
    }
    return c;
  }
  function smallHeart(c1, c2) {
    const s = 96, c = mk(s), g = c.getContext('2d'), u = (s * 0.62) / 32;
    g.shadowColor = c2; g.shadowBlur = 12;
    const gr = g.createLinearGradient(20, 20, 76, 76);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; traceHeart(g, s / 2, s / 2, u, 80); g.fill();
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath(); g.ellipse(s * 0.37, s * 0.37, 7, 4, -0.6, 0, TAU); g.fill();
    return c;
  }

  /** Trái tim lớn: thân (gradient + đổ bóng + texture + viền sáng), lớp bóng gương, lớp glow */
  function buildBigHeart() {
    const S0 = 640, u = (S0 * 0.8) / 32, cx = S0 / 2, cy = S0 / 2;

    // --- thân tim ---
    const base = mk(S0), g = base.getContext('2d');
    traceHeart(g, cx, cy, u, 240);
    let gr = g.createRadialGradient(S0 * 0.38, S0 * 0.32, S0 * 0.02, S0 * 0.5, S0 * 0.5, S0 * 0.62);
    gr.addColorStop(0, '#ff8aa8'); gr.addColorStop(0.25, '#ff3a6e'); gr.addColorStop(0.6, '#d11449');
    gr.addColorStop(0.85, '#8a0a33'); gr.addColorStop(1, '#4a0520');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    // bóng đổ phía dưới-phải → cảm giác khối 3D
    gr = g.createRadialGradient(S0 * 0.66, S0 * 0.74, S0 * 0.05, S0 * 0.66, S0 * 0.74, S0 * 0.5);
    gr.addColorStop(0, 'rgba(30,0,12,.6)'); gr.addColorStop(1, 'rgba(30,0,12,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S0, S0);
    // rãnh giữa hai thùy
    gr = g.createLinearGradient(S0 * 0.44, 0, S0 * 0.56, 0);
    gr.addColorStop(0, 'rgba(70,0,25,0)'); gr.addColorStop(0.5, 'rgba(70,0,25,.45)'); gr.addColorStop(1, 'rgba(70,0,25,0)');
    g.fillStyle = gr; g.fillRect(S0 * 0.44, S0 * 0.18, S0 * 0.12, S0 * 0.32);
    // ánh hồng ấm từ bên dưới
    gr = g.createRadialGradient(S0 * 0.5, S0 * 0.62, 0, S0 * 0.5, S0 * 0.62, S0 * 0.38);
    gr.addColorStop(0, 'rgba(255,90,130,.35)'); gr.addColorStop(1, 'rgba(255,90,130,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S0, S0);
    // texture hạt mịn
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(255,${(180 + Math.random() * 60) | 0},200,${rand(0.02, 0.08)})`;
      g.beginPath(); g.arc(rand(0, S0), rand(0, S0), rand(0.6, 2.2), 0, TAU); g.fill();
    }
    // viền sáng bên trong (rim light)
    g.lineWidth = S0 * 0.035; g.strokeStyle = 'rgba(255,170,195,.55)';
    g.shadowColor = 'rgba(255,120,160,.9)'; g.shadowBlur = S0 * 0.03;
    traceHeart(g, cx, cy, u, 240); g.stroke();
    g.restore();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,210,225,.5)'; traceHeart(g, cx, cy, u, 240); g.stroke();

    // --- lớp bóng gương (dịch chuyển khi tim "xoay") ---
    const spec = mk(S0), h = spec.getContext('2d');
    h.save(); traceHeart(h, cx, cy, u, 240); h.clip();
    const gloss = (x, y, rx, ry, rot, a) => {
      h.save(); h.translate(x, y); h.rotate(rot); h.scale(1, ry / rx);
      const gg = h.createRadialGradient(0, 0, 0, 0, 0, rx);
      gg.addColorStop(0, `rgba(255,255,255,${a})`); gg.addColorStop(1, 'rgba(255,255,255,0)');
      h.fillStyle = gg; h.beginPath(); h.arc(0, 0, rx, 0, TAU); h.fill(); h.restore();
    };
    gloss(S0 * 0.32, S0 * 0.3, S0 * 0.13, S0 * 0.07, -0.7, 0.85);
    gloss(S0 * 0.68, S0 * 0.3, S0 * 0.1, S0 * 0.05, 0.7, 0.4);
    gloss(S0 * 0.28, S0 * 0.26, S0 * 0.035, S0 * 0.02, -0.7, 1);
    gloss(S0 * 0.5, S0 * 0.8, S0 * 0.2, S0 * 0.05, 0, 0.16);
    h.restore();

    // --- glow (tim + shadowBlur lớn) ---
    const S2 = 960, glow = mk(S2), k = glow.getContext('2d');
    const u2 = (S2 * 0.8 / 32) / 1.5;
    k.shadowColor = 'rgba(255,60,120,1)'; k.shadowBlur = 90; k.fillStyle = 'rgba(255,50,110,.9)';
    traceHeart(k, S2 / 2, S2 / 2, u2, 200); k.fill(); k.fill();

    return { base, spec, glow };
  }

  function raySprite() {
    const c = mk(256), g = c.getContext('2d');
    c.width = 16; c.height = 256;
    let gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(255,200,220,.9)'); gr.addColorStop(0.5, 'rgba(255,90,140,.35)'); gr.addColorStop(1, 'rgba(255,60,120,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
    g.globalCompositeOperation = 'destination-in';
    gr = g.createLinearGradient(0, 0, 16, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
    return c;
  }

  function lightSprite() {
    const c = mk(512), g = c.getContext('2d');
    const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,225,235,.95)');
    gr.addColorStop(0.22, 'rgba(255,120,160,.6)'); gr.addColorStop(0.5, 'rgba(255,40,90,.22)');
    gr.addColorStop(1, 'rgba(255,20,70,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    return c;
  }

  const palette = CONFIG.colors.dust;
  const SPR = {
    soft: palette.map(softDot),
    crisp: palette.map(crispDot),
    spark: palette.map(sparkle),
    heart: CONFIG.colors.hearts.map(([a, b]) => smallHeart(a, b)),
    big: buildBigHeart(),
    ray: raySprite(),
    light: lightSprite()
  };

  /* =========================================================
     3. CANVAS, KÍCH THƯỚC, NGÂN SÁCH
     ========================================================= */
  const sceneC = $('#scene'), fxC = $('#fx');
  const sc = sceneC.getContext('2d'), fx = fxC.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const HG = { cx: 0, cy: 0, size: 300, u: 300 / 32 };   // hình học trái tim lớn

  // Điện thoại < tablet < desktop
  const qScale = () => (W < 700 ? 0.45 : W < 1100 ? 0.75 : 1) * (reduced ? 0.5 : 1);

  function drawSprite(ctx, img, x, y, size, alpha, rot) {
    if (alpha <= 0.01 || size <= 0.2) return;
    ctx.globalAlpha = alpha;
    if (rot) {
      const c = Math.cos(rot) * DPR, n = Math.sin(rot) * DPR;
      ctx.setTransform(c, n, -n, c, x * DPR, y * DPR);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    } else {
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    }
  }

  const dust = [], bokeh = [], ahearts = [], HP = [];   // HP: hạt tạo hình trái tim

  function layoutHeart() {
    HG.size = clamp(Math.min(W * 0.66, H * 0.5), 150, 560);   // trái tim luôn ở chính giữa
    HG.u = HG.size / 32; HG.cx = W / 2; HG.cy = H * 0.5;
  }

  function resize() {
    const oldW = W;
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, W < 700 ? 1.5 : 2);
    [sceneC, fxC].forEach((c) => { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
    sc.setTransform(DPR, 0, 0, DPR, 0, 0); fx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layoutHeart();
    if (W !== oldW) { dust.length = 0; bokeh.length = 0; ahearts.length = 0; }
    syncAmbient();
    if (!S.burstDone) buildHP();
  }
  let rzT;
  window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(resize, 120); });

  /* =========================================================
     4. PARTICLE POOL (burst, click, trail) — không tạo DOM
     ========================================================= */
  function makePool(ctx, capFn) {
    const a = [], rings = [];
    return {
      a,
      add(p) {
        if (a.length >= capFn()) return;
        p.age = 0; p.rot = p.rot || 0; p.vr = p.vr || 0; p.k = p.k || 0; p.g = p.g || 0;
        p.sw = p.sw || 0; p.sf = p.sf || 0; p.ph = Math.random() * TAU;
        if (p.s1 === undefined) p.s1 = p.s;
        if (!p.fi) p.fi = 0.1;
        a.push(p);
      },
      ring(x, y, r0, r1, life, rgb, lw) {
        if (rings.length < 14) rings.push({ x, y, r0, r1, life, rgb, lw: lw || 2, age: 0 });
      },
      step(dt) {
        for (let i = a.length - 1; i >= 0; i--) {
          const p = a[i];
          p.age += dt;
          if (p.age >= p.life) { a[i] = a[a.length - 1]; a.pop(); continue; }
          const k = p.age / p.life, dm = Math.exp(-p.k * dt);
          p.vx *= dm; p.vy = p.vy * dm + p.g * dt;
          p.x += p.vx * dt + (p.sw ? Math.cos(p.age * p.sf + p.ph) * p.sw * dt : 0);
          p.y += p.vy * dt; p.rot += p.vr * dt;
          const f = k < p.fi ? k / p.fi : 1 - (k - p.fi) / (1 - p.fi);
          p.da = p.a * f; p.ds = p.s + (p.s1 - p.s) * k;
        }
        for (let i = rings.length - 1; i >= 0; i--) { rings[i].age += dt; if (rings[i].age >= rings[i].life) rings.splice(i, 1); }
      },
      draw() {
        ctx.globalCompositeOperation = 'source-over';
        for (const p of a) if (!p.add) drawSprite(ctx, p.img, p.x, p.y, p.ds, p.da, p.rot);
        ctx.globalCompositeOperation = 'lighter';
        for (const p of a) if (p.add) drawSprite(ctx, p.img, p.x, p.y, p.ds, p.da, p.rot);
        for (const r of rings) {
          const k = r.age / r.life, rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 3));
          ctx.globalAlpha = (1 - k) * 0.8; ctx.lineWidth = r.lw * (1 - k) + 0.5;
          ctx.strokeStyle = `rgb(${r.rgb})`;
          ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      },
      busy() { return a.length > 0 || rings.length > 0; }
    };
  }
  const scenePool = makePool(sc, () => Math.round(600 * qScale()) + 80);   // burst, hạt xoáy (nằm sau UI)
  const fxPool = makePool(fx, () => (W < 700 ? 140 : 260));                  // click, trail (nằm trên UI)

  /* =========================================================
     5. NỀN: BỤI SÁNG NHIỀU LỚP + BOKEH + TIM NHỎ
     ========================================================= */
  function makeDust() {
    const z = rand(0.12, 1), ci = (Math.random() * palette.length) | 0;
    const far = z < 0.4, near = z > 0.72;
    let img, s, a;
    if (near && Math.random() < 0.12) { img = SPR.soft[ci]; s = rand(60, 130); a = rand(0.06, 0.14); }          // bokeh gần, rất mờ
    else if (far) { img = SPR.soft[ci]; s = rand(10, 24); a = rand(0.18, 0.4); }                                 // xa: mờ, blur
    else if (near) { img = Math.random() < 0.3 ? SPR.spark[ci] : SPR.crisp[ci]; s = rand(7, 14); a = rand(0.6, 0.95); } // gần: sáng, rõ
    else { img = SPR.crisp[ci]; s = rand(4, 9); a = rand(0.4, 0.75); }
    return { x: rand(0, W), y: rand(0, H), z, s, a, img, vx: rand(-6, 6) * z, vy: -rand(3, 16) * z, sp: rand(0.5, 1.8), ph: rand(0, TAU), ox: 0, oy: 0 };
  }
  function makeBokeh() {
    return { x: rand(0, W), y: rand(0, H), z: rand(0.1, 0.3), s: rand(70, 190) * (W < 700 ? 0.7 : 1), a: rand(0.07, 0.16),
      img: pick(SPR.soft), vx: rand(-5, 5), vy: -rand(2, 7), sp: rand(0.2, 0.5), ph: rand(0, TAU), ox: 0, oy: 0 };
  }
  function makeAH(initial) {
    const s = rand(10, 26);
    return { x: rand(0, W), y: initial ? rand(0, H) : H + s + rand(0, H * 0.3), s, vy: rand(14, 38), sw: rand(12, 36), sf: rand(0.3, 0.8),
      ph: rand(0, TAU), a: rand(0.5, 0.9), img: pick(SPR.heart), rot: rand(-0.3, 0.3), vr: rand(-0.2, 0.2) };
  }
  function syncAmbient() {
    const q = qScale() * clamp((W * H) / (1280 * 720), 0.7, 1.6);
    const n = { d: Math.round(CONFIG.count.dust * q), b: Math.max(4, Math.round(CONFIG.count.bokeh * q)), h: Math.max(6, Math.round(CONFIG.count.ambientHearts * q)) };
    while (dust.length < n.d) dust.push(makeDust()); dust.length = Math.min(dust.length, n.d);
    while (bokeh.length < n.b) bokeh.push(makeBokeh()); bokeh.length = Math.min(bokeh.length, n.b);
    while (ahearts.length < n.h) ahearts.push(makeAH(true)); ahearts.length = Math.min(ahearts.length, n.h);
  }

  const mouseActive = (now) => ptr.has && ptr.type !== 'touch' && !reduced && now - ptr.last < 2500;

  function drawAmbient(t, dt, now) {
    const spd = reduced ? 0.15 : 1;
    const pull = mouseActive(now);
    const R = 170;

    sc.globalCompositeOperation = 'lighter';
    const layer = (arr, big) => {
      for (const p of arr) {
        p.x += p.vx * dt * spd; p.y += p.vy * dt * spd;
        if (p.y < -p.s) { p.y = H + p.s; p.x = rand(0, W); }
        if (p.x < -p.s) p.x = W + p.s; else if (p.x > W + p.s) p.x = -p.s;

        // hạt gần con trỏ bị hút nhẹ; con trỏ đứng yên → trở về bình thường
        let tx = 0, ty = 0;
        if (pull && !big) {
          const dx = ptr.x - p.x, dy = ptr.y - p.y, dist = Math.hypot(dx, dy);
          if (dist < R && dist > 1) { const f = (1 - dist / R) * 46 * p.z; tx = (dx / dist) * f; ty = (dy / dist) * f; }
        }
        const kk = Math.min(1, dt * (pull ? 5 : 2));
        p.ox += (tx - p.ox) * kk; p.oy += (ty - p.oy) * kk;

        const tw_ = 0.55 + 0.45 * Math.sin(t * p.sp + p.ph);
        const x = p.x + p.ox - par.x * p.z * 22, y = p.y + p.oy - par.y * p.z * 22;
        drawSprite(sc, p.img, x, y, p.s, p.a * tw_ * S.particleA, 0);
      }
    };
    layer(bokeh, true);
    layer(dust, false);
    sc.globalCompositeOperation = 'source-over';
  }

  function drawAmbientHearts(t, dt) {
    const spd = reduced ? 0.15 : 1;
    for (let i = 0; i < ahearts.length; i++) {
      const f = ahearts[i];
      f.y -= f.vy * spd * dt; f.rot += f.vr * dt * spd;
      if (f.y < -f.s) { ahearts[i] = makeAH(false); continue; }
      const x = f.x + Math.sin(t * f.sf + f.ph) * f.sw;
      const fi = clamp((H + f.s * 0.5 - f.y) / 120, 0, 1), fo = clamp((f.y + f.s) / 120, 0, 1);
      drawSprite(sc, f.img, x, f.y, f.s, f.a * fi * fo * S.hearts, f.rot);
    }
  }

  /* =========================================================
     6. TRÁI TIM LỚN + HẠT TẠO HÌNH + TIA SÁNG
     ========================================================= */
  function buildHP() {
    const n = Math.round(CONFIG.count.formParticles * qScale());
    HP.length = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const kind = r < 0.55 ? 0 : r < 0.8 ? 1 : 2;      // 0: viền, 1: bên trong, 2: vầng sáng bên ngoài
      const ci = (Math.random() * palette.length) | 0;
      HP.push({
        t: rand(0, TAU),
        k: kind === 0 ? 1 + rand(-0.04, 0.06) : kind === 1 ? Math.sqrt(Math.random()) * 0.9 : rand(1.08, 1.55),
        halo: kind === 2,
        delay: rand(0, 0.45),
        sx: HG.cx + rand(-0.7, 0.7) * W, sy: HG.cy + rand(-0.7, 0.7) * H,
        swirl: rand(-120, 120),
        jx: rand(-2, 2), jy: rand(-2, 2),
        sp: rand(0.8, 2.2), ph: rand(0, TAU),
        size: rand(3, 8) * (kind === 2 ? 0.8 : 1), a: rand(0.55, 1),
        img: SPR.crisp[ci]
      });
    }
  }

  function hpTarget(p, sc_) {
    return {
      x: HG.cx + hx(p.t) * p.k * HG.u * sc_ + p.jx,
      y: HG.cy - (hy(p.t) + HY_OFFSET) * p.k * HG.u * sc_ + p.jy
    };
  }

  const beatCurve = (t, rate) => {
    const p = (t * rate) % 1;
    return Math.exp(-Math.pow((p - 0.1) * 13, 2)) + 0.55 * Math.exp(-Math.pow((p - 0.32) * 13, 2));
  };

  function drawCenterLight() {
    const L = easeInOut(clamp(S.light, 0, 1));
    const maxD = Math.max(W, H);
    if (L > 0.002) {
      sc.globalCompositeOperation = 'lighter';
      const r1 = lerp(26, maxD * 0.62, L);                       // vầng sáng rộng (bloom)
      drawSprite(sc, SPR.light, HG.cx, HG.cy, r1 * 2, 0.8 * L, 0);
      const r2 = lerp(10, 130, L);                               // lõi sáng nhỏ
      drawSprite(sc, SPR.light, HG.cx, HG.cy, r2 * 2, Math.min(1, L * 1.2), 0);
    }
    if (S.flare > 0.01) {
      sc.globalCompositeOperation = 'lighter';
      drawSprite(sc, SPR.light, HG.cx, HG.cy, maxD * 1.5, S.flare * 0.7, 0);
    }
    sc.globalCompositeOperation = 'source-over';
  }

  function drawHeart(t, dt, now) {
    const amp = reduced ? CONFIG.heartbeat.amp * 0.3 : CONFIG.heartbeat.amp;
    const bc = beatCurve(t, S.beatRate);
    const pulse = 1 + amp * bc * (0.8 + 0.4 * (S.glow - 1));

    // --- hạt tạo hình (hội tụ → tạo thành trái tim, đập theo nhịp) ---
    if (HP.length && S.heartForm > 0.001) {
      sc.globalCompositeOperation = 'lighter';
      for (const p of HP) {
        const f = clamp((S.heartForm - p.delay) / (1 - p.delay), 0, 1);
        if (f <= 0) continue;
        const e = easeInOut(f), tg = hpTarget(p, 1);
        let x = lerp(p.sx, tg.x, e), y = lerp(p.sy, tg.y, e);
        const vx = tg.x - p.sx, vy = tg.y - p.sy, len = Math.hypot(vx, vy) || 1;
        const sw = Math.sin(e * Math.PI) * p.swirl;
        x += (-vy / len) * sw; y += (vx / len) * sw;               // quỹ đạo xoáy khi bay vào
        const wob = reduced ? 0 : 1;
        x += Math.cos(t * p.sp + p.ph) * 2.2 * wob; y += Math.sin(t * p.sp * 1.2 + p.ph) * 2.2 * wob;
        if (p.halo && f >= 1) { const o = 1 + 0.05 * Math.sin(t * 0.8 + p.ph); x = HG.cx + (x - HG.cx) * o; y = HG.cy + (y - HG.cy) * o; }
        x = HG.cx + (x - HG.cx) * pulse; y = HG.cy + (y - HG.cy) * pulse;
        const tw_ = 0.6 + 0.4 * Math.sin(t * p.sp * 2 + p.ph);
        const a = p.a * easeOut(clamp(f * 2, 0, 1)) * tw_ * (1 - S.diss);
        drawSprite(sc, p.img, x - par.x * 6, y - par.y * 6, p.size * (1 + 0.35 * bc) * 2.2, a, 0);
      }
    }

    // --- thân trái tim 3D ---
    const A = clamp(S.heartA, 0, 1) * (1 - clamp(S.diss, 0, 1));
    if (A > 0.005) {
      const hs = (HG.size / 0.8) * (0.86 + 0.14 * easeOut(clamp(S.heartA, 0, 1))) * pulse * (1 + 0.14 * S.diss);
      const yaw = (reduced ? 0 : Math.sin(t * 0.6) * 0.16) + par.x * 0.18;   // "xoay" nhẹ → cảm giác 3D
      const sx = Math.cos(yaw);
      const cx = HG.cx - par.x * 6, cy = HG.cy - par.y * 6;

      sc.globalCompositeOperation = 'lighter';
      drawSprite(sc, SPR.big.glow, cx, cy, hs * 1.5, 0.55 * S.glow * A * (0.8 + 0.4 * bc), 0);      // bloom

      // tia sáng nhỏ
      const rays = reduced ? 6 : 12;
      for (let i = 0; i < rays; i++) {
        const ang = t * 0.12 + (i * TAU) / rays, len = hs * (0.9 + 0.5 * Math.sin(t * 0.7 + i * 1.7)), w = hs * 0.02 * (1 + 0.6 * Math.sin(t + i));
        const c = Math.cos(ang) * DPR, n = Math.sin(ang) * DPR;
        sc.globalAlpha = 0.32 * A * S.glow;
        sc.setTransform(n, -c, c, n, cx * DPR, cy * DPR);         // xoay: trục +y của sprite hướng ra ngoài
        sc.drawImage(SPR.ray, -w / 2, 0, w, len);
        sc.setTransform(DPR, 0, 0, DPR, 0, 0);
      }

      sc.globalCompositeOperation = 'source-over';
      sc.globalAlpha = A;
      sc.setTransform(DPR * sx, 0, 0, DPR, cx * DPR, cy * DPR);
      sc.drawImage(SPR.big.base, -hs / 2, -hs / 2, hs, hs);
      sc.globalAlpha = A * 0.95;
      sc.drawImage(SPR.big.spec, -hs / 2 + yaw * hs * 0.1, -hs / 2 - par.y * hs * 0.03, hs, hs);
      if (S.glow > 1.05) {                                          // phát sáng mạnh hơn: tim "cháy" sáng
        sc.globalCompositeOperation = 'lighter';
        sc.globalAlpha = clamp((S.glow - 1) * 0.28, 0, 0.5) * A;
        sc.drawImage(SPR.big.base, -hs / 2, -hs / 2, hs, hs);
      }
      sc.setTransform(DPR, 0, 0, DPR, 0, 0);
      sc.globalCompositeOperation = 'source-over'; sc.globalAlpha = 1;
    }
  }

  // Hạt xoáy phát ra từ tâm trong giai đoạn ánh sáng ("vũ trụ nhỏ hình thành")
  let emitAcc = 0, spiral = 0;
  function runEmitter(dt) {
    if (S.emit <= 0.01) return;
    emitAcc += S.emit * qScale() * dt;
    while (emitAcc >= 1) {
      emitAcc -= 1; spiral += 0.55;
      const a = spiral + rand(-0.15, 0.15), r = rand(20, 110);
      scenePool.add({
        x: HG.cx + Math.cos(a) * 6, y: HG.cy + Math.sin(a) * 6,
        vx: Math.cos(a) * r - Math.sin(a) * r * 0.7, vy: Math.sin(a) * r + Math.cos(a) * r * 0.7,
        k: 0.28, s: rand(5, 12), s1: 1.5, a: 0.95, life: rand(3.5, 6), img: pick(SPR.crisp), add: true, fi: 0.08
      });
    }
  }

  /* =========================================================
     7. HEART BURST (lãng mạn, không giống vụ nổ)
     ========================================================= */
  function heartBurst() {
    S.burstDone = true;
    const q = qScale(), cx = HG.cx, cy = HG.cy;

    // 1) các hạt tạo hình tan ra, bay ra ngoài rồi chậm lại
    for (const p of HP) {
      const pos = hpTarget(p, 1), ang = Math.atan2(pos.y - cy, pos.x - cx), sp = rand(60, 300);
      scenePool.add({ x: pos.x, y: pos.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, k: 1.3, g: -6,
        s: p.size * 2.6, s1: 2, a: 0.9, life: rand(2.5, 5), img: p.img, add: true, fi: 0.05 });
    }
    HP.length = 0;

    // 2) nhiều trái tim nhỏ tỏa ra
    const nh = Math.round(CONFIG.count.burstHearts * q);
    for (let i = 0; i < nh; i++) {
      const t = rand(0, TAU), k = Math.sqrt(Math.random()) * 0.8;
      const x = cx + hx(t) * k * HG.u, y = cy - (hy(t) + HY_OFFSET) * k * HG.u;
      const ang = Math.atan2(y - cy, x - cx) + rand(-0.5, 0.5), sp = rand(110, 380), s = rand(12, 34);
      scenePool.add({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, k: 1.5, g: -16, s: s * 0.5, s1: s, a: rand(0.7, 1),
        life: rand(5, 9), img: pick(SPR.heart), rot: rand(-0.5, 0.5), vr: rand(-0.8, 0.8), sw: rand(8, 28), sf: rand(1, 2), fi: 0.06 });
    }

    // 3) sparkle
    const ns = Math.round(CONFIG.count.burstSparks * q);
    for (let i = 0; i < ns; i++) {
      const ang = rand(0, TAU), sp = rand(60, 320);
      scenePool.add({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, k: 1.8, s: rand(8, 20), s1: 0, a: 1,
        life: rand(0.9, 2.4), img: pick(SPR.spark), add: true, vr: rand(-3, 3), fi: 0.05 });
    }

    // 4) vòng sáng lan toả + ánh chớp
    scenePool.ring(cx, cy, 20, HG.size * 1.3, 1.7, '255,150,190', 3);
    at(0.25, () => scenePool.ring(HG.cx, HG.cy, 10, HG.size * 0.9, 1.4, '255,200,220', 2));
    tw('flare', 1, 0.18, easeOut); at(0.2, () => tw('flare', 0, d(2.4), easeOut));
    tw('diss', 1, d(1.6), easeInOut);
    tw('hearts', 1, d(3));
    tw('light', 0.38, d(3));
    tw('emit', 0, 0.5);
    sfx.burst();
  }

  /* =========================================================
     8. CON TRỎ / CHẠM / PARALLAX
     ========================================================= */
  const ptr = { x: 0, y: 0, px: 0, py: 0, has: false, type: 'mouse', moved: false, last: 0 };
  const par = { x: 0, y: 0 };
  let trailAcc = 0, lastFast = 0;

  // Hạt sáng đi theo con trỏ (độ trễ khác nhau → mềm mại)
  const followers = Array.from({ length: 6 }, (_, i) => ({ x: -100, y: -100, k: 2.2 + i * 0.7, s: 22 + (i % 3) * 8, ph: i * 1.3, img: SPR.soft[i % palette.length] }));
  let followA = 0;

  window.addEventListener('pointermove', (e) => {
    ptr.x = e.clientX; ptr.y = e.clientY;
    if (!ptr.has) { ptr.px = ptr.x; ptr.py = ptr.y; followers.forEach((f) => { f.x = ptr.x; f.y = ptr.y; }); }
    ptr.has = true; ptr.type = e.pointerType || 'mouse'; ptr.moved = true; ptr.last = performance.now();
  }, { passive: true });

  // Click / chạm (điện thoại, tablet) — pointerdown gộp cả ba
  let lastClick = 0;
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = performance.now();
    if (now - lastClick < 60) return;
    lastClick = now;
    clickFx(e.clientX, e.clientY);
    sfx.click();
  }, { passive: true });

  /** 💗 xuất hiện → bay lên → xoay nhẹ → fade out + sparkle + ripple (ít particle, không spam) */
  function clickFx(x, y) {
    fxPool.add({ x, y, vx: rand(-14, 14), vy: -rand(70, 110), g: -10, k: 0.35, s: 12, s1: 30, a: 1, life: 1.9,
      img: pick(SPR.heart), rot: rand(-0.4, 0.4), vr: rand(-1.4, 1.4), sw: 14, sf: 3, fi: 0.12 });
    const n = reduced ? 2 : 6;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(40, 130);
      fxPool.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, k: 2.2, s: rand(7, 14), s1: 0, a: 1, life: rand(0.5, 1), img: pick(SPR.spark), add: true, vr: rand(-3, 3) });
    }
    fxPool.ring(x, y, 4, 44, 0.8, '255,140,185', 2);
  }

  function updateFx(t, dt, now) {
    // trail theo con trỏ
    if (ptr.moved && !reduced) {
      const dx = ptr.x - ptr.px, dy = ptr.y - ptr.py, dist = Math.hypot(dx, dy);
      trailAcc += dist;
      const spacing = ptr.type === 'touch' ? 26 : 14;
      let n = 0;
      while (trailAcc > spacing && n < 3) {
        trailAcc -= spacing; n++;
        fxPool.add({ x: ptr.x + rand(-4, 4), y: ptr.y + rand(-4, 4), vx: rand(-12, 12), vy: rand(-18, 4), s: rand(6, 12), s1: 0, a: 0.9,
          life: rand(0.5, 0.9), img: pick(SPR.spark), add: true, vr: rand(-2, 2) });
      }
      if (ptr.type !== 'touch' && dist / dt > 1500 && now - lastFast > 130) {   // di chuyển nhanh → vài tim nhỏ
        lastFast = now;
        fxPool.add({ x: ptr.x, y: ptr.y, vx: rand(-10, 10), vy: -rand(40, 90), k: 0.3, s: rand(9, 15), s1: 5, a: 0.85, life: 1.2,
          img: pick(SPR.heart), rot: rand(-0.4, 0.4), vr: rand(-1, 1), sw: 14, sf: 4 });
      }
      ptr.px = ptr.x; ptr.py = ptr.y; ptr.moved = false;
    }

    const active = mouseActive(now);
    followA += ((active ? 1 : 0) - followA) * Math.min(1, dt * 4);

    if (!fxPool.busy() && followA < 0.01) {
      if (fxDrawn) { fx.clearRect(0, 0, W, H); fxDrawn = false; }
      return;
    }
    fx.clearRect(0, 0, W, H); fxDrawn = true;
    fxPool.step(dt); fxPool.draw();

    if (followA > 0.01) {
      fx.globalCompositeOperation = 'lighter';
      for (const f of followers) {
        f.x += (ptr.x - f.x) * Math.min(1, dt * f.k); f.y += (ptr.y - f.y) * Math.min(1, dt * f.k);
        drawSprite(fx, f.img, f.x + Math.cos(t * 1.3 + f.ph) * 14, f.y + Math.sin(t * 1.1 + f.ph) * 14, f.s, 0.6 * followA, 0);
      }
      fx.globalCompositeOperation = 'source-over'; fx.globalAlpha = 1;
    }
  }
  let fxDrawn = false;

  // Parallax rất nhẹ (chuột) — trên điện thoại trôi nhẹ tự động
  const layers = Array.from(document.querySelectorAll('[data-depth]')).map((el) => ({ el, d: parseFloat(el.dataset.depth) || 0, lx: 0, ly: 0 }));
  function updateParallax(t, dt, now) {
    let tx = 0, ty = 0;
    if (!reduced) {
      if (mouseActive(now) || (ptr.has && ptr.type === 'mouse' && now - ptr.last < 6000)) { tx = (ptr.x / W - 0.5) * 2; ty = (ptr.y / H - 0.5) * 2; }
      else { tx = Math.sin(t * 0.12) * 0.5; ty = Math.cos(t * 0.1) * 0.4; }
    }
    const k = Math.min(1, dt * 2.5);
    par.x += (tx - par.x) * k; par.y += (ty - par.y) * k;
    for (const L of layers) {
      const x = -par.x * L.d, y = -par.y * L.d;
      if (Math.abs(x - L.lx) < 0.05 && Math.abs(y - L.ly) < 0.05) continue;
      L.lx = x; L.ly = y;
      L.el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
    }
  }

  /* =========================================================
     9. ÂM THANH (Web Audio — tự tổng hợp, không cần file)
        Mặc định TẮT, chỉ bật khi người dùng bấm nút.
     ========================================================= */
  let audio = null, soundOn = false;
  function ensureAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audio = new AC(); } catch (e) { return null; }
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, dur, type, vol, delay) {
    const ac = ensureAudio(); if (!ac) return;
    const t0 = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  const safe = (fn) => { if (!soundOn) return; try { fn(); } catch (e) { /* bỏ qua */ } };
  const sfx = {
    click() { safe(() => { tone(1046, 0.16, 'sine', 0.03); tone(1568, 0.2, 'sine', 0.015, 0.04); }); },
    burst() { safe(() => [523, 659, 784, 988, 1318].forEach((f, i) => tone(f, 0.7, 'sine', 0.035, i * 0.09))); },
    open()  { safe(() => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.9, 'triangle', 0.03, i * 0.12))); }
  };
  const soundBtn = $('#sound-toggle');
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.setAttribute('aria-label', soundOn ? 'Tắt âm thanh' : 'Bật âm thanh');
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) { ensureAudio(); try { tone(1318, 0.3, 'sine', 0.03); tone(1760, 0.35, 'sine', 0.02, 0.08); } catch (e) { /* bỏ qua */ } }
  });

  /* =========================================================
     10. LUỒNG TRẢI NGHIỆM
     ========================================================= */
  const form = $('#intro-form'), input = $('#name-input'), hint = $('#hint'), field = $('#field'), btnOpen = $('#btn-open');
  const intro = $('#intro'), nameBlock = $('#name-block'), nameTitle = $('#name-title');
  const envStage = $('#env-stage'), envelope = $('#envelope'), envHint = $('#env-hint');
  const letterWrap = $('#letter-wrap'), letter = $('#letter'), letterGreet = $('#letter-greet'), letterBody = $('#letter-body');
  const letterSign = $('#letter-sign'), letterActions = $('#letter-actions');

  let started = false, userName = '', envReady = false, envOpened = false;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (CONFIG.forceName || input.value).replace(/\s+/g, ' ').trim();
    if (!name) {
      hint.classList.add('show');
      field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake');
      input.focus(); return;
    }
    start(name);
  });
  input.addEventListener('input', () => hint.classList.remove('show'));

  /** Toàn bộ chuỗi: ánh sáng → particle → tim lớn → phát sáng → burst → tên → phong thư */
  function start(name) {
    if (started) return;
    started = true; userName = name; input.blur();
    const T = CONFIG.time;

    intro.classList.remove('show');
    clickFx(btnOpen.getBoundingClientRect().left + btnOpen.offsetWidth / 2, btnOpen.getBoundingClientRect().top);

    // PHẦN 1 — ánh sáng + hạt xoáy
    tw('light', 1, d(T.light), easeInOut);
    tw('particleA', 1, d(T.light * 0.8));
    tw('emit', 34, d(2.5)); at(d(T.formStart + 0.8), () => tw('emit', 5, d(2)));

    // PHẦN 2 — hạt tụ thành trái tim, thân tim hiện ra, đập nhịp
    at(d(T.formStart), () => tw('heartForm', 1, d(T.form), easeInOut));
    at(d(T.formStart + T.form * 0.55), () => { tw('heartA', 1, d(2.2), easeOut); tw('hearts', 0.5, d(3)); });

    // PHẦN 3 — phát sáng mạnh → heart burst
    const tGlow = T.formStart + T.form + T.hold;
    at(d(tGlow), () => { tw('glow', 2.6, d(T.glow)); tw('beatRate', 1.7, d(T.glow)); });
    const tBurst = tGlow + T.glow;
    at(d(tBurst), () => { heartBurst(); tw('glow', 1.2, d(2.5)); tw('beatRate', CONFIG.heartbeat.rate, d(2)); });

    // PHẦN 4 — tên người dùng
    const tName = tBurst + T.nameDelay;
    at(d(tName), () => {
      nameTitle.textContent = 'Chào ' + userName + ' 💗';
      nameBlock.classList.add('show');
    });

    // PHẦN 5 — phong thư
    at(d(tName + T.nameHold), () => {
      nameBlock.classList.remove('show');
      envStage.classList.add('show');
      setTimeout(() => { envReady = true; }, 900);
    });
  }

  // --- Mở phong thư: rung → nắp mở → giấy trượt lên → ánh sáng + tim bay ra ---
  envelope.addEventListener('click', openEnvelope);
  function openEnvelope() {
    if (!envReady || envOpened) return;
    envOpened = true;
    envHint.classList.add('hide');
    envelope.classList.add('shake'); sfx.click();

    setTimeout(() => {
      envelope.classList.remove('shake'); envelope.classList.add('open'); sfx.open();
      tw('flare', 0.7, 0.5, easeOut); at(0.7, () => tw('flare', 0.15, d(2.5)));
      envelopeHearts(reduced ? 4 : 14);
    }, 650);
    setTimeout(() => envelopeHearts(reduced ? 3 : 12), 1700);
    setTimeout(() => envelopeHearts(reduced ? 2 : 10), 2600);
    setTimeout(showLetter, 3700);
  }

  function envelopeHearts(n) {
    const r = envelope.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = rand(10, 26);
      fxPool.add({ x: r.left + r.width * rand(0.25, 0.75), y: r.top + r.height * rand(0.05, 0.35), vx: rand(-40, 40), vy: -rand(90, 220),
        k: 0.4, g: -6, s, s1: s * 0.8, a: 1, life: rand(2.2, 3.6), img: pick(SPR.heart), rot: rand(-0.4, 0.4), vr: rand(-1, 1), sw: rand(10, 30), sf: rand(1, 2.5) });
    }
    for (let i = 0; i < (reduced ? 2 : 8); i++) {
      fxPool.add({ x: r.left + r.width * rand(0.2, 0.8), y: r.top + r.height * 0.2, vx: rand(-60, 60), vy: -rand(40, 160), k: 1, s: rand(7, 14), s1: 0, a: 1, life: rand(0.8, 1.6), img: pick(SPR.spark), add: true, vr: rand(-3, 3) });
    }
  }

  // --- Bức thư: chữ hiện dần (layout được giữ chỗ trước nên không bị giật) ---
  const letterChars = [];
  let skipTyping = false, typingTimer = 0, typingDone = false;

  function buildLetter() {
    const L = CONFIG.letter;
    letterGreet.textContent = L.greeting.replace('{name}', userName);
    letterBody.textContent = ''; letterChars.length = 0;
    L.lines.forEach((line) => {
      const p = document.createElement('p'), txt = line.replace('{name}', userName);
      if (!txt) p.className = 'blank';
      Array.from(txt).forEach((ch) => {
        const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch;
        p.appendChild(s); letterChars.push({ el: s, eol: false });
      });
      if (txt) letterChars[letterChars.length - 1].eol = true;
      letterBody.appendChild(p);
    });
    letterSign.textContent = L.signature || '';
  }

  function showLetter() {
    buildLetter();
    envStage.classList.remove('show');
    letterWrap.classList.add('show');
    tw('light', 0.3, d(3));
    sfx.open();
    setTimeout(typeLetter, reduced ? 100 : 1500);
  }

  function typeLetter() {
    let i = 0;
    const step = () => {
      if (skipTyping || reduced || i >= letterChars.length) { finishLetter(); return; }
      const c = letterChars[i++];
      c.el.classList.add('on');
      const ch = c.el.textContent;
      if (c.eol && letter.scrollHeight > letter.clientHeight + 4) c.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const delay = CONFIG.typing.speed * (ch === ' ' ? 0.6 : 1) + (c.eol ? CONFIG.typing.linePause : 0) + (',.!?…'.includes(ch) ? 160 : 0);
      typingTimer = setTimeout(step, delay);
    };
    step();
  }
  function finishLetter() {
    if (typingDone) return;
    typingDone = true; clearTimeout(typingTimer);
    letterChars.forEach((c) => c.el.classList.add('on'));
    if (CONFIG.letter.signature) letterSign.classList.add('on');
    letterActions.classList.add('on');
  }
  // Chạm vào thư khi đang gõ → hiện toàn bộ ngay
  letter.addEventListener('click', () => { if (!typingDone) skipTyping = true; });

  $('#btn-more').addEventListener('click', () => {
    for (let i = 0; i < (reduced ? 6 : 26); i++) {
      const s = rand(10, 30), vy = -rand(140, 320);
      fxPool.add({ x: rand(0, W), y: H + 20, vx: rand(-15, 15), vy, s, s1: s * 0.85, a: rand(0.6, 0.95), life: ((H + 60) / -vy) * rand(0.6, 0.9),
        img: pick(SPR.heart), rot: rand(-0.3, 0.3), vr: rand(-0.6, 0.6), sw: rand(15, 45), sf: rand(1, 2.5) });
    }
    sfx.burst();
  });
  $('#btn-again').addEventListener('click', () => location.reload());

  /* =========================================================
     11. VÒNG LẶP CHÍNH
     ========================================================= */
  let raf = 0, last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now; clock += dt;

    stepTimeline(dt);
    runEmitter(dt);
    updateParallax(clock, dt, now);

    sc.clearRect(0, 0, W, H);
    drawCenterLight();
    drawAmbient(clock, dt, now);
    drawHeart(clock, dt, now);
    scenePool.step(dt); scenePool.draw();
    drawAmbientHearts(clock, dt);
    updateFx(clock, dt, now);
  }
  function startLoop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // Tab ẩn → dừng hẳn (cả timeline) để tiết kiệm pin và giữ đúng nhịp
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else startLoop();
  });

  resize();
  startLoop();
  setTimeout(() => { if (!started) input.focus({ preventScroll: true }); }, 1400);
})();
