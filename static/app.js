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
