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
