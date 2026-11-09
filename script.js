/* =============================================================
   script.js — Website lời nhắn ngọt ngào
   -------------------------------------------------------------
   Cấu trúc:
     0. Helpers & trạng thái chung
     1. Sprites (vẽ sẵn trái tim/sao/bokeh vào canvas nhỏ → vẽ rất nhanh)
     2. Canvas, kích thước, ngân sách particle theo thiết bị
     3. Nền động: sao, bokeh, trái tim bay (canvas nền)
     4. Hiệu ứng tương tác: burst, ripple, trail, riser (canvas fx)
     5. Parallax nhẹ
     6. Âm thanh (Web Audio, không cần file)
     7. Luồng giao diện: nhập tên → lời chào → card
     8. Vòng lặp requestAnimationFrame
   ============================================================= */
(() => {
  'use strict';

  /* =========================================================
     0. HELPERS & TRẠNG THÁI CHUNG
     ========================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TAU = Math.PI * 2;

  // Người dùng bật "giảm chuyển động" → giảm/tắt hiệu ứng không cần thiết
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceMQ.matches;
  const onReduceChange = (e) => { reduced = e.matches; syncAmbient(); };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduceChange);
  else if (reduceMQ.addListener) reduceMQ.addListener(onReduceChange);

  // Thiết bị cảm ứng → không dựa vào hover
  if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('is-touch');

  /* =========================================================
     1. SPRITES — vẽ sẵn 1 lần, sau đó chỉ drawImage()
        (tránh shadowBlur mỗi khung hình → rất nhẹ)
     ========================================================= */
  function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  // Đường vẽ trái tim, t = kích thước cơ sở, gốc toạ độ ở giữa
  function heartPath(g, t) {
    g.beginPath();
    g.moveTo(0, t * 0.9);
    g.bezierCurveTo(-t * 1.35, -t * 0.05, -t * 0.7, -t * 1.1, 0, -t * 0.4);
    g.bezierCurveTo(t * 0.7, -t * 1.1, t * 1.35, -t * 0.05, 0, t * 0.9);
    g.closePath();
  }

  function heartSprite(c1, c2) {
    const s = 96, c = makeCanvas(s), g = c.getContext('2d'), t = 26;
    g.translate(s / 2, s / 2 + 2);
    g.shadowColor = c2; g.shadowBlur = 12;           // glow nhẹ
    const grad = g.createLinearGradient(-t, -t, t, t);
    grad.addColorStop(0, c1); grad.addColorStop(1, c2);
    g.fillStyle = grad;
    heartPath(g, t); g.fill();
    g.shadowBlur = 0;                                  // vệt sáng bóng
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath(); g.ellipse(-t * 0.45, -t * 0.5, t * 0.22, t * 0.12, -0.6, 0, TAU); g.fill();
    return c;
  }

  function sparkleSprite(glow) {
    const s = 64, c = makeCanvas(s), g = c.getContext('2d'), r = 20;
    g.translate(s / 2, s / 2);
    g.shadowColor = glow; g.shadowBlur = 10;
    g.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) {                      // vẽ 2 lần cho sáng hơn
      g.beginPath();
      g.moveTo(0, -r);
      g.quadraticCurveTo(0, 0, r, 0);
      g.quadraticCurveTo(0, 0, 0, r);
      g.quadraticCurveTo(0, 0, -r, 0);
      g.quadraticCurveTo(0, 0, 0, -r);
      g.fill();
    }
    return c;
  }

  function dotSprite(r, gr, b) {
    const s = 128, c = makeCanvas(s), g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, `rgba(${r},${gr},${b},.9)`);
    grad.addColorStop(0.4, `rgba(${r},${gr},${b},.35)`);
    grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    return c;
  }

  const SPR = {
    hearts: [
      heartSprite('#ffc2dd', '#ff8fbd'),   // hồng
      heartSprite('#ffffff', '#ffd9ec'),   // trắng
      heartSprite('#e6d4ff', '#c9a8ff'),   // tím nhạt
      heartSprite('#ffb3d1', '#ff7aa8')    // hồng đậm
    ],
    sparks: [sparkleSprite('#ff9fd0'), sparkleSprite('#d3b4ff'), sparkleSprite('#ffffff')],
    dots: [dotSprite(255, 175, 215), dotSprite(214, 186, 255), dotSprite(255, 255, 255)]
  };

  /* =========================================================
     2. CANVAS & NGÂN SÁCH PARTICLE
     ========================================================= */
  const bgC = $('#bg-canvas'), fxC = $('#fx-canvas');
  const bg = bgC.getContext('2d'), fx = fxC.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function drawSprite(ctx, img, x, y, size, alpha, rot) {
    if (alpha <= 0.01) return;
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

  // Số lượng particle tự giảm theo kích thước màn hình / điện thoại / reduced-motion
  function budget() {
    const f = clamp((W * H) / (1280 * 720), 0.6, 1.8) * (W < 700 ? 0.6 : 1) * (reduced ? 0.5 : 1);
    return {
      stars: Math.round(90 * f),
      bokeh: Math.max(4, Math.round(9 * f)),
      hearts: Math.max(7, Math.round(15 * f))
    };
  }
  const fxCap = () => (W < 700 ? 150 : 280);

  function resize() {
    const oldW = W;
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, W < 700 ? 1.5 : 2);   // giới hạn DPR để tiết kiệm GPU
    [bgC, fxC].forEach((c) => { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
    bg.setTransform(DPR, 0, 0, DPR, 0, 0);
    fx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (W !== oldW) {                    // đổi chiều rộng → rải lại (thanh URL mobile đổi chiều cao thì bỏ qua)
      stars.length = 0; bokeh.length = 0;
      floaters.forEach((f) => { f.x = rand(0, W); });
    }
    syncAmbient();
  }
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });

  /* =========================================================
     3. NỀN ĐỘNG: SAO, BOKEH, TRÁI TIM BAY
     ========================================================= */
  const stars = [], bokeh = [], floaters = [];

  const makeStar = () => ({
    x: rand(0, W), y: rand(0, H), s: rand(5, 13),
    ph: rand(0, TAU), sp: rand(0.6, 1.8), base: rand(0.25, 0.6), img: pick(SPR.sparks)
  });

  const makeBokeh = () => ({
    x: rand(0, W), y: rand(0, H), s: rand(60, 190) * (W < 700 ? 0.7 : 1),
    vx: rand(-6, 6), vy: rand(-5, -1), a: rand(0.12, 0.3), ph: rand(0, TAU), img: pick(SPR.dots)
  });

  function makeFloater(initial) {
    const big = Math.random() < 0.14;                  // thỉnh thoảng có trái tim lớn mờ ở nền
    const s = big ? rand(70, 120) * (W < 700 ? 0.6 : 1) : rand(10, 34);
    return {
      x: rand(0, W),
      y: initial ? rand(0, H + s) : H + s + rand(0, H * 0.3),
      s, big,
      vy: rand(14, 34) * (big ? 0.6 : 1),
      sw: rand(14, 40), sf: rand(0.25, 0.7), ph: rand(0, TAU),
      a: big ? rand(0.1, 0.2) : rand(0.25, 0.7),
      img: pick(SPR.hearts), rot: rand(-0.35, 0.35), vr: rand(-0.1, 0.1)
    };
  }

  // Điều chỉnh số lượng phần tử nền theo ngân sách hiện tại
  function syncAmbient() {
    const b = budget();
    while (stars.length < b.stars) stars.push(makeStar());
    stars.length = Math.min(stars.length, b.stars);
    while (bokeh.length < b.bokeh) bokeh.push(makeBokeh());
    bokeh.length = Math.min(bokeh.length, b.bokeh);
    while (floaters.length < b.hearts) floaters.push(makeFloater(true));
    floaters.length = Math.min(floaters.length, b.hearts);
  }

  function drawBg(t, dt) {
    bg.clearRect(0, 0, W, H);
    const speed = reduced ? 0.15 : 1;

    // bokeh: đốm sáng mờ trôi rất chậm
    for (const b of bokeh) {
      if (!reduced) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < -b.s) { b.y = H + b.s; b.x = rand(0, W); }
        if (b.x < -b.s) b.x = W + b.s; else if (b.x > W + b.s) b.x = -b.s;
      }
      drawSprite(bg, b.img, b.x, b.y, b.s, b.a * (0.7 + 0.3 * Math.sin(t * 0.4 + b.ph)), 0);
    }

    // sao lấp lánh
    for (const s of stars) {
      const tw = reduced ? 1 : 0.55 + 0.45 * Math.sin(t * s.sp + s.ph);
      drawSprite(bg, s.img, s.x, s.y, s.s, s.base * tw, 0);
    }

    // trái tim bay từ dưới lên, lắc nhẹ trái/phải; ra khỏi màn hình thì tái tạo
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      f.y -= f.vy * speed * dt;
      f.rot += f.vr * dt * speed;
      if (f.y < -f.s) { floaters[i] = makeFloater(false); continue; }
      const x = f.x + Math.sin(t * f.sf + f.ph) * f.sw;
      const fadeIn = clamp((H + f.s * 0.5 - f.y) / 120, 0, 1);
      const fadeOut = clamp((f.y + f.s) / 120, 0, 1);
      drawSprite(bg, f.img, x, f.y, f.s, f.a * fadeIn * fadeOut, f.rot);
    }
    bg.globalAlpha = 1;
  }

  /* =========================================================
     4. HIỆU ỨNG TƯƠNG TÁC (canvas fx)
     ========================================================= */
  const fxp = [];        // particle tạm thời (burst, trail, riser)
  const rings = [];      // vòng ripple
  const risers = [];     // "mưa" trái tim bay lên theo thời gian
  let fxWasDrawn = false;

  function addP(p) {
    if (fxp.length >= fxCap()) return;
    p.age = 0; p.rot = p.rot || 0; p.vr = p.vr || 0;
    p.drag = p.drag || 1; p.g = p.g || 0; p.sw = p.sw || 0; p.sf = p.sf || 0;
    p.ph = rand(0, TAU);
    if (p.s1 === undefined) p.s1 = p.s * 0.4;
    fxp.push(p);
  }

  /** Heart burst: 1 tim lớn + nhiều tim nhỏ + sparkle + ripple tại (x,y) */
  function burst(x, y, k = 1) {
    const m = (W < 700 ? 0.7 : 1) * (reduced ? 0.3 : 1) * k;

    addP({ x, y, vx: 0, vy: -20, drag: 0.96, s: 16, s1: 62, a: 0.95, life: 0.9, img: SPR.hearts[0] });

    const nh = Math.round(9 * m);
    for (let i = 0; i < nh; i++) {
      const ang = rand(0, TAU), sp = rand(70, 210);
      addP({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 30,
        g: 90, drag: 0.965, s: rand(10, 20), s1: rand(5, 9),
        a: rand(0.7, 1), life: rand(0.9, 1.6), img: pick(SPR.hearts),
        rot: rand(-0.5, 0.5), vr: rand(-1.5, 1.5)
      });
    }
    const ns = Math.round(14 * m);
    for (let i = 0; i < ns; i++) {
      const ang = rand(0, TAU), sp = rand(60, 200);
      addP({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        drag: 0.95, s: rand(8, 16), s1: 0, a: 1, life: rand(0.5, 1.1),
        img: pick(SPR.sparks), vr: rand(-3, 3)
      });
    }
    if (rings.length < 12) rings.push({ x, y, age: 0, life: 0.85, r0: 6, r1: 50 + 26 * k });
  }

  /** Mưa trái tim bay lên từ đáy màn hình trong `duration` ms */
  function rise(duration, density = 1) {
    risers.push({ t: duration / 1000, acc: 0, density: density * (W < 700 ? 0.6 : 1) * (reduced ? 0.3 : 1) });
  }

  // ---- Con trỏ / cảm ứng ----
  const ptr = { x: 0, y: 0, px: 0, py: 0, has: false, type: 'mouse', moved: false, last: 0 };
  let trailAcc = 0, lastFastHeart = 0;

  // Vài hạt sáng lướt theo con trỏ (độ trễ khác nhau → cảm giác mềm)
  const followers = Array.from({ length: 6 }, (_, i) => ({
    x: -100, y: -100, k: 2.2 + i * 0.7, s: 20 + (i % 3) * 8, ph: i * 1.3,
    img: i % 2 ? SPR.dots[i % 3] : SPR.dots[(i + 1) % 3]
  }));
  let followA = 0;

  window.addEventListener('pointermove', (e) => {
    ptr.x = e.clientX; ptr.y = e.clientY;
    if (!ptr.has) {
      ptr.px = ptr.x; ptr.py = ptr.y;
      followers.forEach((f) => { f.x = ptr.x; f.y = ptr.y; });
    }
    ptr.has = true; ptr.type = e.pointerType || 'mouse';
    ptr.moved = true; ptr.last = performance.now();
  }, { passive: true });

  // Click chuột / chạm điện thoại / chạm tablet: pointerdown gộp cả 3 loại
  let lastBurst = 0;
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = performance.now();
    if (now - lastBurst < 45) return;                  // chống spam
    lastBurst = now;
    burst(e.clientX, e.clientY, 1);
    sfx.click();
  }, { passive: true });

  function updateFx(t, dt, now) {
    // --- trail theo con trỏ ---
    if (ptr.moved && !reduced) {
      const dx = ptr.x - ptr.px, dy = ptr.y - ptr.py, d = Math.hypot(dx, dy);
      trailAcc += d;
      const spacing = ptr.type === 'touch' ? 26 : 14;
      let n = 0;
      while (trailAcc > spacing && n < 3) {
        trailAcc -= spacing; n++;
        addP({
          x: ptr.x + rand(-4, 4), y: ptr.y + rand(-4, 4),
          vx: rand(-12, 12), vy: rand(-18, 4), s: rand(6, 12), s1: 0, a: 0.9,
          life: rand(0.5, 0.9), img: pick(SPR.sparks), vr: rand(-2, 2)
        });
      }
      // di chuyển nhanh → vài trái tim nhỏ phía sau (có cooldown để không spam)
      if (ptr.type !== 'touch' && d / dt > 1500 && now - lastFastHeart > 120) {
        lastFastHeart = now;
        addP({
          x: ptr.x, y: ptr.y, vx: -dx / dt * 0.04 + rand(-10, 10), vy: rand(-40, -90),
          g: 0, drag: 0.98, s: rand(9, 15), s1: 5, a: 0.85, life: 1.2,
          img: pick(SPR.hearts), rot: rand(-0.4, 0.4), vr: rand(-1, 1), sw: 14, sf: 4
        });
      }
      ptr.px = ptr.x; ptr.py = ptr.y; ptr.moved = false;
    }

    // --- riser: mưa tim bay lên ---
    for (let i = risers.length - 1; i >= 0; i--) {
      const r = risers[i];
      r.t -= dt; r.acc += dt;
      const interval = 0.07 / Math.max(r.density, 0.1);
      while (r.acc >= interval) {
        r.acc -= interval;
        const vy = -rand(140, 320), s = rand(10, 30);
        addP({
          x: rand(0, W), y: H + 20, vx: rand(-15, 15), vy, s, s1: s * 0.85,
          a: rand(0.6, 0.95), life: ((H + 60) / -vy) * rand(0.55, 0.9),
          img: pick(SPR.hearts), rot: rand(-0.3, 0.3), vr: rand(-0.6, 0.6),
          sw: rand(15, 45), sf: rand(1, 2.5)
        });
      }
      if (r.t <= 0) risers.splice(i, 1);
    }

    // --- followers ---
    const active = ptr.has && ptr.type !== 'touch' && !reduced && now - ptr.last < 1800;
    followA += ((active ? 1 : 0) - followA) * Math.min(1, dt * 4);

    // --- vẽ ---
    const hasWork = fxp.length || rings.length || followA > 0.01;
    if (!hasWork) {
      if (fxWasDrawn) { fx.clearRect(0, 0, W, H); fxWasDrawn = false; }
      return;
    }
    fx.clearRect(0, 0, W, H);
    fxWasDrawn = true;

    for (let i = fxp.length - 1; i >= 0; i--) {
      const p = fxp[i];
      p.age += dt;
      if (p.age >= p.life) { fxp[i] = fxp[fxp.length - 1]; fxp.pop(); continue; }
      const k = p.age / p.life;
      const dk = Math.pow(p.drag, dt * 60);
      p.vx *= dk; p.vy = p.vy * dk + p.g * dt;
      p.x += p.vx * dt + (p.sw ? Math.cos(p.age * p.sf + p.ph) * p.sw * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
      drawSprite(fx, p.img, p.x, p.y, p.s + (p.s1 - p.s) * k, p.a * fade, p.rot);
    }

    // ripple
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) { rings.splice(i, 1); continue; }
      const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 3));
      fx.globalAlpha = (1 - k) * 0.8;
      fx.lineWidth = 2.5 * (1 - k) + 0.5;
      fx.strokeStyle = '#ff9ccb';
      fx.beginPath(); fx.arc(r.x, r.y, rad, 0, TAU); fx.stroke();
      fx.globalAlpha = (1 - k) * 0.18;
      fx.fillStyle = '#ffc2dd';
      fx.fill();
    }

    // hạt sáng đi theo con trỏ
    if (followA > 0.01) {
      for (const f of followers) {
        f.x += (ptr.x - f.x) * Math.min(1, dt * f.k);
        f.y += (ptr.y - f.y) * Math.min(1, dt * f.k);
        const ox = Math.cos(t * 1.3 + f.ph) * 14, oy = Math.sin(t * 1.1 + f.ph) * 14;
        drawSprite(fx, f.img, f.x + ox, f.y + oy, f.s, 0.55 * followA, 0);
      }
    }
    fx.globalAlpha = 1;
  }

  /* =========================================================
     5. PARALLAX NHẸ
     ========================================================= */
  const layers = Array.from(document.querySelectorAll('[data-depth]'))
    .map((el) => ({ el, d: parseFloat(el.dataset.depth) || 0, lx: 0, ly: 0 }));
  const par = { x: 0, y: 0 };

  function updateParallax(t, dt, now) {
    let tx = 0, ty = 0;
    if (!reduced) {
      const mouseActive = ptr.has && ptr.type === 'mouse' && now - ptr.last < 4000;
      if (mouseActive) { tx = (ptr.x / W - 0.5) * 2; ty = (ptr.y / H - 0.5) * 2; }
      else { tx = Math.sin(t * 0.12) * 0.5; ty = Math.cos(t * 0.1) * 0.4; }   // điện thoại: trôi nhẹ tự động
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
     6. ÂM THANH (Web Audio — tự tổng hợp, không cần file)
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
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  const sfx = {
    click() {
      if (!soundOn) return;
      try { tone(1046, 0.16, 'sine', 0.03); tone(1568, 0.2, 'sine', 0.015, 0.04); } catch (e) { /* bỏ qua */ }
    },
    magic() {
      if (!soundOn) return;
      try { [784, 988, 1175, 1318, 1568].forEach((f, i) => tone(f, 0.45, 'sine', 0.035, i * 0.08)); } catch (e) { /* bỏ qua */ }
    }
  };

  const soundBtn = $('#sound-toggle');
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.setAttribute('aria-label', soundOn ? 'Tắt âm thanh' : 'Bật âm thanh');
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) {
      ensureAudio();   // phải khởi tạo trong lúc người dùng bấm (yêu cầu của trình duyệt)
      try { tone(1318, 0.3, 'sine', 0.03); tone(1760, 0.35, 'sine', 0.02, 0.08); } catch (e) { /* bỏ qua */ }
    }
  });

  /* =========================================================
     7. LUỒNG GIAO DIỆN
     ========================================================= */
  const form = $('#name-form'), input = $('#name-input'), hint = $('#hint'), field = $('#field');
  const btnStart = $('#btn-start'), btnMagic = $('#btn-magic');
  const screenIntro = $('#screen-intro'), screenMain = $('#screen-main');
  const card = $('#card'), cardName = $('#card-name'), cardMsg = $('#card-msg'), flashEl = $('#flash');
  const heroTitle = $('#hero-title'), heroSub = $('#hero-sub');

  let started = false, userName = '';
  let msgIndex = 0, magicBusy = false;

  // --- Nhập tên: lấy trực tiếp từ input ---
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) { showHint(); return; }
    startExperience(name);
  });
  input.addEventListener('input', () => hint.classList.remove('show'));

  function showHint() {
    hint.classList.add('show');
    field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake');
    input.focus();
    const r = field.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top, 0.5);
  }

  function startExperience(name) {
    if (started) return;
    started = true; userName = name;
    input.blur();

    const r = btnStart.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 1.3);
    sfx.magic();

    // chuyển cảnh mượt (không đổi trang)
    screenIntro.classList.remove('is-active');
    screenIntro.setAttribute('aria-hidden', 'true');

    const heroLen = buildHero(name);
    cardName.textContent = 'Chào ' + name;
    cardMsg.textContent = messages(name)[0];

    setTimeout(() => {
      screenMain.classList.add('is-active');
      screenMain.removeAttribute('aria-hidden');
      rise(3200, 1);
    }, 350);

    // Sau khi lời chào hiện xong → chuyển sang card trung tâm
    const heroMs = clamp(heroLen * 70 + 3000, 3600, 5600);
    setTimeout(() => {
      screenMain.classList.add('phase-card');
      burst(W / 2, H * 0.45, 1.1);
    }, 350 + heroMs);
  }

  /** Tạo lời chào "Chào [Tên] 💗" từng chữ một (dùng textContent → an toàn, không chèn HTML) */
  function buildHero(name) {
    const full = 'Chào ' + name + ' 💗';
    heroTitle.textContent = '';
    const words = full.split(' ');
    let idx = 0;
    words.forEach((w, wi) => {
      const ws = document.createElement('span');
      ws.className = 'word';
      Array.from(w).forEach((ch) => {
        const c = document.createElement('span');
        c.className = 'ch'; c.textContent = ch;
        c.style.setProperty('--i', idx++);
        ws.appendChild(c);
      });
      heroTitle.appendChild(ws);
      if (wi < words.length - 1) { heroTitle.appendChild(document.createTextNode(' ')); idx++; }
    });
    heroTitle.classList.toggle('long', full.length > 16);
    heroTitle.setAttribute('aria-label', full);
    heroSub.style.setProperty('--d', (0.55 + idx * 0.07 + 0.35).toFixed(2) + 's');
    return idx;
  }

  function messages(name) {
    return [
      'Hãy để hôm nay trở nên thật dịu dàng nhé.',
      'Bạn xứng đáng với thật nhiều điều dễ thương.',
      'Chỉ cần mỉm cười thôi, mọi thứ sẽ nhẹ nhàng hơn.',
      'Có ai đó đang nghĩ về bạn với thật nhiều yêu thương.',
      'Cảm ơn vì bạn đã ở đây, ' + name + ' ạ.'
    ];
  }

  function nextMessage() {
    const list = messages(userName);
    msgIndex = (msgIndex + 1) % list.length;
    cardMsg.classList.add('swap');
    setTimeout(() => { cardMsg.textContent = list[msgIndex]; cardMsg.classList.remove('swap'); }, 280);
  }

  function flash() {
    flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on');
  }

  function bigHeart() {
    const el = document.createElement('div');
    el.className = 'big-heart';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 32 29.6"><path fill="url(#bhg)" d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4c0,9.4,9.5,11.9,16,21.2c6.1-9.3,16-12.1,16-21.2C32,3.8,28.2,0,23.6,0z"/></svg>';
    document.body.appendChild(el);
    const remove = () => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 2600);   // dự phòng
  }

  // --- Nút "✨ Nhấn vào đây" ---
  btnMagic.addEventListener('click', () => {
    if (magicBusy) return;
    magicBusy = true; setTimeout(() => { magicBusy = false; }, 900);

    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');   // rung nhẹ
    bigHeart();                                                                          // trái tim lớn
    const r = btnMagic.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 1.5);                               // sparkle burst
    setTimeout(() => burst(W * 0.5, H * 0.42, 1.8), 220);
    rise(reduced ? 600 : 2200, 1.4);                                                      // hàng loạt tim bay lên
    flash();                                                                              // nền sáng lên rồi trở lại
    nextMessage();
    sfx.magic();
  });

  /* =========================================================
     8. VÒNG LẶP CHÍNH (requestAnimationFrame)
     ========================================================= */
  let raf = 0, last = 0, clock = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);   // chặn dt quá lớn khi tab bị treo
    last = now; clock += dt;
    drawBg(clock, dt);
    updateFx(clock, dt, now);
    updateParallax(clock, dt, now);
  }
  function startLoop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // Tab ẩn → dừng hẳn vòng lặp để tiết kiệm pin
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else startLoop();
  });

  /* ---------- Khởi động ---------- */
  resize();
  startLoop();

  // Ẩn loader sau khi tải xong (tối thiểu ~0.8s cho mượt, có dự phòng)
  let loaderDone = false;
  const hideLoader = () => {
    if (loaderDone) return;
    loaderDone = true;
    document.body.classList.remove('is-loading');
    setTimeout(() => { if (!started) input.focus({ preventScroll: true }); }, 1200);
  };
  if (document.readyState === 'complete') setTimeout(hideLoader, 800);
  else window.addEventListener('load', () => setTimeout(hideLoader, 800));
  setTimeout(hideLoader, 3000);
})();
