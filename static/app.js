(function () {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;

  // Toggles (mobile nav, user dropdown)
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelector(btn.dataset.toggle)?.classList.toggle('open');
    });
  });
  document.addEventListener('click', e => {
    const menu = document.getElementById('user-menu');
    if (menu && !menu.contains(e.target)) menu.classList.remove('open');
  });

  // Flash messages: dismiss + auto-hide
  document.querySelectorAll('.flash').forEach(f => {
    f.querySelector('.flash-x')?.addEventListener('click', () => f.remove());
    setTimeout(() => { f.style.transition = 'opacity .4s'; f.style.opacity = '0'; setTimeout(() => f.remove(), 400); }, 6000);
  });

  // Confirm before destructive actions
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', e => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
  });

  // Auto-submit selects (role picker)
  document.querySelectorAll('select[data-autosubmit]').forEach(s => s.addEventListener('change', () => s.form.submit()));

  // Like button
  document.querySelectorAll('[data-like]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await fetch(btn.dataset.like, { method: 'POST', headers: { 'X-CSRFToken': csrf } });
        if (r.ok) {
          const d = await r.json();
          btn.classList.toggle('liked', d.liked);
          btn.querySelector('.like-count').textContent = d.count;
          btn.classList.add('bump'); setTimeout(() => btn.classList.remove('bump'), 200);
        }
      } finally { btn.disabled = false; }
    });
  });

  // Copy link
  document.querySelectorAll('[data-share]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const label = btn.querySelector('span');
      try { await navigator.clipboard.writeText(btn.dataset.share); label.textContent = 'Link copied!'; }
      catch { label.textContent = btn.dataset.share; }
      setTimeout(() => label.textContent = 'Copy link', 2000);
    });
  });

  // Animated counters in the hero
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10) || 0;
    if (target < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let n = 0; const step = Math.max(1, Math.ceil(target / 30));
    el.textContent = '0';
    const t = setInterval(() => { n = Math.min(target, n + step); el.textContent = n; if (n >= target) clearInterval(t); }, 25);
  });

  // Editor: write / preview tabs, word count, paper-only fields
  const editor = document.getElementById('editor');
  if (editor) {
    const body = document.getElementById('body');
    const preview = document.getElementById('preview');
    const wc = document.getElementById('wordcount');
    const count = () => wc.textContent = (body.value.trim().match(/\S+/g) || []).length;
    body.addEventListener('input', count); count();

    editor.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', async () => {
      editor.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      const isPreview = tab.dataset.tab === 'preview';
      body.hidden = isPreview; preview.hidden = !isPreview;
      if (isPreview) {
        preview.innerHTML = '<p class="muted">Rendering…</p>';
        const fd = new FormData(); fd.append('body', body.value);
        const r = await fetch(tab.dataset.previewUrl, { method: 'POST', body: fd, headers: { 'X-CSRFToken': csrf } });
        const d = await r.json();
        preview.innerHTML = d.html || '<p class="muted">Nothing to preview yet.</p>';
      }
    }));

    const paperOnly = editor.querySelectorAll('[data-show-for="paper"]');
    const sync = () => {
      const cat = editor.querySelector('input[name=category]:checked')?.value;
      paperOnly.forEach(el => el.style.display = cat === 'paper' ? '' : 'none');
    };
    editor.querySelectorAll('input[name=category]').forEach(r => r.addEventListener('change', sync)); sync();

    // Warn before leaving with unsaved changes
    let dirty = false;
    editor.addEventListener('input', () => dirty = true);
    editor.addEventListener('submit', () => dirty = false);
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
})();

// Hero: interactive neural-network animation. Signals flow left to right through
// the layers; neurons and connections near the mouse light up in UCI gold.
(function () {
  const hero = document.getElementById('hero');
  const canvas = hero && hero.querySelector('.hero-net');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GOLD = '255,210,0', WHITE = '255,255,255';
  let W = 0, H = 0, dpr = 1, nodes = [], edges = [], pulses = [], mouse = null, last = 0, visible = true;

  function build() {
    const r = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const narrow = W < 760;
    const layers = narrow ? [3, 5, 5, 3] : [4, 6, 7, 6, 4, 2];
    const x0 = narrow ? W * 0.08 : W * 0.58, x1 = W * 0.96;
    nodes = []; edges = []; pulses = [];
    layers.forEach((n, li) => {
      const x = x0 + (x1 - x0) * (li / (layers.length - 1));
      for (let i = 0; i < n; i++) {
        const y = H * 0.14 + (H * 0.72) * ((i + 0.5) / n);
        nodes.push({ layer: li, bx: x, by: y, x, y, phase: Math.random() * 6.28, glow: 0, fire: 0, r: narrow ? 3 : 3.6 });
      }
    });
    nodes.forEach((a, i) => nodes.forEach((b, j) => {
      if (b.layer === a.layer + 1 && Math.random() < 0.75) edges.push({ a: i, b: j, w: 0.35 + Math.random() * 0.65, glow: 0 });
    }));
    if (reduce) draw(0);
  }

  function spawn(fromNode) {
    const out = edges.filter(e => fromNode == null ? nodes[e.a].layer === 0 : e.a === fromNode);
    if (!out.length) return;
    const e = out[Math.floor(Math.random() * out.length)];
    pulses.push({ e, t: 0, speed: 0.6 + Math.random() * 0.5 });
  }

  function draw(time) {
    const dt = Math.min(0.05, (time - last) / 1000 || 0); last = time;
    ctx.clearRect(0, 0, W, H);
    const R = Math.max(140, Math.min(W, H) * 0.35);

    nodes.forEach(n => {
      if (!reduce) { n.x = n.bx + Math.sin(time / 1400 + n.phase) * 4; n.y = n.by + Math.cos(time / 1700 + n.phase) * 5; }
      const d = mouse ? Math.hypot(n.x - mouse.x, n.y - mouse.y) : 1e9;
      const target = d < R ? 1 - d / R : 0;
      n.glow += (target - n.glow) * 0.12;
      n.fire = Math.max(0, n.fire - dt * 1.8);
    });

    // connections
    edges.forEach(e => {
      const a = nodes[e.a], b = nodes[e.b];
      const g = Math.max(a.glow, b.glow);
      e.glow += (g - e.glow) * 0.15;
      const alpha = 0.08 + e.w * 0.08 + e.glow * 0.55;
      ctx.strokeStyle = e.glow > 0.15 ? `rgba(${GOLD},${alpha})` : `rgba(${WHITE},${alpha})`;
      ctx.lineWidth = 0.7 + e.glow * 1.4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });

    // signals travelling along connections
    if (!reduce) {
      if (Math.random() < dt * 2.2) spawn(null);
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i], a = nodes[p.e.a], b = nodes[p.e.b];
        p.t += dt * p.speed * (1 + Math.max(a.glow, b.glow) * 1.5);
        if (p.t >= 1) {
          b.fire = 1; pulses.splice(i, 1);
          if (Math.random() < 0.85) spawn(p.e.b);
          continue;
        }
        const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
        const hot = Math.max(a.glow, b.glow) > 0.15;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, 9);
        grad.addColorStop(0, `rgba(${hot ? GOLD : WHITE},0.95)`); grad.addColorStop(1, `rgba(${hot ? GOLD : WHITE},0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.29); ctx.fill();
      }
      if (pulses.length > 70) pulses.splice(0, pulses.length - 70);
    }

    // neurons
    nodes.forEach(n => {
      const heat = Math.max(n.glow, n.fire * 0.8);
      if (heat > 0.02) {
        const rr = n.r * (3 + heat * 5);
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr);
        grad.addColorStop(0, `rgba(${GOLD},${0.55 * heat})`); grad.addColorStop(1, `rgba(${GOLD},0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, 6.29); ctx.fill();
      }
      ctx.fillStyle = heat > 0.15 ? `rgba(${GOLD},${0.75 + heat * 0.25})` : 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (1 + heat * 0.6), 0, 6.29); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.5, 0, 6.29); ctx.stroke();
    });

    if (!reduce && visible) requestAnimationFrame(draw);
  }

  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    const first = !mouse;
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (reduce) { draw(0); return; }
    // hovering near a neuron makes it fire
    let best = -1, bd = 60;
    nodes.forEach((n, i) => { const d = Math.hypot(n.x - mouse.x, n.y - mouse.y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && (first || Math.random() < 0.25)) { nodes[best].fire = 1; spawn(best); }
  });
  hero.addEventListener('pointerleave', () => { mouse = null; if (reduce) draw(0); });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => {
      const was = visible; visible = en.isIntersecting;
      if (visible && !was && !reduce) requestAnimationFrame(t => { last = t; draw(t); });
    }).observe(hero);
  }
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(build, 150); });
  build();
  if (!reduce) requestAnimationFrame(t => { last = t; draw(t); });
})();

// Category banners: a different gentle, mouse-reactive scene for each category.
(function () {
  const hero = document.getElementById('cat-hero');
  const canvas = hero && hero.querySelector('.cat-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const mode = hero.dataset.mode;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GOLD = '255,210,0', WHITE = '255,255,255';
  let W = 0, H = 0, mouse = null, sm = null, last = 0, visible = true, S = {};
  const rnd = (a, b) => a + Math.random() * (b - a);
  const near = (x, y, R) => sm ? Math.max(0, 1 - Math.hypot(x - sm.x, y - sm.y) / R) : 0;
  const glowDot = (x, y, r, color, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
  };
  const leftFade = x => Math.min(1, Math.max(0.25, (x / W - 0.2) / 0.4)); // keep text side calm

  const scenes = {
    // Papers: drifting "documents" linked into a citation web
    paper: {
      init() {
        const n = Math.round(Math.min(46, W / 28));
        S.docs = Array.from({ length: n }, () => ({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-.12, .12), vy: rnd(-.08, .08), s: rnd(.8, 1.3), rot: rnd(-.3, .3), g: 0 }));
      },
      draw(dt) {
        const D = S.docs, link = Math.min(170, W / 6);
        D.forEach(d => { d.x += d.vx * dt * 60; d.y += d.vy * dt * 60;
          if (d.x < -20) d.x = W + 20; if (d.x > W + 20) d.x = -20; if (d.y < -20) d.y = H + 20; if (d.y > H + 20) d.y = -20;
          d.g += (near(d.x, d.y, 200) - d.g) * .1; });
        for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) {
          const a = D[i], b = D[j], dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > link) continue;
          const g = Math.max(a.g, b.g), f = (1 - dist / link) * leftFade((a.x + b.x) / 2);
          ctx.strokeStyle = g > .1 ? `rgba(${GOLD},${f * (.15 + g * .7)})` : `rgba(${WHITE},${f * .16})`;
          ctx.lineWidth = .6 + g * 1.2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        D.forEach(d => {
          const f = leftFade(d.x);
          if (d.g > .05) glowDot(d.x, d.y, 26 * d.s, GOLD, .35 * d.g);
          ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot); ctx.scale(d.s, d.s);
          ctx.fillStyle = d.g > .1 ? `rgba(${GOLD},${.6 + d.g * .4})` : `rgba(${WHITE},${.55 * f})`;
          ctx.fillRect(-5, -7, 10, 14);
          ctx.fillStyle = 'rgba(11,35,64,.55)'; for (let k = 0; k < 3; k++) ctx.fillRect(-3, -4 + k * 3.2, 6 - (k === 2 ? 2 : 0), 1);
          ctx.restore();
        });
      }
    },
    // AI News: broadcast ripples; waves rise toward the cursor
    news: {
      init() { S.rings = []; S.t = 0; S.src = [{ x: W * .68, y: H * .55 }, { x: W * .95, y: H * .15 }]; },
      draw(dt, time) {
        S.t += dt;
        if (S.t > .9) { S.t = 0; S.src.forEach(s => S.rings.push({ x: s.x, y: s.y, r: 4 })); }
        if (sm && Math.random() < dt * 2) S.rings.push({ x: sm.x, y: sm.y, r: 2, gold: true });
        S.rings = S.rings.filter(r => (r.r += dt * 55) < Math.max(W, H) * .6);
        S.rings.forEach(r => {
          const a = Math.max(0, 1 - r.r / (Math.max(W, H) * .6));
          ctx.strokeStyle = `rgba(${r.gold ? GOLD : WHITE},${a * (r.gold ? .55 : .28)})`; ctx.lineWidth = r.gold ? 1.6 : 1.1;
          ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.29); ctx.stroke();
        });
        // flowing data lines
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          for (let x = 0; x <= W; x += 8) {
            const g = near(x, H * (.2 + k * .15), 220);
            const y = H * (.2 + k * .15) + Math.sin(x / 70 + time / 900 + k) * (6 + g * 22);
            x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.strokeStyle = `rgba(${WHITE},${.07 + k * .015})`; ctx.lineWidth = 1; ctx.stroke();
        }
        S.src.forEach(s => glowDot(s.x, s.y, 18, GOLD, .5));
      }
    },
    // Lab Updates: a twinkling constellation that reaches toward the cursor
    update: {
      init() {
        const n = Math.round(Math.min(110, W / 11));
        S.stars = Array.from({ length: n }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(.5, 1.8), p: rnd(0, 6.28), vx: rnd(-.05, .05), vy: rnd(-.04, .04) }));
      },
      draw(dt, time) {
        S.stars.forEach(s => {
          s.x = (s.x + s.vx * dt * 60 + W) % W; s.y = (s.y + s.vy * dt * 60 + H) % H;
          const tw = .45 + .55 * Math.sin(time / 700 + s.p), g = near(s.x, s.y, 190);
          if (g > 0) {
            ctx.strokeStyle = `rgba(${GOLD},${g * .55})`; ctx.lineWidth = .8;
            ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(sm.x, sm.y); ctx.stroke();
          }
          if (g > .2) glowDot(s.x, s.y, 10, GOLD, g * .6);
          ctx.fillStyle = g > .2 ? `rgba(${GOLD},1)` : `rgba(${WHITE},${tw * .8 * leftFade(s.x)})`;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r + g * 1.2, 0, 6.29); ctx.fill();
        });
        if (sm) glowDot(sm.x, sm.y, 30, GOLD, .25);
      }
    },
    // Events: particles orbiting like a calendar of dates; orbits lean toward the cursor
    event: {
      init() {
        S.cx = W * .68; S.cy = H * .5;
        S.orbits = [40, 72, 104, 136, 168].map((r, i) => ({ r, tilt: .45, items: Array.from({ length: 3 + i * 2 }, (_, k) => ({ a: k / (3 + i * 2) * 6.28 + rnd(0, .4), sp: (.35 - i * .05) * (i % 2 ? -1 : 1) })) }));
      },
      draw(dt) {
        const tx = sm ? S.cx + (sm.x - S.cx) * .08 : W * .68, ty = sm ? S.cy + (sm.y - S.cy) * .08 : H * .5;
        S.cx += (tx - S.cx) * .05; S.cy += (ty - S.cy) * .05;
        glowDot(S.cx, S.cy, 46, GOLD, .45);
        ctx.fillStyle = `rgba(${GOLD},.95)`; ctx.beginPath(); ctx.arc(S.cx, S.cy, 6, 0, 6.29); ctx.fill();
        S.orbits.forEach(o => {
          ctx.strokeStyle = `rgba(${WHITE},.12)`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(S.cx, S.cy, o.r, o.r * o.tilt, -.25, 0, 6.29); ctx.stroke();
          o.items.forEach(it => {
            it.a += it.sp * dt;
            const c = Math.cos(-.25), s = Math.sin(-.25), ex = Math.cos(it.a) * o.r, ey = Math.sin(it.a) * o.r * o.tilt;
            const x = S.cx + ex * c - ey * s, y = S.cy + ex * s + ey * c, g = near(x, y, 120);
            if (g > .1) glowDot(x, y, 14, GOLD, g * .7);
            ctx.fillStyle = g > .1 ? `rgba(${GOLD},1)` : `rgba(${WHITE},${.5 + .4 * Math.sin(it.a)})`;
            ctx.beginPath(); ctx.arc(x, y, 2.2 + g * 1.5, 0, 6.29); ctx.fill();
          });
        });
      }
    },
    // Tutorials: a loss landscape; particles do gradient descent toward a minimum that follows the cursor
    tutorial: {
      init() {
        S.min = { x: W * .68, y: H * .5 };
        S.ps = Array.from({ length: 60 }, () => ({ x: rnd(W * .4, W), y: rnd(0, H), trail: [] }));
      },
      draw(dt) {
        const target = sm || { x: W * .68, y: H * .5 };
        S.min.x += (target.x - S.min.x) * .04; S.min.y += (target.y - S.min.y) * .04;
        for (let k = 1; k <= 9; k++) {
          ctx.strokeStyle = `rgba(${WHITE},${.16 - k * .013})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(S.min.x, S.min.y, k * 34, k * 21, .2, 0, 6.29); ctx.stroke();
        }
        glowDot(S.min.x, S.min.y, 34, GOLD, .5);
        S.ps.forEach(p => {
          const dx = S.min.x - p.x, dy = S.min.y - p.y, d = Math.hypot(dx, dy);
          const step = Math.min(d, (18 + d * .9) * dt);
          p.x += dx / (d || 1) * step + Math.sin(p.y / 30) * .25; p.y += dy / (d || 1) * step * 1.4;
          p.trail.push([p.x, p.y]); if (p.trail.length > 14) p.trail.shift();
          if (d < 10) { p.x = rnd(0, W); p.y = Math.random() < .5 ? -10 : H + 10; p.trail = []; }
          const g = near(p.x, p.y, 160);
          ctx.strokeStyle = `rgba(${g > .1 ? GOLD : WHITE},${(.25 + g * .4) * leftFade(p.x)})`; ctx.lineWidth = 1;
          ctx.beginPath(); p.trail.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
          ctx.fillStyle = g > .1 ? `rgba(${GOLD},1)` : `rgba(${WHITE},${.75 * leftFade(p.x)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 + g, 0, 6.29); ctx.fill();
        });
      }
    }
  };
  const scene = scenes[mode];
  if (!scene) return;

  function size() {
    const r = hero.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); S = {}; scene.init();
  }
  function frame(time) {
    const dt = Math.min(.05, (time - last) / 1000 || 0); last = time;
    if (mouse) sm = sm ? { x: sm.x + (mouse.x - sm.x) * .2, y: sm.y + (mouse.y - sm.y) * .2 } : { ...mouse }; else sm = null;
    ctx.clearRect(0, 0, W, H); scene.draw(reduce ? 0 : dt, reduce ? 0 : time);
    if (!reduce && visible) requestAnimationFrame(frame);
  }
  hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; if (reduce) frame(0); });
  hero.addEventListener('pointerleave', () => { mouse = null; if (reduce) frame(0); });
  if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => {
    const was = visible; visible = en.isIntersecting;
    if (visible && !was && !reduce) requestAnimationFrame(t => { last = t; frame(t); });
  }).observe(hero);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(size, 150); });
  size(); requestAnimationFrame(t => { last = t; frame(t); });
})();
