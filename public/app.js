// DariTap — клиенттік бөлім (ванилла JS, hash-маршрутизация).
// Ескерту: рөл тексерулері мұнда тек интерфейс үшін. Нақты қорғаныс серверде (server.js).
(() => {
  'use strict';

  // ---------- Көмекшілер ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* сақтау мүмкін емес */ } }
  };

  const CATEGORIES = ['pain', 'antibiotic', 'allergy', 'digestive', 'vitamins', 'endocrine', 'solutions'];
  const CAT_COLORS = {
    pain: '#0e9f5b', antibiotic: '#2f6fd6', allergy: '#8a5cd6', digestive: '#e07b39',
    vitamins: '#c99400', endocrine: '#d94f70', solutions: '#1b9fb3'
  };
  const FILE_EXT = ['pdf', 'jpg', 'jpeg', 'png'];
  const FILE_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
  const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

  const state = {
    lang: LS.get('daritap_lang', 'kk') === 'en' ? 'en' : 'kk',
    user: null,
    config: { operatorLicense: null, maxFileBytes: 5 * 1024 * 1024 },
    cart: sanitizeCart(LS.get('daritap_cart', [])),
    filters: { q: '', category: '', min: '', max: '', avail: '' },
    lastOrders: null,
    flash: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');

  function t(key, vars) {
    let s = (I18N[state.lang] && I18N[state.lang][key]) ?? I18N.kk[key] ?? key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : o[state.lang] || o.kk || '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₸';
  const todayStr = () => new Date().toISOString().slice(0, 10);

  function fmtDate(v, withTime = false) {
    if (!v) return '—';
    const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
    if (Number.isNaN(d.getTime())) return esc(v);
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString(state.lang === 'en' ? 'en-GB' : 'ru-RU', opts);
  }

  class ApiError extends Error {
    constructor(status, code, fields) { super(code); this.status = status; this.code = code; this.fields = fields; }
  }

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new ApiError(0, 'network');
    }
    let data = {};
    try { data = await res.json(); } catch { /* бос жауап */ }
    if (!res.ok) throw new ApiError(res.status, data.error || 'generic', data.fields);
    return data;
  }

  function errText(e) {
    const key = 'err.' + (e && e.code);
    const s = t(key);
    return s === key ? t('err.generic') : s;
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  const go = (path) => { location.hash = '#' + path; };

  // ---------- Себет ----------
  function sanitizeCart(c) {
    if (!Array.isArray(c)) return [];
    return c
      .filter((x) => x && typeof x.id === 'string' && Number.isInteger(x.qty) && x.qty > 0)
      .map((x) => ({ id: x.id, qty: Math.min(99, x.qty) }));
  }
  const cartCount = () => state.cart.reduce((s, x) => s + x.qty, 0);
  function saveCart() {
    LS.set('daritap_cart', state.cart);
    const el = $('#cartCount');
    if (el) el.textContent = cartCount();
  }
  function addToCart(id, qty, max) {
    const it = state.cart.find((x) => x.id === id);
    const next = Math.min(max, (it ? it.qty : 0) + qty, 99);
    if (it) it.qty = next; else state.cart.push({ id, qty: next });
    saveCart();
    toast(t('p.added'));
  }

  // ---------- Файлдар ----------
  function checkFile(file) {
    if (!file) return 'file_required';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!FILE_EXT.includes(ext) || (file.type && !FILE_MIME.includes(file.type))) return 'file_type';
    if (file.size > state.config.maxFileBytes) return 'file_too_large';
    return null;
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, data: String(r.result).split(',')[1] || '' });
      r.onerror = () => reject(new ApiError(0, 'generic'));
      r.readAsDataURL(file);
    });
  }
  const fmtSize = (b) => (b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB');

  // ---------- Форма көмекшілері ----------
  function field(name, label, input, opts = {}) {
    return `<div class="field" data-field="${name}">
      <label for="f_${name}">${label}${opts.required ? ' <span class="req">*</span>' : ''}${opts.optional ? ` <span class="muted small">(${t('form.optional')})</span>` : ''}</label>
      ${input}
      ${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}
      <div class="err" data-err="${name}"></div>
    </div>`;
  }
  const inputEl = (name, attrs = '') => `<input id="f_${name}" name="${name}" ${attrs}>`;

  function showErrors(form, fields) {
    $$('.field', form).forEach((f) => f.classList.remove('invalid'));
    $$('[data-err]', form).forEach((e) => { e.textContent = ''; });
    let first = null;
    Object.entries(fields || {}).forEach(([name, code]) => {
      const wrap = $(`[data-field="${name}"]`, form);
      const err = $(`[data-err="${name}"]`, form);
      if (wrap) wrap.classList.add('invalid');
      if (err) err.textContent = t('err.' + code) !== 'err.' + code ? t('err.' + code) : t('err.generic');
      if (!first && wrap) first = wrap;
    });
    if (first) {
      const inp = $('input, select, textarea', first);
      if (inp) inp.focus();
    }
    return !first;
  }
  function formAlert(form, html, kind = 'error') {
    const box = $('.form-alert', form);
    if (box) box.innerHTML = html ? `<div class="alert alert-${kind}">${html}</div>` : '';
  }
  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = t('form.sending'); btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  // ---------- Визуалды бөліктер ----------
  const ICONS = {
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>'
  };

  // Ойдан жасалған фото емес — тек санат түсіндегі шартты сурет.
  function productSvg(p) {
    const c = CAT_COLORS[p.category] || '#0e9f5b';
    let shape;
    if (p.image === 'capsule') {
      shape = `<g transform="rotate(-28 160 112)"><rect x="92" y="88" width="136" height="50" rx="25" fill="#fff" stroke="${c}" stroke-width="4"/><path d="M160 88h43a25 25 0 0 1 0 50h-43z" fill="${c}"/></g>
        <g transform="rotate(18 222 160)"><rect x="196" y="148" width="64" height="24" rx="12" fill="#fff" stroke="${c}" stroke-width="3" opacity=".9"/></g>`;
    } else if (p.image === 'bottle') {
      shape = `<rect x="140" y="40" width="40" height="22" rx="4" fill="${c}"/><rect x="146" y="60" width="28" height="12" fill="${c}" opacity=".5"/>
        <rect x="116" y="70" width="88" height="128" rx="18" fill="#fff" stroke="${c}" stroke-width="4"/><rect x="118" y="112" width="84" height="44" fill="${c}" opacity=".16"/>
        <path d="M152 126h16M160 118v16" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
    } else {
      shape = `<circle cx="138" cy="112" r="44" fill="#fff" stroke="${c}" stroke-width="4"/><line x1="108" y1="112" x2="168" y2="112" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="204" cy="140" r="30" fill="${c}" opacity=".85"/><line x1="186" y1="140" x2="222" y2="140" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
    }
    return `<svg viewBox="0 0 320 240" role="img" aria-label="${esc(L(p.name))}" xmlns="http://www.w3.org/2000/svg">
      <rect width="320" height="240" fill="${c}" fill-opacity=".08"/>${shape}
      <text x="16" y="224" font-size="14" fill="${c}" font-family="Inter, sans-serif" font-weight="600">${esc(L(p.dose))} · ${esc(L(p.pack))}</text></svg>`;
  }

  // Нақты фотолар public/img/products/ папкасында. Кілт — тауардың id-і (мысалы 'p-1'),
  // ол болмаса — INN (мысалы 'Paracetamol'). Фото жоқ болса, шартты сурет көрсетіледі.
  const PHOTOS = {
    Paracetamol: 'paracetamol.jpg',
    'Sodium chloride': 'sodium-chloride.jpg'
  };
  function productImg(p) {
    const file = PHOTOS[p.id] || PHOTOS[p.inn];
    if (!file) return productSvg(p);
    return `<img class="pphoto" src="/img/products/${esc(file)}" alt="${esc(L(p.name))} ${esc(L(p.dose))} · ${esc(L(p.pack))}" loading="lazy">`;
  }

  const licenseBadge = (status) => `<span class="badge badge-${esc(status)}">${t('lic.status.' + status)}</span>`;
  const rxChip = (p) => `<span class="chip ${p.rx ? 'chip-rx' : 'chip-otc'}">${p.rx ? t('p.rx') : t('p.otc')}</span>`;
  const demoTag = () => `<span class="demo-tag">${t('demo.tag')}</span>`;
  const stockLine = (p) => (p.stock > 0
    ? `<div class="stock-in">${t('p.inStock', { n: p.stock })}</div>`
    : `<div class="stock-out">${t('p.outOfStock')}</div>`);
  const orderStatus = (s) => `<span class="order-status s-${esc(s)}">${t('order.status.' + s)}</span>`;

  // ---------- Хедер / футер ----------
  function renderChrome() {
    $('#demoBanner').innerHTML = `${demoTag()} ${esc(t('demo.banner'))}`;
    const accLabel = state.user ? esc(state.user.name) : t('nav.login');
    $('#siteHeader').innerHTML = `<div class="header-inner">
      <a class="logo" href="#/" aria-label="DariTap"><img src="logo.svg" alt=""><span>Dari<b>Tap</b></span></a>
      <form class="search" id="searchForm" role="search">
        <input type="search" name="q" placeholder="${esc(t('nav.search'))}" aria-label="${esc(t('nav.search'))}" value="${esc(state.filters.q)}" maxlength="100" autocomplete="off">
        <button class="btn" type="submit">${t('nav.searchBtn')}</button>
      </form>
      <div class="header-actions">
        <button class="icon-btn" id="langBtn" type="button" title="${esc(t('nav.langTitle'))}">${ICONS.globe}<span>${t('nav.lang')}</span></button>
        <a class="icon-btn" href="#/account" title="${esc(t('nav.account'))}">${ICONS.user}<span class="lbl">${accLabel}</span></a>
        ${state.user ? `<button class="icon-btn" id="logoutBtn" type="button" title="${esc(t('nav.logout'))}">${ICONS.logout}<span class="lbl">${t('nav.logout')}</span></button>` : ''}
        <a class="icon-btn" href="#/cart" title="${esc(t('nav.cart'))}">${ICONS.cart}<span class="lbl">${t('nav.cart')}</span><span class="cart-count" id="cartCount">${cartCount()}</span></a>
      </div>
    </div>`;

    const searchForm = $('#searchForm');
    const searchInput = $('input', searchForm);
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      state.filters.q = searchInput.value.trim();
      if (parseHash().path === '/') loadResults(); else go('/');
    });
    searchInput.addEventListener('input', debounce(() => {
      if (parseHash().path !== '/') return;
      state.filters.q = searchInput.value.trim();
      loadResults();
    }, 300));
    $('#langBtn').addEventListener('click', () => {
      state.lang = state.lang === 'kk' ? 'en' : 'kk';
      LS.set('daritap_lang', state.lang);
      document.documentElement.lang = state.lang;
      router(false);
    });
    const lo = $('#logoutBtn');
    if (lo) lo.addEventListener('click', logout);

    const op = state.config.operatorLicense;
    let opHtml;
    if (!op) {
      opHtml = `<span class="badge badge-none">${t('footer.operatorNone')}</span>`;
    } else {
      // Тек config.json-да нақты берілген өрістер көрсетіледі.
      const rows = [['lic.org', op.orgName], ['lic.number', op.number], ['lic.issuer', op.issuer], ['lic.issueDate', op.issueDate && fmtDate(op.issueDate)], ['lic.expiry', op.expiryDate && fmtDate(op.expiryDate)]]
        .filter(([, v]) => v)
        .map(([k, v]) => `<div>${t(k)}: <b>${esc(v)}</b></div>`).join('');
      opHtml = rows || `<span class="badge badge-none">${t('footer.operatorNone')}</span>`;
    }
    $('#siteFooter').innerHTML = `<div class="footer-inner">
      <div>
        <div class="footer-logo">DariTap</div>
        <p class="small" style="margin:0 0 8px">${t('footer.about')}</p>
        <p class="small" style="margin:0">${t('footer.medical')}</p>
      </div>
      <div class="operator-box" id="operatorLicense">
        <h3>${t('footer.operator')}</h3>
        ${opHtml}
      </div>
    </div>
    <div class="footer-bottom">${t('footer.rights', { y: new Date().getFullYear() })}</div>`;
  }

  function debounce(fn, ms) {
    let h;
    return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
  }

  async function logout() {
    try { await api('POST', '/api/logout'); } catch { /* бәрібір шығамыз */ }
    state.user = null;
    if (parseHash().path === '/') router(false); else go('/');
  }

  // ---------- Маршрутизатор ----------
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const i = h.indexOf('?');
    return { path: i >= 0 ? h.slice(0, i) : h, query: new URLSearchParams(i >= 0 ? h.slice(i + 1) : '') };
  }

  const routes = [
    [/^\/$/, viewCatalog],
    [/^\/product\/([\w-]+)$/, viewProduct],
    [/^\/cart$/, viewCart],
    [/^\/checkout$/, viewCheckout],
    [/^\/order-success$/, viewOrderSuccess],
    [/^\/login$/, viewLogin],
    [/^\/account$/, viewAccount],
    [/^\/seller$/, () => go('/seller/license')],
    [/^\/seller\/(license|products|orders)$/, viewSeller],
    [/^\/seller\/product\/([\w-]+)$/, viewSellerProduct],
    [/^\/reviewer$/, viewReviewer],
    [/^\/reviewer\/app\/([\w-]+)$/, viewReviewerApp]
  ];

  let renderToken = 0;
  async function router(scroll = true) {
    const { path, query } = parseHash();
    const token = ++renderToken;
    renderChrome();
    app.innerHTML = `<p class="muted">${t('common.loading')}</p>`;
    if (scroll) window.scrollTo(0, 0);
    const ctx = {
      query,
      params: [],
      mount(html) {
        if (token !== renderToken) return false;
        app.innerHTML = html;
        return true;
      }
    };
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (!m) continue;
      ctx.params = m.slice(1);
      try {
        await fn(ctx);
      } catch (e) {
        if (e && e.status === 401) { state.user = null; go('/login?next=' + encodeURIComponent(path)); return; }
        ctx.mount(`<div class="alert alert-error">${esc(errText(e))}</div>`);
      }
      return;
    }
    ctx.mount(`<div class="empty">${t('err.not_found')}</div><p><a href="#/">${t('p.back')}</a></p>`);
  }

  // Интерфейстегі рөл тексеруі (сервер өз бетінше тексереді).
  function guard(ctx, role) {
    if (!state.user) { go('/login?next=' + encodeURIComponent(parseHash().path)); return false; }
    if (state.user.role !== role) {
      ctx.mount(`<div class="alert alert-error">${esc(t('common.forbiddenPage', { role: t('role.' + role) }))}</div>`);
      return false;
    }
    return true;
  }

  function takeFlash() {
    const f = state.flash;
    state.flash = null;
    return f ? `<div class="alert alert-${f.kind || 'info'}">${f.html}</div>` : '';
  }

  // ---------- Каталог ----------
  async function viewCatalog(ctx) {
    const f = state.filters;
    const opt = (v, label, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
    const html = `
      <section class="hero"><h1>${t('hero.title')}</h1><p>${t('hero.text')}</p></section>
      <div class="catalog">
        <aside>
          <details class="filters" id="filtersBox" open>
            <summary>${t('filter.title')}</summary>
            <form id="filterForm" style="margin-top:12px">
              <div class="field"><label for="fCat">${t('filter.category')}</label>
                <select id="fCat" name="category">${opt('', t('filter.all'), f.category)}${CATEGORIES.map((c) => opt(c, t('cat.' + c), f.category)).join('')}</select></div>
              <div class="field"><label for="fMin">${t('filter.price')}</label>
                <div class="price-row">
                  <input id="fMin" type="number" inputmode="numeric" min="0" name="min" placeholder="${t('filter.min')}" value="${esc(f.min)}" aria-label="${t('filter.price')} ${t('filter.min')}">
                  <input type="number" inputmode="numeric" min="0" name="max" placeholder="${t('filter.max')}" value="${esc(f.max)}" aria-label="${t('filter.price')} ${t('filter.max')}">
                </div></div>
              <div class="field"><label for="fAvail">${t('filter.avail')}</label>
                <select id="fAvail" name="avail">${['', 'in_stock', 'out_of_stock', 'purchasable'].map((v) => opt(v, t('filter.avail.' + (v || 'all')), f.avail)).join('')}</select></div>
              <button type="button" class="btn btn-ghost btn-block" id="resetFilters">${t('filter.reset')}</button>
            </form>
          </details>
        </aside>
        <section aria-live="polite">
          <div class="result-bar"><span class="muted" id="resultCount"></span>${f.q ? `<span class="small">«${esc(f.q)}»</span>` : ''}</div>
          <div id="results"><p class="muted">${t('common.loading')}</p></div>
        </section>
      </div>`;
    if (!ctx.mount(html)) return;
    if (window.matchMedia('(max-width: 960px)').matches) $('#filtersBox').open = false;
    const form = $('#filterForm');
    const apply = () => {
      const fd = new FormData(form);
      Object.assign(state.filters, { category: fd.get('category'), min: fd.get('min'), max: fd.get('max'), avail: fd.get('avail') });
      loadResults();
    };
    form.addEventListener('change', apply);
    form.addEventListener('input', debounce(apply, 350));
    form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
    $('#resetFilters').addEventListener('click', () => {
      state.filters = { q: '', category: '', min: '', max: '', avail: '' };
      router(false);
    });
    await loadResults();
  }

  let resultsSeq = 0;
  async function loadResults() {
    const box = $('#results');
    if (!box) return;
    const f = state.filters;
    const qs = new URLSearchParams();
    if (f.q) qs.set('q', f.q);
    if (f.category) qs.set('category', f.category);
    if (f.min) qs.set('min', f.min);
    if (f.max) qs.set('max', f.max);
    if (f.avail) qs.set('avail', f.avail);
    const seq = ++resultsSeq;
    let data;
    try {
      data = await api('GET', '/api/catalog?' + qs);
    } catch (e) {
      if (seq === resultsSeq && $('#results')) $('#results').innerHTML = `<div class="alert alert-error">${esc(errText(e))}</div>`;
      return;
    }
    if (seq !== resultsSeq || !$('#results')) return;
    $('#resultCount').textContent = t('filter.found', { n: data.products.length });
    $('#results').innerHTML = data.products.length
      ? `<div class="grid">${data.products.map(productCard).join('')}</div>`
      : `<div class="empty">${t('filter.none')}</div>`;
  }

  function addControls(p, withQty = false) {
    if (p.blockReason) {
      return `<button class="btn btn-block" type="button" disabled>${t('p.add')}</button>
        <div class="block-note" role="note">${t('block.' + p.blockReason)}</div>`;
    }
    if (!withQty) return `<button class="btn btn-block" type="button" data-add="${p.id}" data-max="${p.stock}">${t('p.add')}</button>`;
    return `<div class="buy-row">
      <div class="qty" data-qty-box>
        <button type="button" data-step="-1" aria-label="-">−</button>
        <input type="number" min="1" max="${Math.min(99, p.stock)}" value="1" aria-label="${t('p.qty')}" data-qty-input>
        <button type="button" data-step="1" aria-label="+">+</button>
      </div>
      <button class="btn" type="button" data-add="${p.id}" data-max="${p.stock}" data-with-qty="1">${t('p.add')}</button>
    </div>`;
  }

  function productCard(p) {
    return `<article class="card">
      <a class="card-img" href="#/product/${p.id}" tabindex="-1" aria-hidden="true">${productImg(p)}</a>
      <div class="card-body">
        <div>${rxChip(p)}</div>
        <a class="card-title" href="#/product/${p.id}">${esc(L(p.name))} ${esc(L(p.dose))}</a>
        <div class="card-meta">${t('p.dose')}: <b>${esc(L(p.dose))}</b> · ${esc(L(p.form))}</div>
        <div class="card-meta">${t('p.pack')}: <b>${esc(L(p.pack))}</b></div>
        <div class="card-meta">${t('p.pharmacy')}: <b>${esc(L(p.pharmacy.name))}</b></div>
        <div class="price">${money(p.price)}<small>${t('p.demoPrice')}</small></div>
        ${stockLine(p)}
        <div class="card-actions">${addControls(p)}</div>
      </div>
      <div class="card-footer"><span>${t('lic.statusLabel')}</span>${licenseBadge(p.license.status)}</div>
    </article>`;
  }

  // ---------- Дәрінің жеке беті ----------
  async function viewProduct(ctx) {
    const { product: p } = await api('GET', '/api/products/' + ctx.params[0]);
    const np = `<span class="muted">${t('p.notProvided')}</span>`;
    const lic = p.license;
    let licBody;
    if (lic.status === 'approved') {
      licBody = `<table class="spec">
        <tr><th>${t('lic.number')}</th><td>${esc(lic.licenseNumber)}</td></tr>
        <tr><th>${t('lic.org')}</th><td>${esc(lic.orgName)}</td></tr>
        <tr><th>${t('lic.issuer')}</th><td>${esc(lic.issuer)}</td></tr>
        <tr><th>${t('lic.issueDate')}</th><td>${fmtDate(lic.issueDate)}</td></tr>
        <tr><th>${t('lic.expiry')}</th><td>${lic.expiryDate ? fmtDate(lic.expiryDate) : `<span class="muted">${t('lic.expiryNone')}</span>`}</td></tr>
        <tr><th>${t('lic.statusLabel')}</th><td>${licenseBadge(lic.status)}</td></tr>
        <tr><th>${t('lic.reviewedAt')}</th><td>${fmtDate(lic.reviewedAt, true)}</td></tr>
      </table>`;
    } else {
      licBody = `<table class="spec"><tr><th>${t('lic.statusLabel')}</th><td>${licenseBadge(lic.status)}</td></tr></table>
        <p class="small muted" style="margin:0">${lic.status === 'none' ? t('lic.noData') : t('lic.hiddenUntilApproved')}</p>`;
    }
    const reg = p.regDoc;
    const regBody = reg
      ? `<table class="spec">
          <tr><th>${t('reg.number')}</th><td>${esc(reg.number)}</td></tr>
          <tr><th>${t('reg.issueDate')}</th><td>${reg.issueDate ? fmtDate(reg.issueDate) : np}</td></tr>
          <tr><th>${t('reg.expiry')}</th><td>${reg.expiryDate ? fmtDate(reg.expiryDate) : np}</td></tr>
          <tr><th>${t('reg.file')}</th><td>${reg.hasFile ? t('reg.fileAttached') : np}</td></tr>
        </table>
        <span class="badge badge-none">${t('reg.unverified')}</span>`
      : `<p class="muted" style="margin:0">${t('reg.none')}</p>`;

    const html = `
      <a class="back-link" href="#/">${t('p.back')}</a>
      <div class="product">
        <div class="product-img">${productImg(p)}</div>
        <div>
          <div class="btn-row" style="margin-bottom:8px">${rxChip(p)} ${licenseBadge(lic.status)}</div>
          <h1>${esc(L(p.name))} ${esc(L(p.dose))}, ${esc(L(p.pack))}</h1>
          <table class="spec">
            <tr><th>${t('p.manufacturer')}</th><td>${p.manufacturer ? esc(L(p.manufacturer)) : np}</td></tr>
            <tr><th>${t('p.inn')}</th><td>${esc(p.inn)}</td></tr>
            <tr><th>${t('p.form')}</th><td>${esc(L(p.form))}</td></tr>
            <tr><th>${t('p.dose')}</th><td>${esc(L(p.dose))}</td></tr>
            <tr><th>${t('p.pack')}</th><td>${esc(L(p.pack))}</td></tr>
            <tr><th>${t('p.rxBadgeTitle')}</th><td>${rxChip(p)}<div class="small muted">${p.rx ? t('p.rxLong') : t('p.otcLong')}</div></td></tr>
            <tr><th>${t('p.pharmacy')}</th><td>${esc(L(p.pharmacy.name))}</td></tr>
          </table>
          <div class="buy-box">
            <div class="price">${money(p.price)}<small>${t('p.demoPrice')}</small></div>
            ${stockLine(p)}
            ${p.blockReason ? `<div class="alert alert-${p.blockReason === 'out_of_stock' ? 'gray' : 'warn'}" style="margin:12px 0 0">${t('block.' + p.blockReason)}</div>` : addControls(p, true)}
          </div>
        </div>
      </div>

      <section class="section">
        <h2>${t('p.instruction')}</h2>
        ${p.instruction ? `<div>${esc(L(p.instruction))}</div>` : `<div class="alert alert-gray" style="margin:0">${t('p.instructionEmpty')}</div>`}
      </section>

      <section class="section">
        <h2>${t('p.pharmacyInfo')}</h2>
        <table class="spec">
          <tr><th>${t('p.pharmacy')}</th><td>${esc(L(p.pharmacy.name))} ${demoTag()}</td></tr>
          <tr><th>${t('p.city')}</th><td>${p.pharmacy.city ? esc(L(p.pharmacy.city)) : np}</td></tr>
          <tr><th>${t('p.address')}</th><td>${p.pharmacy.address ? esc(L(p.pharmacy.address)) : np}</td></tr>
          <tr><th>${t('p.phone')}</th><td>${p.pharmacy.phone ? esc(p.pharmacy.phone) : np}</td></tr>
          <tr><th>${t('p.pickupPoints')}</th><td>${p.pharmacy.branches.map((b) => esc(L(b.name))).join('<br>')}</td></tr>
        </table>
      </section>

      <div class="doc-sections">
        <section class="section" id="licenseSection">
          <h2>${t('lic.section')}</h2>
          <p class="section-hint">${t('lic.sectionHint')}</p>
          <details class="disclosure">
            <summary><span>${t('lic.open')}</span>${licenseBadge(lic.status)}</summary>
            <div>${licBody}<p class="small muted" style="margin:10px 0 0">${t('lic.demoNote')}</p></div>
          </details>
        </section>
        <section class="section" id="registrationSection">
          <h2>${t('reg.section')}</h2>
          <p class="section-hint">${t('reg.sectionHint')}</p>
          ${regBody}
        </section>
      </div>`;
    if (!ctx.mount(html)) return;
    document.title = `${L(p.name)} ${L(p.dose)} — DariTap`;
  }

  // Себетке қосу және сан батырмалары (бүкіл бетке ортақ).
  document.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const box = step.closest('[data-qty-box]');
      const inp = $('[data-qty-input]', box);
      const max = Number(inp.max) || 99;
      inp.value = Math.max(1, Math.min(max, (Number(inp.value) || 1) + Number(step.dataset.step)));
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      let qty = 1;
      if (add.dataset.withQty) {
        const inp = $('[data-qty-input]', add.parentElement);
        qty = Math.max(1, Math.floor(Number(inp.value) || 1));
      }
      addToCart(add.dataset.add, qty, Number(add.dataset.max) || 1);
    }
  });

  // ---------- Себет ----------
  async function loadCartProducts() {
    if (!state.cart.length) return [];
    const { products } = await api('GET', '/api/products?ids=' + encodeURIComponent(state.cart.map((x) => x.id).join(',')));
    // Жойылған тауарларды себеттен алып тастау, санды қоймамен шектеу
    state.cart = state.cart.filter((x) => products.some((p) => p.id === x.id));
    state.cart.forEach((x) => {
      const p = products.find((pp) => pp.id === x.id);
      if (p.stock > 0 && x.qty > p.stock) x.qty = p.stock;
    });
    saveCart();
    return products;
  }

  function cartGroups(products) {
    const groups = [];
    state.cart.forEach((x) => {
      const p = products.find((pp) => pp.id === x.id);
      if (!p) return;
      let g = groups.find((gg) => gg.pharmacy.id === p.pharmacy.id);
      if (!g) { g = { pharmacy: p.pharmacy, license: p.license.status, items: [] }; groups.push(g); }
      g.items.push({ p, qty: x.qty, sum: p.price * x.qty });
    });
    return groups;
  }

  async function viewCart(ctx) {
    const products = await loadCartProducts();
    const draw = () => {
      if (!state.cart.length) {
        return ctx.mount(`<h1>${t('cart.title')}</h1><div class="empty"><p>${t('cart.empty')}</p><a class="btn" href="#/">${t('cart.goCatalog')}</a></div>`);
      }
      const groups = cartGroups(products);
      const total = groups.reduce((s, g) => s + g.items.reduce((ss, i) => ss + i.sum, 0), 0);
      const blocked = groups.some((g) => g.items.some((i) => i.p.blockReason));
      let gate = '';
      if (!state.user) gate = `<div class="alert alert-info small">${t('cart.loginRequired')} <a href="#/login?next=%2Fcheckout">${t('nav.login')}</a></div>`;
      else if (state.user.role !== 'customer') gate = `<div class="alert alert-warn small">${t('cart.roleRequired')}</div>`;
      const canCheckout = !blocked && (!state.user || state.user.role === 'customer');

      const html = `<h1>${t('cart.title')}</h1>
        <div class="cart-layout">
          <div>
            ${groups.length > 1 ? `<p class="small muted">${t('cart.groupNote')}</p>` : ''}
            ${groups.map((g) => `<div class="cart-group">
              <div class="cart-group-head"><span>${esc(L(g.pharmacy.name))}</span>${licenseBadge(g.license)}</div>
              ${g.items.map(({ p, qty, sum }) => `<div class="cart-item">
                <a class="thumb" href="#/product/${p.id}" aria-hidden="true" tabindex="-1">${productImg(p)}</a>
                <div>
                  <a class="card-title" href="#/product/${p.id}">${esc(L(p.name))} ${esc(L(p.dose))}</a> ${p.rx ? rxChip(p) : ''}
                  <div class="card-meta">${esc(L(p.pack))} · ${money(p.price)}</div>
                  ${p.blockReason ? `<div class="alert alert-warn small" style="margin:8px 0 0">${t('block.' + p.blockReason)} ${t('cart.unavailable')}</div>` : ''}
                </div>
                <div class="cart-item-right">
                  ${p.blockReason ? '' : `<div class="qty">
                    <button type="button" data-cart-step="-1" data-id="${p.id}" aria-label="-">−</button>
                    <input type="number" min="1" max="${Math.min(99, p.stock)}" value="${qty}" data-cart-qty="${p.id}" aria-label="${t('p.qty')}">
                    <button type="button" data-cart-step="1" data-id="${p.id}" aria-label="+">+</button>
                  </div>`}
                  <b>${money(sum)}</b>
                  <button type="button" class="link-btn" data-remove="${p.id}">${t('cart.remove')}</button>
                </div>
              </div>`).join('')}
            </div>`).join('')}
          </div>
          <aside class="summary">
            <div class="muted">${t('cart.total')}</div>
            <div class="summary-total"><span></span><span>${money(total)}</span></div>
            ${gate}
            ${blocked ? `<div class="alert alert-warn small">${t('err.blocked')}</div>` : ''}
            <button class="btn btn-block" id="toCheckout" ${canCheckout ? '' : 'disabled'}>${t('cart.checkout')}</button>
          </aside>
        </div>`;
      if (!ctx.mount(html)) return false;

      const setQty = (id, q) => {
        const it = state.cart.find((x) => x.id === id);
        const p = products.find((pp) => pp.id === id);
        if (!it || !p) return;
        it.qty = Math.max(1, Math.min(99, p.stock || 1, Math.floor(q) || 1));
        saveCart();
        draw();
      };
      $$('[data-cart-step]').forEach((b) => b.addEventListener('click', () => {
        const it = state.cart.find((x) => x.id === b.dataset.id);
        setQty(b.dataset.id, it.qty + Number(b.dataset.cartStep));
      }));
      $$('[data-cart-qty]').forEach((inp) => inp.addEventListener('change', () => setQty(inp.dataset.cartQty, Number(inp.value))));
      $$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        state.cart = state.cart.filter((x) => x.id !== b.dataset.remove);
        saveCart();
        draw();
      }));
      $('#toCheckout').addEventListener('click', () => go('/checkout'));
      return true;
    };
    draw();
  }

  async function viewCheckout(ctx) {
    if (!guard(ctx, 'customer')) return;
    const products = await loadCartProducts();
    if (!state.cart.length) { go('/cart'); return; }
    const groups = cartGroups(products);
    if (groups.some((g) => g.items.some((i) => i.p.blockReason))) { go('/cart'); return; }
    const total = groups.reduce((s, g) => s + g.items.reduce((ss, i) => ss + i.sum, 0), 0);

    const html = `<a class="back-link" href="#/cart">← ${t('cart.title')}</a>
      <h1>${t('co.title')} ${demoTag()}</h1>
      <div class="alert alert-warn">${t('co.demo')}</div>
      <form id="checkoutForm" class="cart-layout" novalidate>
        <div>
          <div class="panel">
            <div class="grid-2">
              ${field('customerName', t('co.name'), inputEl('customerName', 'autocomplete="name" maxlength="120" required'), { required: true })}
              ${field('phone', t('co.phone'), inputEl('phone', `type="tel" autocomplete="tel" inputmode="tel" placeholder="+7 7__ ___ __ __" required`), { required: true, hint: t('co.phoneHint') })}
            </div>
          </div>
          ${groups.map((g) => {
            const hasRx = g.items.some((i) => i.p.rx);
            return `<div class="panel">
              <h3>${esc(L(g.pharmacy.name))}</h3>
              <ul class="order-items">${g.items.map((i) => `<li>${esc(L(i.p.name))} ${esc(L(i.p.dose))}, ${esc(L(i.p.pack))} × ${i.qty} — ${money(i.sum)} ${i.p.rx ? rxChip(i.p) : ''}</li>`).join('')}</ul>
              ${field('pickup_' + g.pharmacy.id, t('co.pickup'), `<select id="f_pickup_${g.pharmacy.id}" name="pickup_${g.pharmacy.id}" required>
                  <option value="">${t('co.choose')}</option>
                  ${g.pharmacy.branches.map((b) => `<option value="${b.id}">${esc(L(b.name))}</option>`).join('')}
                </select>`, { required: true })}
              ${hasRx ? `<div class="alert alert-warn small">${t('co.rxNote')}</div>
                ${field('rx_' + g.pharmacy.id, t('co.rxUpload'), `<input id="f_rx_${g.pharmacy.id}" name="rx_${g.pharmacy.id}" type="file" accept="${FILE_ACCEPT}" required>`, { required: true, hint: `${demoTag()} ${t('form.uploadDemo')}` })}` : ''}
            </div>`;
          }).join('')}
        </div>
        <aside class="summary">
          <div class="muted">${t('cart.total')}</div>
          <div class="summary-total"><span></span><span>${money(total)}</span></div>
          <div class="form-alert"></div>
          <button class="btn btn-block" type="submit">${t('co.submit')}</button>
          <p class="small muted">${t('form.required')}</p>
        </aside>
      </form>`;
    if (!ctx.mount(html)) return;

    const form = $('#checkoutForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formAlert(form, '');
      const fd = new FormData(form);
      const errs = {};
      const name = String(fd.get('customerName') || '').trim();
      const phoneDigits = String(fd.get('phone') || '').replace(/\D/g, '');
      if (name.length < 3) errs.customerName = 'required';
      if (!/^[78]?7\d{9}$/.test(phoneDigits)) errs.phone = 'phone';
      const pickups = {};
      const rxFiles = {};
      groups.forEach((g) => {
        const id = g.pharmacy.id;
        pickups[id] = fd.get('pickup_' + id);
        if (!pickups[id]) errs['pickup_' + id] = 'required';
        if (g.items.some((i) => i.p.rx)) {
          const file = $(`#f_rx_${id}`).files[0];
          const fe = checkFile(file);
          if (fe) errs['rx_' + id] = fe; else rxFiles[id] = file;
        }
      });
      if (!showErrors(form, errs)) { formAlert(form, t('err.validation')); return; }
      const btn = $('button[type="submit"]', form);
      setBusy(btn, true);
      try {
        const prescriptions = {};
        for (const [id, file] of Object.entries(rxFiles)) prescriptions[id] = await readFile(file);
        const { orders } = await api('POST', '/api/orders', {
          customerName: name,
          phone: fd.get('phone'),
          items: state.cart.map((x) => ({ productId: x.id, qty: x.qty })),
          pickups,
          prescriptions
        });
        state.cart = [];
        saveCart();
        state.lastOrders = orders;
        go('/order-success');
      } catch (err) {
        setBusy(btn, false);
        if (err.fields && err.code === 'validation') showErrors(form, err.fields);
        let msg = errText(err);
        if (err.code === 'blocked' && err.fields) msg += ' ' + t('block.' + err.fields.reason);
        if (err.code === 'not_enough_stock' && err.fields) msg += ' ' + t('cart.qtyLimited', { n: err.fields.stock });
        formAlert(form, esc(msg));
      }
    });
  }

  function orderCard(o, opts = {}) {
    const rxUrl = opts.seller ? `/api/seller/orders/${o.id}/prescription/file` : `/api/orders/${o.id}/prescription/file`;
    return `<article class="order-card" data-order="${o.id}">
      <div class="order-head">
        <div><b>${t('order.number')} ${esc(o.number)}</b> ${demoTag()}</div>
        ${orderStatus(o.status)}
      </div>
      <div class="small muted">${t('order.date')}: ${fmtDate(o.createdAt, true)} · ${o.pharmacy ? esc(L(o.pharmacy.name)) : ''}</div>
      <div class="small">${t('order.pickup')}: <b>${esc(L(o.pickup))}</b></div>
      ${opts.seller ? `<div class="small">${t('so.customer')}: <b>${esc(o.customerName)}</b>, ${esc(o.phone)}</div>` : ''}
      <ul class="order-items">${o.items.map((i) => `<li>${esc(L(i.name))} ${esc(L(i.dose))}, ${esc(L(i.pack))} × ${i.qty} — ${money(i.sum)} ${i.rx ? `<span class="chip chip-rx">${t('p.rx')}</span>` : ''}</li>`).join('')}</ul>
      <div><b>${t('cart.total')}: ${money(o.total)}</b></div>
      ${o.prescription ? `<div class="small" style="margin-top:6px">${t('order.prescription')}: <a href="${rxUrl}" target="_blank" rel="noopener">${t('order.viewRx')}</a> (${esc(o.prescription.originalName)}, ${fmtSize(o.prescription.size)})</div>` : ''}
      ${o.rxRejectReason ? `<div class="alert alert-error small" style="margin:8px 0 0">${t('order.rxReason')}: ${esc(o.rxRejectReason)}</div>` : ''}
      ${opts.actions || ''}
      <details style="margin-top:8px"><summary class="small muted">${t('order.history')}</summary>
        <ul class="timeline">${o.history.map((h) => `<li>${fmtDate(h.at, true)} — ${t('order.status.' + h.status)}</li>`).join('')}</ul>
      </details>
    </article>`;
  }

  function viewOrderSuccess(ctx) {
    if (!state.lastOrders) { go('/account'); return; }
    ctx.mount(`<h1>${t('co.success')} ${demoTag()}</h1>
      <div class="alert alert-info">${t('co.successText')}</div>
      <div class="alert alert-warn small">${t('co.demo')}</div>
      ${state.lastOrders.map((o) => orderCard(o)).join('')}
      <a class="btn btn-outline" href="#/account">${t('co.myOrders')}</a>`);
  }

  // ---------- Кіру / кабинет ----------
  function viewLogin(ctx) {
    const next = ctx.query.get('next');
    const demo = [['customer', 'role.customer'], ['seller1', 'role.seller'], ['seller2', 'role.seller'], ['reviewer', 'role.reviewer']];
    const html = `<div class="login-box">
      <div class="panel">
        <h1>${t('login.title')}</h1>
        <form id="loginForm" novalidate>
          <div class="form-alert"></div>
          ${field('username', t('login.username'), inputEl('username', 'autocomplete="username" required'))}
          ${field('password', t('login.password'), inputEl('password', 'type="password" autocomplete="current-password" required'))}
          <button class="btn btn-block" type="submit">${t('login.submit')}</button>
        </form>
      </div>
      <div class="panel">
        <h3>${t('login.demo')} ${demoTag()}</h3>
        <div class="demo-accounts">
          ${demo.map(([u, r]) => `<button class="btn btn-outline" type="button" data-demo="${u}"><span>${u}</span><span class="small">${t(r)}</span></button>`).join('')}
        </div>
        <p class="small muted">${t('login.demoNote')}</p>
      </div>
    </div>`;
    if (!ctx.mount(html)) return;
    const form = $('#loginForm');
    const doLogin = async (username, password) => {
      formAlert(form, '');
      const btn = $('button[type="submit"]', form);
      setBusy(btn, true);
      try {
        const { user } = await api('POST', '/api/login', { username, password });
        state.user = user;
        const home = { customer: '/account', seller: '/seller/license', reviewer: '/reviewer' }[user.role];
        go(next && next !== '/login' ? next : home);
      } catch (e) {
        setBusy(btn, false);
        formAlert(form, esc(errText(e)));
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const errs = {};
      if (!String(fd.get('username')).trim()) errs.username = 'required';
      if (!fd.get('password')) errs.password = 'required';
      if (showErrors(form, errs)) doLogin(String(fd.get('username')).trim(), String(fd.get('password')));
    });
    $$('[data-demo]').forEach((b) => b.addEventListener('click', () => {
      $('#f_username').value = b.dataset.demo;
      $('#f_password').value = 'demo123';
      doLogin(b.dataset.demo, 'demo123');
    }));
  }

  async function viewAccount(ctx) {
    if (!state.user) { go('/login?next=%2Faccount'); return; }
    if (state.user.role === 'seller') { go('/seller/license'); return; }
    if (state.user.role === 'reviewer') { go('/reviewer'); return; }
    const { orders } = await api('GET', '/api/orders');
    ctx.mount(`<div class="page-head">
        <div><h1 style="margin:0">${t('acc.title')}</h1><div class="muted">${esc(t('acc.hello', { name: state.user.name }))} · ${t('acc.role')}: ${t('role.customer')}</div></div>
      </div>
      <h2>${t('co.myOrders')}</h2>
      ${orders.length ? orders.map((o) => orderCard(o)).join('') : `<div class="empty">${t('order.none')}</div>`}`);
  }

  // ---------- Сатушы кабинеті ----------
  function sellerHead(tab) {
    const tabs = ['license', 'products', 'orders'];
    return `<div class="page-head">
        <div><h1 style="margin:0">${t('seller.title')}</h1><div class="muted">${esc(L(state.user.pharmacyName))} · ${esc(state.user.name)}</div></div>
      </div>
      <nav class="tabs">${tabs.map((x) => `<a href="#/seller/${x}" class="${tab === x ? 'active' : ''}">${t('seller.tab.' + x)}</a>`).join('')}</nav>
      ${takeFlash()}`;
  }

  async function viewSeller(ctx) {
    if (!guard(ctx, 'seller')) return;
    const tab = ctx.params[0];
    if (tab === 'license') return sellerLicense(ctx);
    if (tab === 'products') return sellerProducts(ctx);
    return sellerOrders(ctx);
  }

  function historyList(h) {
    if (!h || !h.length) return '';
    return `<details style="margin-top:12px"><summary class="small muted">${t('rv.history')}</summary><ul class="timeline">
      ${h.map((x) => `<li>${fmtDate(x.at, true)} — ${t('hist.' + x.action)} (${esc(x.by)})${x.reason ? `: ${esc(x.reason)}` : ''}</li>`).join('')}
    </ul></details>`;
  }

  async function sellerLicense(ctx) {
    const { application: a } = await api('GET', '/api/seller/application');
    const status = a ? a.status : 'none';
    const info = {
      none: `<div class="alert alert-gray">${t('block.license_none')}</div>`,
      pending: `<div class="alert alert-warn">${t('seller.pendingInfo')}</div>`,
      approved: `<div class="alert alert-info">${t('seller.approvedInfo')}</div>`,
      rejected: `<div class="alert alert-error">${t('seller.rejectedInfo')}<br><b>${t('seller.rejectReason')}:</b> ${esc(a && a.rejectReason)}<br><span class="small">${t('rv.decidedAt')}: ${fmtDate(a && a.reviewedAt, true)} · ${t('seller.reviewer')}: ${esc(a && a.reviewerName)}</span></div>`
    }[status];

    const summary = a && (status === 'pending' || status === 'approved') ? `<table class="spec">
        <tr><th>${t('form.orgName')}</th><td>${esc(a.orgName)}</td></tr>
        <tr><th>${t('form.bin')}</th><td>${esc(a.bin)}</td></tr>
        <tr><th>${t('form.licenseNumber')}</th><td>${esc(a.licenseNumber)}</td></tr>
        <tr><th>${t('form.issuer')}</th><td>${esc(a.issuer)}</td></tr>
        <tr><th>${t('form.issueDate')}</th><td>${fmtDate(a.issueDate)}</td></tr>
        <tr><th>${t('form.expiryDate')}</th><td>${a.expiryDate ? fmtDate(a.expiryDate) : `<span class="muted">${t('lic.expiryNone')}</span>`}</td></tr>
        <tr><th>${t('form.comment')}</th><td>${a.comment ? esc(a.comment) : '—'}</td></tr>
        <tr><th>${t('form.file')}</th><td>${a.file ? `<a href="/api/seller/application/file" target="_blank" rel="noopener">${esc(a.file.originalName)}</a> (${fmtSize(a.file.size)})` : '—'}</td></tr>
        <tr><th>${t('seller.submittedAt')}</th><td>${fmtDate(a.submittedAt, true)}</td></tr>
        ${status === 'approved' ? `<tr><th>${t('rv.decidedAt')}</th><td>${fmtDate(a.reviewedAt, true)}</td></tr><tr><th>${t('seller.reviewer')}</th><td>${esc(a.reviewerName)}</td></tr>` : ''}
      </table>` : '';

    const canEdit = status === 'none' || status === 'rejected';
    const v = (k) => esc(a && status === 'rejected' ? a[k] || '' : '');
    const formHtml = canEdit ? `<div class="panel">
        <h2>${status === 'rejected' ? t('seller.resubmit') : t('seller.tab.license')} ${demoTag()}</h2>
        <form id="licForm" novalidate>
          <div class="grid-2">
            ${field('orgName', t('form.orgName'), inputEl('orgName', `maxlength="200" required value="${v('orgName')}"`), { required: true })}
            ${field('bin', t('form.bin'), inputEl('bin', `inputmode="numeric" maxlength="12" pattern="\\d{12}" required value="${v('bin')}"`), { required: true, hint: t('form.binHint') })}
            ${field('licenseNumber', t('form.licenseNumber'), inputEl('licenseNumber', `maxlength="60" required value="${v('licenseNumber')}"`), { required: true })}
            ${field('issuer', t('form.issuer'), inputEl('issuer', `maxlength="200" required value="${v('issuer')}"`), { required: true })}
            ${field('issueDate', t('form.issueDate'), inputEl('issueDate', `type="date" max="${todayStr()}" required value="${v('issueDate')}"`), { required: true })}
            ${field('expiryDate', t('form.expiryDate'), inputEl('expiryDate', `type="date" value="${v('expiryDate')}"`), { optional: true, hint: t('form.expiryHint') })}
          </div>
          ${field('file', t('form.file'), `<input id="f_file" name="file" type="file" accept="${FILE_ACCEPT}">`, {
            required: !(a && a.file),
            hint: `${t('form.fileHint')}${a && a.file ? '<br>' + esc(t('form.fileKeep', { name: a.file.originalName })) : ''}<br>${demoTag()} ${t('form.uploadDemo')}`
          })}
          ${field('comment', t('form.comment'), `<textarea id="f_comment" name="comment" maxlength="1000">${v('comment')}</textarea>`, { optional: true })}
          <div class="form-alert"></div>
          <button class="btn" type="submit">${t('form.submitReview')}</button>
          <p class="small muted">${t('form.required')}</p>
        </form>
      </div>` : '';

    const html = `${sellerHead('license')}
      <div class="panel">
        <div class="status-line"><b>${t('seller.currentStatus')}:</b> ${licenseBadge(status)}</div>
        ${info}
        <div class="alert alert-gray small">${t('seller.noSelfApprove')}</div>
        ${summary}
        ${a ? historyList(a.history) : ''}
      </div>
      ${formHtml}`;
    if (!ctx.mount(html)) return;
    if (!canEdit) return;

    const form = $('#licForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formAlert(form, '');
      const fd = new FormData(form);
      const val = (k) => String(fd.get(k) || '').trim();
      const errs = {};
      if (val('orgName').length < 2) errs.orgName = 'required';
      if (!/^\d{12}$/.test(val('bin'))) errs.bin = 'bin';
      if (val('licenseNumber').length < 3) errs.licenseNumber = 'required';
      if (val('issuer').length < 2) errs.issuer = 'required';
      if (!val('issueDate')) errs.issueDate = 'required';
      else if (val('issueDate') > todayStr()) errs.issueDate = 'future';
      if (val('expiryDate') && val('issueDate') && val('expiryDate') <= val('issueDate')) errs.expiryDate = 'after_issue';
      const file = $('#f_file').files[0];
      if (file || !(a && a.file)) {
        const fe = checkFile(file);
        if (fe) errs.file = fe;
      }
      if (!showErrors(form, errs)) { formAlert(form, t('err.validation')); return; }
      const btn = $('button[type="submit"]', form);
      setBusy(btn, true);
      try {
        const body = {
          orgName: val('orgName'), bin: val('bin'), licenseNumber: val('licenseNumber'), issuer: val('issuer'),
          issueDate: val('issueDate'), expiryDate: val('expiryDate'), comment: val('comment')
        };
        if (file) body.file = await readFile(file);
        await api('POST', '/api/seller/application', body);
        // Сервер өтінімді нақты сақтап, «Тексерілуде» мәртебесін қайтарғаннан кейін ғана хабарлаймыз.
        state.flash = { kind: 'info', html: esc(t('seller.submitted')) };
        router();
      } catch (err) {
        setBusy(btn, false);
        if (err.fields) showErrors(form, err.fields);
        formAlert(form, esc(errText(err)));
      }
    });
  }

  async function sellerProducts(ctx) {
    const { products } = await api('GET', '/api/seller/products');
    const status = products[0] ? products[0].license.status : 'none';
    ctx.mount(`${sellerHead('products')}
      ${status !== 'approved' ? `<div class="alert alert-warn">${t('sp.licenseWarn')} ${licenseBadge(status)}</div>` : ''}
      <div class="table-wrap"><table class="list">
        <thead><tr><th>${t('sp.title')}</th><th>${t('p.price')}</th><th>${t('sp.stock')}</th><th>${t('sp.regdoc')}</th><th></th></tr></thead>
        <tbody>${products.map((p) => `<tr>
          <td><b>${esc(L(p.name))} ${esc(L(p.dose))}</b><div class="small muted">${esc(L(p.pack))} ${p.rx ? rxChip(p) : ''}</div></td>
          <td>${money(p.price)}</td>
          <td>${p.stock}</td>
          <td>${p.regDoc ? `<span class="badge badge-none">${t('sp.regdocYes')}</span>` : `<span class="muted">${t('sp.regdocNo')}</span>`}</td>
          <td><a class="btn btn-outline btn-sm" href="#/seller/product/${p.id}">${t('sp.edit')}</a></td>
        </tr>`).join('')}</tbody>
      </table></div>`);
  }

  async function viewSellerProduct(ctx) {
    if (!guard(ctx, 'seller')) return;
    const { product: p } = await api('GET', '/api/seller/products/' + ctx.params[0]);
    const r = p.regDoc;
    const html = `${sellerHead('products')}
      <a class="back-link" href="#/seller/products">${t('sp.back')}</a>
      <h2>${t('sp.editTitle')}: ${esc(L(p.name))} ${esc(L(p.dose))}, ${esc(L(p.pack))}</h2>
      <div class="panel">
        <h3>${t('sp.basic')}</h3>
        <form id="basicForm" novalidate>
          <div class="grid-2">
            ${field('price', t('sp.priceField'), inputEl('price', `type="number" min="1" step="1" required value="${p.price}"`), { required: true })}
            ${field('stock', t('sp.stockField'), inputEl('stock', `type="number" min="0" step="1" required value="${p.stock}"`), { required: true })}
          </div>
          <div class="form-alert"></div>
          <button class="btn" type="submit">${t('form.save')}</button>
        </form>
      </div>
      <div class="panel">
        <h3>${t('sp.regTitle')} ${demoTag()}</h3>
        <p class="section-hint">${t('sp.regHint')}</p>
        <div class="alert alert-gray small">${t('sp.regUnverified')}</div>
        <form id="regForm" novalidate>
          <div class="grid-2">
            ${field('number', t('sp.regNumber'), inputEl('number', `maxlength="80" required value="${esc(r ? r.number : '')}"`), { required: true })}
            ${field('issueDate', t('sp.regIssue'), inputEl('issueDate', `type="date" value="${esc(r ? r.issueDate : '')}"`), { optional: true })}
            ${field('expiryDate', t('sp.regExpiry'), inputEl('expiryDate', `type="date" value="${esc(r ? r.expiryDate : '')}"`), { optional: true })}
          </div>
          ${field('file', t('sp.regFile'), `<input id="f_file" name="file" type="file" accept="${FILE_ACCEPT}">`, {
            required: !(r && r.file),
            hint: `${r && r.file ? `${esc(t('form.fileKeep', { name: r.file.originalName }))} — <a href="/api/seller/products/${p.id}/regdoc/file" target="_blank" rel="noopener">${t('sp.viewFile')}</a><br>` : ''}${demoTag()} ${t('form.uploadDemo')}`
          })}
          <div class="form-alert"></div>
          <button class="btn" type="submit">${t('sp.regSave')}</button>
        </form>
      </div>`;
    if (!ctx.mount(html)) return;

    const basic = $('#basicForm');
    basic.addEventListener('submit', async (e) => {
      e.preventDefault();
      formAlert(basic, '');
      const price = Number(basic.price.value);
      const stock = Number(basic.stock.value);
      const errs = {};
      if (!Number.isInteger(price) || price < 1 || price > 10000000) errs.price = 'price';
      if (!Number.isInteger(stock) || stock < 0 || stock > 100000) errs.stock = 'stock';
      if (!showErrors(basic, errs)) return;
      try {
        await api('PUT', '/api/seller/products/' + p.id, { price, stock });
        formAlert(basic, t('form.saved'), 'info');
      } catch (err) {
        if (err.fields) showErrors(basic, err.fields);
        formAlert(basic, esc(errText(err)));
      }
    });

    const reg = $('#regForm');
    reg.addEventListener('submit', async (e) => {
      e.preventDefault();
      formAlert(reg, '');
      const errs = {};
      const number = reg.number.value.trim();
      if (number.length < 3) errs.number = 'required';
      const file = $('#f_file', reg).files[0];
      if (file || !(r && r.file)) {
        const fe = checkFile(file);
        if (fe) errs.file = fe;
      }
      if (!showErrors(reg, errs)) return;
      const btn = $('button[type="submit"]', reg);
      setBusy(btn, true);
      try {
        const body = { number, issueDate: reg.issueDate.value, expiryDate: reg.expiryDate.value };
        if (file) body.file = await readFile(file);
        await api('POST', `/api/seller/products/${p.id}/regdoc`, body);
        state.flash = { kind: 'info', html: esc(t('form.saved')) };
        router(false);
      } catch (err) {
        setBusy(btn, false);
        if (err.fields) showErrors(reg, err.fields);
        formAlert(reg, esc(errText(err)));
      }
    });
  }

  async function sellerOrders(ctx) {
    const { orders } = await api('GET', '/api/seller/orders');
    const actions = (o) => {
      let h = '';
      if (o.status === 'rx_pending') {
        h = `<div class="alert alert-warn small" style="margin:10px 0 8px">${t('so.rxFirst')}</div>
          <div class="field" data-field="reason" style="margin-bottom:8px"><label for="r_${o.id}">${t('so.reason')}</label>
            <textarea id="r_${o.id}" maxlength="500" style="min-height:60px"></textarea><div class="err" data-err="reason"></div></div>
          <div class="btn-row">
            <button class="btn btn-sm" data-act="rx" data-decision="approve" data-id="${o.id}">${t('so.approveRx')}</button>
            <button class="btn btn-danger btn-sm" data-act="rx" data-decision="reject" data-id="${o.id}">${t('so.rejectRx')}</button>
            <button class="btn btn-ghost btn-sm" data-act="status" data-status="cancelled" data-id="${o.id}">${t('so.cancel')}</button>
          </div>`;
      } else if (o.status === 'accepted') {
        h = `<div class="btn-row" style="margin-top:10px">
          <button class="btn btn-sm" data-act="status" data-status="ready" data-id="${o.id}">${t('so.markReady')}</button>
          <button class="btn btn-ghost btn-sm" data-act="status" data-status="cancelled" data-id="${o.id}">${t('so.cancel')}</button></div>`;
      } else if (o.status === 'ready') {
        h = `<div class="btn-row" style="margin-top:10px">
          <button class="btn btn-sm" data-act="status" data-status="completed" data-id="${o.id}">${t('so.markCompleted')}</button>
          <button class="btn btn-ghost btn-sm" data-act="status" data-status="cancelled" data-id="${o.id}">${t('so.cancel')}</button></div>`;
      }
      return h + '<div class="form-alert" style="margin-top:8px"></div>';
    };
    const html = `${sellerHead('orders')}
      <h2>${t('so.title')}</h2>
      ${orders.length ? orders.map((o) => orderCard(o, { seller: true, actions: actions(o) })).join('') : `<div class="empty">${t('order.none')}</div>`}`;
    if (!ctx.mount(html)) return;

    $$('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const card = b.closest('[data-order]');
      formAlert(card, '');
      try {
        if (b.dataset.act === 'rx') {
          const reason = $('textarea', card).value.trim();
          if (b.dataset.decision === 'reject' && !showErrors(card, reason.length < 5 ? { reason: 'reason' } : {})) return;
          await api('POST', `/api/seller/orders/${b.dataset.id}/prescription`, { decision: b.dataset.decision, reason });
        } else {
          await api('POST', `/api/seller/orders/${b.dataset.id}/status`, { status: b.dataset.status });
        }
        router(false);
      } catch (err) {
        if (err.fields) showErrors(card, err.fields);
        formAlert(card, esc(errText(err)));
      }
    }));
  }

  // ---------- Тексеруші кабинеті ----------
  async function viewReviewer(ctx) {
    if (!guard(ctx, 'reviewer')) return;
    const filter = ctx.query.get('status') || '';
    const { applications } = await api('GET', '/api/reviewer/applications');
    const list = filter ? applications.filter((a) => a.status === filter) : applications;
    const opts = ['', 'pending', 'approved', 'rejected'];
    const html = `<div class="page-head">
        <div><h1 style="margin:0">${t('rv.title')}</h1><div class="muted">${esc(state.user.name)}</div></div>
      </div>
      ${takeFlash()}
      <div class="alert alert-gray small">${t('rv.private')}</div>
      <div class="page-head">
        <h2 style="margin:0">${t('rv.list')}</h2>
        <select id="rvFilter" style="width:auto" aria-label="${t('common.status')}">
          ${opts.map((s) => `<option value="${s}" ${s === filter ? 'selected' : ''}>${s ? t('lic.status.' + s) : t('rv.filter.all')}</option>`).join('')}
        </select>
      </div>
      ${list.length ? `<div class="table-wrap"><table class="list">
        <thead><tr><th>${t('rv.applicant')}</th><th>${t('rv.pharmacy')}</th><th>${t('seller.submittedAt')}</th><th>${t('common.status')}</th><th>${t('rv.decidedAt')}</th><th></th></tr></thead>
        <tbody>${list.map((a) => `<tr>
          <td><b>${esc(a.orgName)}</b></td>
          <td>${a.pharmacy ? esc(L(a.pharmacy.name)) : '—'}</td>
          <td>${fmtDate(a.submittedAt, true)}</td>
          <td>${licenseBadge(a.status)}</td>
          <td>${a.reviewedAt ? `${fmtDate(a.reviewedAt, true)}<div class="small muted">${esc(a.reviewerName)}</div>` : '—'}</td>
          <td><a class="btn btn-outline btn-sm" href="#/reviewer/app/${a.id}">${t('rv.open')}</a></td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('rv.empty')}</div>`}`;
    if (!ctx.mount(html)) return;
    $('#rvFilter').addEventListener('change', (e) => go('/reviewer' + (e.target.value ? '?status=' + e.target.value : '')));
  }

  async function viewReviewerApp(ctx) {
    if (!guard(ctx, 'reviewer')) return;
    const { application: a } = await api('GET', '/api/reviewer/applications/' + ctx.params[0]);
    const fileUrl = `/api/reviewer/applications/${a.id}/file`;
    let preview = '';
    if (a.file) {
      preview = a.file.mime === 'application/pdf'
        ? `<div class="doc-preview"><iframe src="${fileUrl}" title="${esc(a.file.originalName)}"></iframe></div>`
        : `<div class="doc-preview"><img src="${fileUrl}" alt="${esc(a.file.originalName)}"></div>`;
    }
    const decided = a.status !== 'pending';
    const html = `<a class="back-link" href="#/reviewer">${t('rv.back')}</a>
      <div class="page-head"><h1 style="margin:0">${esc(a.orgName)}</h1>${licenseBadge(a.status)}</div>
      <div class="alert alert-gray small">${t('rv.private')}</div>
      <div class="doc-sections" style="margin-bottom:20px">
        <div class="panel" style="margin:0">
          <h3>${t('rv.applicant')}</h3>
          <table class="spec">
            <tr><th>${t('form.orgName')}</th><td>${esc(a.orgName)}</td></tr>
            <tr><th>${t('form.bin')}</th><td>${esc(a.bin)}</td></tr>
            <tr><th>${t('form.licenseNumber')}</th><td>${esc(a.licenseNumber)}</td></tr>
            <tr><th>${t('form.issuer')}</th><td>${esc(a.issuer)}</td></tr>
            <tr><th>${t('form.issueDate')}</th><td>${fmtDate(a.issueDate)}</td></tr>
            <tr><th>${t('form.expiryDate')}</th><td>${a.expiryDate ? fmtDate(a.expiryDate) : `<span class="muted">${t('lic.expiryNone')}</span>`}</td></tr>
            <tr><th>${t('form.comment')}</th><td>${a.comment ? esc(a.comment) : '—'}</td></tr>
            <tr><th>${t('rv.pharmacy')}</th><td>${a.pharmacy ? `${esc(L(a.pharmacy.name))}, ${esc(L(a.pharmacy.city))}` : '—'}</td></tr>
            <tr><th>${t('rv.submitter')}</th><td>${a.submitter ? `${esc(a.submitter.name)} (${esc(a.submitter.username)})` : '—'}</td></tr>
            <tr><th>${t('seller.submittedAt')}</th><td>${fmtDate(a.submittedAt, true)}</td></tr>
          </table>
          ${historyList(a.history)}
        </div>
        <div class="panel" style="margin:0">
          <h3>${t('rv.decision')}</h3>
          ${decided ? `<table class="spec">
              <tr><th>${t('rv.decision')}</th><td>${a.decision ? t('rv.decision.' + a.decision) : '—'}</td></tr>
              <tr><th>${t('rv.decidedAt')}</th><td>${fmtDate(a.reviewedAt, true)}</td></tr>
              <tr><th>${t('rv.decidedBy')}</th><td>${esc(a.reviewerName)}</td></tr>
              ${a.rejectReason ? `<tr><th>${t('rv.reasonLabel')}</th><td>${esc(a.rejectReason)}</td></tr>` : ''}
            </table>`
          : `<div class="alert alert-warn small">${t('rv.checkNote')}</div>
            <form id="decisionForm" novalidate>
              ${field('reason', t('rv.reasonLabel'), `<textarea id="f_reason" name="reason" maxlength="1000"></textarea>`, { hint: t('rv.reasonHint') })}
              <div class="form-alert"></div>
              <div class="btn-row">
                <button class="btn" type="button" data-decision="approve">${t('rv.approve')}</button>
                <button class="btn btn-danger" type="button" data-decision="reject">${t('rv.reject')}</button>
              </div>
            </form>`}
        </div>
      </div>
      <div class="panel">
        <h3>${t('rv.document')}</h3>
        ${a.file ? `<div class="small">${esc(a.file.originalName)} · ${fmtSize(a.file.size)} · ${fmtDate(a.file.uploadedAt, true)} — <a href="${fileUrl}" target="_blank" rel="noopener">${t('rv.openDoc')}</a></div>${preview}` : '—'}
      </div>`;
    if (!ctx.mount(html)) return;
    if (decided) return;

    const form = $('#decisionForm');
    $$('[data-decision]', form).forEach((b) => b.addEventListener('click', async () => {
      formAlert(form, '');
      const decision = b.dataset.decision;
      const reason = form.reason.value.trim();
      if (decision === 'reject' && !showErrors(form, reason.length < 5 ? { reason: 'reason' } : {})) return;
      if (decision === 'approve' && !window.confirm(t('rv.confirmApprove'))) return;
      showErrors(form, {});
      try {
        await api('POST', `/api/reviewer/applications/${a.id}/decision`, { decision, reason });
        router(false);
      } catch (err) {
        if (err.fields) showErrors(form, err.fields);
        formAlert(form, esc(errText(err)));
      }
    }));
  }

  // ---------- Іске қосу ----------
  async function init() {
    document.documentElement.lang = state.lang;
    try {
      const [me, cfg] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/config')]);
      state.user = me.user;
      state.config = cfg;
    } catch {
      // Сервер жоқ болса, маршрутизатор қатені көрсетеді.
    }
    window.addEventListener('hashchange', () => { document.title = 'DariTap — дәрі іздеу және тапсырыс'; router(); });
    router();
  }

  init();
})();
