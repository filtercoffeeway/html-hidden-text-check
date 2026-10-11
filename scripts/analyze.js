// Runs inside the rendered page, in an isolated JS world (the page's own scripts
// share the DOM but cannot see or patch anything defined here).
// Evaluates to an async function(opts) -> report object.
async (opts) => {
  const MAX_TEXT = 300;
  const clip = s => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s);
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- helpers ----------
  const pathOf = el => {
    const parts = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 5; e = e.parentElement, i++) {
      let p = e.localName;
      if (e.id) p += '#' + e.id;
      else if (typeof e.className === 'string' && e.className.trim())
        p += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.');
      parts.unshift(p);
      if (e.id) break;
    }
    return parts.join(' > ');
  };

  const parseRGBA = s => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
  };
  const lum = c => {
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // First opaque-ish background behind el; null if an image/gradient is in the way.
  const backgroundOf = el => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parseRGBA(cs.backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  // Why is el not rendered? Walk up to the first ancestor that explains it.
  const whyHidden = el => {
    if (el.closest('select, datalist')) return 'select-option';
    for (let e = el; e; e = e.parentElement) {
      if (e.localName === 'details' && !e.open && e !== el) return 'collapsed-details';
      const cs = getComputedStyle(e);
      if (cs.display === 'none') return e.hasAttribute('hidden') ? 'hidden-attribute' : 'display-none';
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return 'visibility-hidden';
      if (parseFloat(cs.opacity) === 0) return 'opacity-zero';
      if (cs.contentVisibility === 'hidden') return 'content-visibility-hidden';
    }
    return 'not-rendered';
  };

  const isVisibleBasic = el =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });

  // Visible area of a rect after clipping by overflow/clip ancestors.
  const clippedArea = (rect, el) => {
    let x1 = rect.left, y1 = rect.top, x2 = rect.right, y2 = rect.bottom;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const clipsX = cs.overflowX !== 'visible', clipsY = cs.overflowY !== 'visible';
      const rectClip = cs.clip && cs.clip !== 'auto' && cs.position.match(/absolute|fixed/);
      if (clipsX || clipsY || rectClip) {
        const b = e.getBoundingClientRect();
        if (clipsX || rectClip) { x1 = Math.max(x1, b.left); x2 = Math.min(x2, b.right); }
        if (clipsY || rectClip) { y1 = Math.max(y1, b.top); y2 = Math.min(y2, b.bottom); }
        if (rectClip && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip)) return 0;
      }
      if (cs.clipPath && cs.clipPath !== 'none') {
        if (/inset\(\s*50%|circle\(\s*0|polygon\(\s*0(px)?\s+0(px)?\s*,\s*0(px)?\s+0(px)?\s*,\s*0(px)?\s+0(px)?\s*\)/.test(cs.clipPath)) return 0;
      }
    }
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  };

  // Full check for one text node: null if a person can see it, else a reason.
  const textHiddenReason = (tn) => {
    const el = tn.parentElement;
    if (!isVisibleBasic(el)) return whyHidden(el);
    const range = document.createRange();
    range.selectNodeContents(tn);
    const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) return 'zero-size';
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) < 4) return 'tiny-font';
    if (el instanceof SVGElement) {
      if (cs.fill === 'none' || parseFloat(cs.fillOpacity) === 0) {
        if (cs.stroke === 'none' || parseFloat(cs.strokeOpacity) === 0) return 'transparent-text';
      }
    } else {
      const fg = parseRGBA(cs.color);
      if (fg && fg.a < 0.1) return 'transparent-text';
    }
    const W = Math.max(document.documentElement.scrollWidth, innerWidth);
    const H = Math.max(document.documentElement.scrollHeight, innerHeight);
    const onPage = rects.filter(r => {
      const x = r.left + scrollX, y = r.top + scrollY;
      return x + r.width > 0 && y + r.height > 0 && x < W && y < H;
    });
    if (!onPage.length) return 'off-screen';
    const area = onPage.reduce((s, r) => s + clippedArea(r, el), 0);
    if (area < 4) {
      const b = el.getBoundingClientRect();
      if (b.width <= 2 && b.height <= 2 && /absolute|fixed/.test(cs.position)) return 'screen-reader-only';
      return 'clipped';
    }
    if (!(el instanceof SVGElement)) {
      const fg = parseRGBA(cs.color), bg = backgroundOf(el);
      if (fg && bg && contrast(fg, bg) < 1.4) return 'low-contrast';
    }
    // Covered by another element?
    const r = onPage[0];
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        const hcs = getComputedStyle(hit);
        const hbg = parseRGBA(hcs.backgroundColor);
        if (hbg && hbg.a > 0.9 && parseFloat(hcs.opacity) > 0.9) return 'covered';
      }
    }
    return null;
  };

  const UI_RX = /modal|dialog|popup|popover|toast|tooltip|dropdown|menu|drawer|overlay|wizard|step|banner|empty|loading|spinner|error|success|alert|notification|onboarding|tutorial/i;
  const isUiState = el => {
    if (el.closest('dialog,[role=dialog],[role=alertdialog],[role=tooltip],[role=menu],[role=alert],[role=status],[aria-modal]')) return true;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const tag = (e.id || '') + ' ' + (typeof e.className === 'string' ? e.className : '');
      if (UI_RX.test(tag)) return true;
    }
    return false;
  };
  const isControl = el => !!el.closest('button,a,label,summary,[role=button],[role=tab],[role=menuitem]');

  const SKIP = 'script,style,noscript,template,head,title';
  const textNodes = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement || n.parentElement.closest(SKIP)) continue;
    const t = norm(n.data);
    if (t) textNodes.push(n);
  }

  // ---------- pass 1: what is hidden right now ----------
  const hidden = new Map();          // node -> reason
  const visibleTexts = [];
  for (const n of textNodes) {
    const why = textHiddenReason(n);
    if (why) hidden.set(n, { why, el: n.parentElement }); else visibleTexts.push(norm(n.data));
  }

  // ---------- pass 2: click through the page's own controls ----------
  const revealed = new Set();
  let clicks = 0;
  if (opts.explore && hidden.size) {
    const controls = [...document.querySelectorAll(
      'button, summary, [role=tab], [role=button], [onclick], [aria-expanded], [aria-controls], [data-tab], [data-target]'
    )].filter(c => !c.closest('a[href]') && isVisibleBasic(c)).slice(0, opts.maxClicks);
    for (const c of controls) {
      try { c.click(); clicks++; } catch (e) { continue; }
      await sleep(80);
      for (const [n] of hidden) {
        if (!revealed.has(n) && n.isConnected && isVisibleBasic(n.parentElement)) {
          const range = document.createRange(); range.selectNodeContents(n);
          if ([...range.getClientRects()].some(r => r.width > 0.5 && r.height > 0.5) && !textHiddenReason(n)) revealed.add(n);
        }
      }
    }
  }

  // ---------- other places text hides ----------
  const comments = [];
  const cw = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
  for (let n = cw.nextNode(); n; n = cw.nextNode()) {
    const t = norm(n.data);
    if (t) comments.push({ text: clip(t), where: n.parentElement ? pathOf(n.parentElement) : 'document' });
  }

  const attributes = [];
  const ATTRS = ['alt', 'title', 'aria-label', 'aria-description', 'aria-roledescription', 'placeholder'];
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      const isData = a.name.startsWith('data-');
      const isMeta = el.localName === 'meta' && a.name === 'content';
      if (!ATTRS.includes(a.name) && !isData && !isMeta) continue;
      const t = norm(a.value);
      const words = t.split(' ').filter(w => /[a-z]{2,}/i.test(w)).length;
      if (words < 3) continue;
      if (isData && /^[\[{]/.test(t)) continue;   // JSON config, not prose
      attributes.push({ attr: a.name, text: clip(t), length: t.length, where: pathOf(el) });
    }
  }

  const templates = [...document.querySelectorAll('template')]
    .map(t => ({ text: clip(norm(t.content.textContent || '')), where: pathOf(t) })).filter(t => t.text);
  const noscripts = [...document.querySelectorAll('noscript')]
    .map(t => ({ text: clip(norm(t.textContent || '').replace(/<[^>]+>/g, ' ')), where: pathOf(t) }))
    .filter(t => t.text);
  const JS_TYPES = ['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript', 'importmap'];
  const dataBlocks = [...document.querySelectorAll('script')]
    .filter(s => !JS_TYPES.includes((s.type || '').toLowerCase()))
    .map(s => ({ type: s.type, text: clip(norm(s.textContent || '')), where: pathOf(s) }))
    .filter(s => s.text.split(' ').filter(w => /^[a-z]{3,}$/i.test(w)).length >= 5);

  const generated = [];
  for (const el of document.querySelectorAll('body *')) {
    for (const pseudo of ['::before', '::after']) {
      const c = getComputedStyle(el, pseudo).content;
      if (c && c.startsWith('"') && norm(c.slice(1, -1)).length > 3)
        generated.push({ text: clip(norm(c.slice(1, -1))), where: pathOf(el) + pseudo });
    }
  }

  return {
    // el is the parent captured at detection; a click may have detached the node since.
    hidden: [...hidden].map(([n, { why, el }]) => ({
      text: clip(norm(n.data)), reason: why, where: pathOf(el), revealed: revealed.has(n),
      ui: isUiState(el), control: isControl(el),
    })),
    allTexts: textNodes.map(n => norm(n.data)),
    visibleTexts,
    comments, attributes, templates, noscripts, dataBlocks, generated,
    stats: { textNodes: textNodes.length, clicks },
  };
}
