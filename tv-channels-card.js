// tv-channels-card: IPTV channel tiles, an HLS player and a programme guide for Home Assistant.
// Works with the iptv_proxy integration (https://github.com/ohnoitsfraa/iptv_proxy).
const VERSION = '1.1.0';

const I18N = {
  en: {
    now: 'Now', stop: 'Stop', pick: 'Pick a channel', next: 'Up next', channels: 'Channels',
    failed: 'Playback failed', blocked: 'Blocked over https',
    blockedText: 'This channel is served over http. Open Home Assistant via its local http address, or allow <code>Insecure content</code> for this site in Chrome.',
    noProxy: 'could not get access to the proxy', noHls: 'hls.js could not be loaded',
    unsupported: 'HLS is not supported in this browser', unavailable: 'stream unavailable',
    search: 'Search', searchPh: 'Search channels or programmes…', resChannels: 'Channels', resProgrammes: 'Programmes',
    noResults: 'Nothing found', searching: 'Searching…', live: 'Live', today: 'Today',
  },
  nl: {
    now: 'Nu', stop: 'Stop', pick: 'Kies een kanaal', next: 'Straks', channels: 'Kanalen',
    failed: 'Afspelen mislukt', blocked: 'Geblokkeerd via https',
    blockedText: 'Dit kanaal komt via http binnen. Open Home Assistant via het lokale http-adres, of sta in Chrome <code>Onveilige content</code> toe voor deze site.',
    noProxy: 'kon geen toegang tot de proxy krijgen', noHls: 'hls.js kon niet geladen worden',
    unsupported: 'HLS niet ondersteund in deze browser', unavailable: 'stream niet beschikbaar',
    search: 'Zoeken', searchPh: 'Zoek zenders of programma’s…', resChannels: 'Zenders', resProgrammes: 'Programma’s',
    noResults: 'Niets gevonden', searching: 'Zoeken…', live: 'Live', today: 'Vandaag',
  },
};

class TvChannelsCard extends HTMLElement {
  static getStubConfig() {
    return { proxy: '/api/iptv_proxy', channels: [{ group: 'TV', name: 'Channel 1', id: '1' }] };
  }

  setConfig(config) {
    if (!Array.isArray(config.channels) || !config.channels.length) throw new Error('channels is required');
    if (!config.proxy && (typeof config.source_hls !== 'string' || !config.source_hls.includes('{id}'))) {
      throw new Error('set proxy (iptv_proxy integration) or source_hls with {id}');
    }
    this._config = { accent: '#a78bfa', hash: '#tv', ...config };
    this._current = null;
    this._built = false;
    this._logosRequested = false;
    this._epgRequested = false;
    this._initGroups();
  }

  _initGroups() {
    const fallback = this._t('channels');
    this._groups = [...new Set(this._config.channels.map((c) => c.group || fallback))];
    let g = null;
    try { g = localStorage.getItem('tv-channels-card:group'); } catch (e) { /* storage blocked */ }
    this._group = this._groups.includes(g) ? g : this._groups[0];
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && !this._config.channels.every((c) => c.group)) this._initGroups(); // language now known
    if (!this._built) this._build();
    if (this._config.proxy && !this._logosRequested) this._signLogos();
    if (this._epgOn() && !this._epgRequested) { this._epgRequested = true; this._refreshEpg(); }
  }

  getCardSize() { return 10; }
  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  connectedCallback() {
    // `hash` is the pop-up route (e.g. Bubble Card) the card lives in; closing it stops playback.
    this._onHash = () => {
      if (this._config.hash && window.location.hash !== this._config.hash) this._stop();
      else this._refreshEpg();
    };
    clearInterval(this._epgTimer);
    this._epgTimer = setInterval(() => this._refreshEpg(), 60000);
    window.addEventListener('hashchange', this._onHash);
    window.addEventListener('location-changed', this._onHash);
  }

  disconnectedCallback() {
    clearInterval(this._epgTimer);
    window.removeEventListener('hashchange', this._onHash);
    window.removeEventListener('location-changed', this._onHash);
    this._stop();
  }

  _lang() {
    const l = (this._config && this._config.language) || (this._hass && ((this._hass.locale && this._hass.locale.language) || this._hass.language)) || 'en';
    return String(l).toLowerCase().startsWith('nl') ? 'nl' : 'en';
  }

  _t(key) { return I18N[this._lang()][key]; }

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  _visible() { return !this._config.hash || window.location.hash === this._config.hash; }

  _apiBase() { return this._config.proxy.replace(/^\/api\//, ''); }

  // signed paths: <img>/<video> can't send auth headers, so the proxy URLs carry an authSig instead
  async _sign(path, expires) {
    const res = await this._hass.callWS({ type: 'auth/sign_path', path, expires });
    return res.path;
  }

  async _signLogo(l) {
    this._logos = this._logos || {};
    if (!(l in this._logos)) {
      try { this._logos[l] = await this._sign(`${this._config.proxy}/logo?u=${encodeURIComponent(l)}`, 7 * 86400); } catch (e) { this._logos[l] = ''; }
    }
    return this._logos[l];
  }

  async _signLogos() {
    this._logosRequested = true;
    const logos = [...new Set(this._config.channels.map((c) => c.logo).filter(Boolean))];
    await Promise.all(logos.map((l) => this._signLogo(l)));
    if (this._built) this._render();
  }

  _logoSrc(c) {
    if (!c.logo) return '';
    if (!this._config.proxy) return c.logo;
    return (this._logos && this._logos[c.logo]) || '';
  }

  // programme guide via GET <proxy>/epg, only while the card is visible
  _epgOn() { return !!this._config.proxy && this._config.epg !== false && !!this._hass; }

  async _refreshEpg() {
    if (!this._epgOn() || !this._built || !this._visible()) return;
    this._epg = this._epg || {};
    const fallback = this._t('channels');
    const ids = this._config.channels.filter((c) => (c.group || fallback) === this._group).map((c) => c.id);
    try {
      const res = await this._hass.callApi('GET', `${this._apiBase()}/epg?ids=${ids.join(',')}`);
      Object.assign(this._epg, res || {});
      this._paintEpg();
    } catch (e) { /* guide is optional */ }
    const cur = this._current;
    if (cur) {
      try {
        const res = await this._hass.callApi('GET', `${this._apiBase()}/epg?ids=${cur.id}&full=1`);
        if (this._current === cur) { this._guide = (res || {})[cur.id] || []; this._paintGuide(); }
      } catch (e) { /* guide is optional */ }
    }
  }

  _fmt(ts) {
    const loc = this._lang() === 'nl' ? 'nl-NL' : ((this._hass && this._hass.locale && this._hass.locale.language) || undefined);
    return new Date(ts * 1000).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  }

  _pct(p) { const now = Date.now() / 1000; return Math.max(0, Math.min(100, ((now - p.start) / (p.end - p.start)) * 100)); }

  _nowOf(list) { const now = Date.now() / 1000; return (list || []).find((p) => p.start <= now && p.end > now) || null; }

  _paintEpg() {
    if (!this._epg) return;
    this.querySelectorAll('.ch').forEach((el) => {
      const ch = this._config.channels[+el.dataset.i];
      const pg = el.querySelector('.pg');
      if (!ch || !pg) return;
      const p = this._nowOf(this._epg[ch.id]);
      pg.hidden = !p;
      if (p) {
        pg.querySelector('.pt').textContent = p.title;
        pg.querySelector('i').style.width = `${this._pct(p).toFixed(1)}%`;
        el.title = `${p.title} (${this._fmt(p.start)}–${this._fmt(p.end)})`;
      }
    });
  }

  _paintGuide() {
    const box = this.querySelector('.guide');
    if (!box) return;
    const list = this._current ? (this._guide || []) : [];
    const now = Date.now() / 1000;
    const cur = this._nowOf(list);
    const next = list.filter((p) => p.start >= (cur ? cur.end - 60 : now)).slice(0, 3);
    box.hidden = !cur && !next.length;
    if (box.hidden) { box.innerHTML = ''; return; }
    box.innerHTML = (cur ? `<div class="gnow"><div class="gh"><span class="gt">${this._esc(cur.title)}</span><span class="gtime">${this._fmt(cur.start)} – ${this._fmt(cur.end)}</span></div>
        <div class="gbar"><i style="width:${this._pct(cur).toFixed(1)}%"></i></div>
        ${cur.desc ? `<div class="gdesc">${this._esc(cur.desc)}</div>` : ''}</div>` : '')
      + (next.length ? `<div class="gnext"><span class="lbl">${this._t('next')}</span>${next.map((p) => `<div class="gi"><span class="gtime">${this._fmt(p.start)}</span><span class="gn">${this._esc(p.title)}</span></div>`).join('')}</div>` : '');
  }

  // search: provider channels by name (GET <proxy>/streams) and programmes in the configured channels' guide (GET <proxy>/search)
  _toggleSearch(open) {
    const box = this.querySelector('.search');
    this._searchOpen = open ?? !this._searchOpen;
    box.hidden = !this._searchOpen;
    this.querySelector('.find').classList.toggle('on', this._searchOpen);
    if (!this._searchOpen) return;
    const input = box.querySelector('input');
    input.focus();
    input.select();
    if (this._epgOn() && !(this._warmAt > Date.now() - 600000)) {
      this._warmAt = Date.now(); // fill the server's guide cache so the first search is quick
      this._hass.callApi('GET', `${this._apiBase()}/search?ids=${this._searchIds()}`).catch(() => {});
    }
  }

  _searchIds() { return [...new Set(this._config.channels.map((c) => c.id))].join(','); }

  async _search(q) {
    const token = (this._searchToken = (this._searchToken || 0) + 1);
    const out = this.querySelector('.results');
    q = q.trim();
    if (q.length < 2) { out.innerHTML = ''; return; }
    out.innerHTML = `<div class="rmsg">${this._t('searching')}</div>`;
    const enc = encodeURIComponent(q);
    const [chans, progs] = await Promise.all([
      this._hass.callApi('GET', `${this._apiBase()}/streams?q=${enc}&limit=24`).catch(() => []),
      this._epgOn() ? this._hass.callApi('GET', `${this._apiBase()}/search?q=${enc}&ids=${this._searchIds()}`).catch(() => []) : [],
    ]);
    if (token !== this._searchToken) return;
    this._results = { chans: chans || [], progs: progs || [] };
    this._paintResults();
  }

  _day(ts) {
    const d = new Date(ts * 1000);
    if (d.toDateString() === new Date().toDateString()) return this._t('today');
    return d.toLocaleDateString(this._lang() === 'nl' ? 'nl-NL' : undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  _paintResults() {
    const out = this.querySelector('.results');
    const { chans, progs } = this._results || { chans: [], progs: [] };
    if (!chans.length && !progs.length) { out.innerHTML = `<div class="rmsg">${this._t('noResults')}</div>`; return; }
    const byId = Object.fromEntries(this._config.channels.map((c) => [c.id, c]));
    out.innerHTML = (chans.length ? `<div class="rsec"><span class="lbl">${this._t('resChannels')}</span>${chans.map((c, i) => `
        <button class="ri" data-k="c${i}"><span class="rlogo">${c.logo ? `<img alt="" data-logo="${this._esc(c.logo)}" referrerpolicy="no-referrer">` : ''}</span>
          <span class="rt"><span class="rn">${this._esc(c.name)}</span><span class="rs">${this._esc(c.group)}</span></span></button>`).join('')}</div>` : '')
      + (progs.length ? `<div class="rsec"><span class="lbl">${this._t('resProgrammes')}</span>${progs.map((p, i) => {
        const ch = byId[p.id];
        return `<button class="ri${p.live ? '' : ' later'}" data-k="p${i}"${p.live ? '' : ' disabled'}>
          <span class="rwhen">${p.live ? `<span class="rlive">${this._t('live')}</span>` : `<span>${this._esc(this._day(p.start))}</span>`}<span class="gtime">${this._fmt(p.start)}</span></span>
          <span class="rt"><span class="rn">${this._esc(p.title)}</span><span class="rs">${this._esc(ch ? ch.name : p.id)}</span></span></button>`;
      }).join('')}</div>` : '');
    out.querySelectorAll('img[data-logo]').forEach(async (img) => {
      const src = await this._signLogo(img.dataset.logo);
      if (src) img.src = src; else img.remove();
    });
  }

  _pickResult(k) {
    const { chans, progs } = this._results || {};
    let ch = null;
    if (k[0] === 'c' && chans) {
      const c = chans[+k.slice(1)];
      ch = c && (this._config.channels.find((x) => x.id === c.id) || { id: c.id, name: c.name, logo: c.logo });
    } else if (k[0] === 'p' && progs) {
      const p = progs[+k.slice(1)];
      ch = p && p.live ? this._config.channels.find((x) => x.id === p.id) : null;
    }
    if (!ch) return;
    this._toggleSearch(false);
    this._play(ch);
  }

  _build() {
    this._built = true;
    const a = this._config.accent;
    this.innerHTML = `
      <style>
        tv-channels-card { display: block; }
        .tv { --acc: ${a}; display: flex; flex-direction: column; gap: 14px; }
        .screen { position: relative; aspect-ratio: 16 / 9; border-radius: 20px; overflow: hidden; background: #000;
          border: 1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent); }
        .idle { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
          color: rgba(255,255,255,.72); text-align: center; padding: 16px; box-sizing: border-box;
          background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--acc) 22%, #000), #000 70%); }
        .idle[hidden] { display: none; }
        .idle ha-icon { --mdc-icon-size: 44px; color: var(--acc); filter: drop-shadow(0 0 10px color-mix(in srgb, var(--acc) 70%, transparent)); }
        .idle .t { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; }
        .idle code { font-size: 11px; color: #fff; background: rgba(255,255,255,.1); padding: 2px 6px; border-radius: 6px; }
        .bar { display: flex; align-items: center; gap: 10px; min-height: 40px; }
        .bar .now { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
        .bar .now .lbl { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--secondary-text-color); }
        .bar .now .nm { font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--secondary-text-color); flex: none; }
        .dot.live { background: #f43f5e; box-shadow: 0 0 8px #f43f5e; animation: pulse 1.6s infinite; }
        @keyframes pulse { 50% { opacity: .35; } }
        .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent);
          background: var(--card-background-color); color: var(--primary-text-color); border-radius: 12px; padding: 7px 12px; font: inherit; font-size: 13px; cursor: pointer; }
        .btn ha-icon { --mdc-icon-size: 18px; }
        .btn[hidden] { display: none; }
        .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .tab { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
          padding: 7px 14px; border-radius: 999px; cursor: pointer; color: var(--secondary-text-color); background: transparent;
          border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
        .tab.on { color: var(--primary-text-color); border-color: var(--acc); background: color-mix(in srgb, var(--acc) 16%, transparent); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
        @media (max-width: 600px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; } }
        .ch { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px; border-radius: 16px; cursor: pointer; text-align: center;
          background: linear-gradient(160deg, color-mix(in srgb, var(--card-background-color) 94%, var(--primary-text-color)), var(--card-background-color));
          border: 1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent); color: var(--primary-text-color); font: inherit;
          transition: border-color .15s, transform .1s; -webkit-tap-highlight-color: transparent; }
        .ch:active { transform: scale(.97); }
        .ch.on { border-color: var(--acc); box-shadow: 0 0 0 1px var(--acc), 0 8px 24px -14px var(--acc); }
        .logo { aspect-ratio: 16 / 10; border-radius: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden;
          background: color-mix(in srgb, #fff 88%, var(--card-background-color)); }
        .logo img { max-width: 78%; max-height: 72%; object-fit: contain; }
        .logo .fb { font-weight: 700; font-size: 15px; color: #111; }
        .logo .fb[hidden] { display: none; }
        .ch .nm { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pg { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .pg[hidden] { display: none; }
        .pg .pt { font-size: 10.5px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pg b { display: block; height: 2px; border-radius: 2px; background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); overflow: hidden; }
        .pg b i, .gbar i { display: block; height: 100%; background: var(--acc); border-radius: inherit; }
        .guide { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 14px; padding: 12px 14px; border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent);
          background: linear-gradient(160deg, color-mix(in srgb, var(--card-background-color) 94%, var(--primary-text-color)), var(--card-background-color)); }
        .guide[hidden] { display: none; }
        @media (max-width: 600px) { .guide { grid-template-columns: 1fr; } }
        .gh { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .gt { font-weight: 600; color: var(--primary-text-color); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gtime { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; }
        .gbar { height: 3px; border-radius: 3px; margin: 8px 0; background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); overflow: hidden; }
        .gdesc { font-size: 12px; line-height: 1.45; color: var(--secondary-text-color); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .gnext { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .gnext .lbl { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--secondary-text-color); }
        .gi { display: flex; gap: 10px; min-width: 0; font-size: 12.5px; }
        .gi .gn { color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .btn.find { padding: 7px 9px; }
        .btn.find.on { border-color: var(--acc); background: color-mix(in srgb, var(--acc) 16%, transparent); }
        .search { display: flex; flex-direction: column; gap: 10px; }
        .search[hidden] { display: none; }
        .search input { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 10px 14px; border-radius: 14px; outline: none;
          color: var(--primary-text-color); background: var(--card-background-color);
          border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
        .search input:focus { border-color: var(--acc); }
        .results { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; max-height: 360px; overflow-y: auto; }
        .rsec { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .rsec .lbl { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
          color: var(--secondary-text-color); margin-bottom: 2px; }
        .rmsg { font-size: 13px; color: var(--secondary-text-color); padding: 4px 2px; }
        .ri { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px 8px; border-radius: 12px; border: 1px solid transparent;
          background: transparent; color: var(--primary-text-color); font: inherit; text-align: left; cursor: pointer; }
        .ri:hover:not([disabled]) { border-color: color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
        .ri.later { cursor: default; opacity: .6; }
        .rlogo { flex: none; width: 48px; aspect-ratio: 16 / 10; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden;
          background: color-mix(in srgb, #fff 88%, var(--card-background-color)); }
        .rlogo img { max-width: 80%; max-height: 74%; object-fit: contain; }
        .rwhen { flex: none; width: 70px; display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--secondary-text-color); }
        .rlive { color: #f43f5e; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; }
        .rt { display: flex; flex-direction: column; min-width: 0; }
        .rn { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rs { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="tv">
        <div class="screen"><div class="idle"></div></div>
        <div class="bar">
          <div class="now"><span class="dot"></span><span class="lbl">${this._t('now')}</span><span class="nm">—</span></div>
          ${this._config.proxy ? `<button class="btn find" title="${this._t('search')}" aria-label="${this._t('search')}"><ha-icon icon="mdi:magnify"></ha-icon></button>` : ''}
          <button class="btn stop" hidden><ha-icon icon="mdi:stop"></ha-icon>${this._t('stop')}</button>
        </div>
        <div class="guide" hidden></div>
        <div class="search" hidden>
          <input type="search" placeholder="${this._t('searchPh')}" autocomplete="off" enterkeyhint="search">
          <div class="results"></div>
        </div>
        <div class="tabs"></div>
        <div class="grid"></div>
      </div>`;
    this._screen = this.querySelector('.screen');
    this._idle = this.querySelector('.idle');
    this.querySelector('.stop').addEventListener('click', () => this._stop());
    if (this._config.proxy) {
      this.querySelector('.find').addEventListener('click', () => this._toggleSearch());
      const input = this.querySelector('.search input');
      input.addEventListener('input', () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this._search(input.value), 350);
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') this._toggleSearch(false);
        if (ev.key === 'Enter') { clearTimeout(this._searchTimer); this._search(input.value); }
      });
      this.querySelector('.results').addEventListener('click', (ev) => {
        const r = ev.target.closest('.ri');
        if (r && !r.disabled) this._pickResult(r.dataset.k);
      });
    }
    this.querySelector('.tabs').addEventListener('click', (ev) => {
      const t = ev.target.closest('.tab');
      if (!t) return;
      this._group = t.dataset.g;
      try { localStorage.setItem('tv-channels-card:group', this._group); } catch (e) { /* storage blocked */ }
      this._render();
      this._refreshEpg();
    });
    this.querySelector('.grid').addEventListener('click', (ev) => {
      const c = ev.target.closest('.ch');
      if (c) this._play(this._config.channels[+c.dataset.i]);
    });
    this._render();
  }

  _render() {
    const fallback = this._t('channels');
    this.querySelector('.tabs').innerHTML = this._groups.length < 2 ? '' : this._groups
      .map((g) => `<button class="tab ${g === this._group ? 'on' : ''}" data-g="${this._esc(g)}">${this._esc(g)}</button>`).join('');
    this.querySelector('.grid').innerHTML = this._config.channels
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (c.group || fallback) === this._group)
      .map(({ c, i }) => {
        const src = this._logoSrc(c);
        return `<button class="ch ${this._current && this._current.id === c.id ? 'on' : ''}" data-i="${i}">
          <span class="logo">${src ? `<img src="${this._esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="fb"${src ? ' hidden' : ''}>${this._esc(c.name)}</span></span>
          <span class="nm">${this._esc(c.name)}</span><span class="pg" hidden><span class="pt"></span><b><i></i></b></span></button>`;
      }).join('');
    this.querySelectorAll('.logo img').forEach((img) => img.addEventListener('error', () => {
      const fb = img.parentElement && img.parentElement.querySelector('.fb');
      img.remove();
      if (fb) fb.removeAttribute('hidden');
    }, { once: true }));
    this._paintEpg();
    this._paintGuide();
    const cur = this._current;
    this.querySelector('.now .nm').textContent = cur ? cur.name : '—';
    this.querySelector('.dot').classList.toggle('live', !!cur);
    this.querySelector('.stop').hidden = !cur;
    this._idle.hidden = !!cur;
    this._idle.innerHTML = `<ha-icon icon="mdi:television-classic"></ha-icon><span class="t">${this._t('pick')}</span>`;
  }

  _play(ch) {
    if (!ch || (this._current && this._current.id === ch.id && this._player)) return;
    this._stop(true);
    this._playHls(ch);
  }

  async _playHls(ch) {
    const token = (this._hlsToken = (this._hlsToken || 0) + 1);
    let url;
    if (this._config.proxy) {
      try { url = await this._sign(`${this._config.proxy}/live/${encodeURIComponent(ch.id)}.m3u8`, 12 * 3600); } catch (e) { url = null; }
      if (token !== this._hlsToken) return;
    } else {
      url = this._config.source_hls.split('{id}').join(ch.id);
    }
    const video = document.createElement('video');
    Object.assign(video, { controls: true, autoplay: true, playsInline: true });
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000';
    this._screen.appendChild(video);
    this._player = video;
    this._current = ch;
    this._guide = [];
    this._render();
    this._refreshEpg();

    const fail = (reason) => {
      if (token !== this._hlsToken) return;
      const blocked = window.location.protocol === 'https:' && (url || '').startsWith('http:');
      this._stop(true);
      this._current = ch;
      this._render();
      this._idle.hidden = false;
      this._idle.innerHTML = blocked
        ? `<ha-icon icon="mdi:shield-lock-outline"></ha-icon><span class="t">${this._t('blocked')}</span><span>${this._t('blockedText')}</span>`
        : `<ha-icon icon="mdi:alert-outline"></ha-icon><span class="t">${this._t('failed')}</span><span>${this._esc(reason || '')}</span>`;
    };
    if (!url) { fail(this._t('noProxy')); return; }
    const start = () => video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });

    if (video.canPlayType('application/vnd.apple.mpegurl') && !window.MediaSource) {
      video.src = url; // Safari / iOS native HLS
      video.addEventListener('error', () => fail(this._t('unavailable')), { once: true });
      start();
      return;
    }
    let Hls;
    try {
      Hls = window.Hls || (await import(this._config.hls_js || 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.mjs')).default;
    } catch (e) { fail(this._t('noHls')); return; }
    if (token !== this._hlsToken || this._player !== video) return;
    if (!Hls.isSupported()) { fail(this._t('unsupported')); return; }
    const hls = new Hls({ liveSyncDurationCount: 4, maxBufferLength: 30, backBufferLength: 30, enableWorker: true });
    this._hls = hls;
    let retried = false;
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !retried) { retried = true; hls.recoverMediaError(); return; }
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && !retried && d.response && d.response.code) { retried = true; hls.startLoad(); return; }
      fail(d.details);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, start);
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  _stop(silent) {
    this._hlsToken = (this._hlsToken || 0) + 1;
    if (this._hls) { try { this._hls.destroy(); } catch (e) { /* already gone */ } this._hls = null; }
    if (this._player) {
      this._player.removeAttribute('src');
      try { this._player.load(); } catch (e) { /* detached */ }
      this._player.remove();
      this._player = null;
    }
    if (this._current) {
      this._current = null;
      if (!silent && this._built) this._render();
    }
  }
}

if (!customElements.get('tv-channels-card')) {
  customElements.define('tv-channels-card', TvChannelsCard);
  console.info(`%c TV-CHANNELS-CARD %c ${VERSION} `, 'color:#fff;background:#a78bfa;font-weight:700', 'color:#a78bfa;background:#1f1f1f');
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'tv-channels-card')) {
  window.customCards.push({
    type: 'tv-channels-card',
    name: 'TV Channels Card',
    description: 'IPTV channel tiles, an HLS player and a programme guide (works with the iptv_proxy integration).',
    preview: false,
    documentationURL: 'https://github.com/ohnoitsfraa/tv-channels-card',
  });
}
