/**
 * Highlights - goal and assist clips for every pool player.
 * Data comes from the worker (GET api.theaahl.ca/?action=highlights&date=),
 * which picks the clips out of the NHL score feed during live points.
 * Clips play in an overlay (NHL's Brightcove player) with a link to NHL.com.
 */
(function () {
  const API = 'https://api.theaahl.ca/';
  const TZ = 'America/Toronto';
  const state = { root: null, date: null, filter: 'all', items: [], timer: null, loading: false };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Hockey day rolls over at 5am ET (same as the worker).
  function hockeyDay_() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(Date.now() - 5 * 3600000));
  }
  function addDays_(ymd, n) {
    const d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dayLabel_(ymd) {
    const today = hockeyDay_();
    if (ymd === today) return 'Tonight';
    if (ymd === addDays_(today, -1)) return 'Last night';
    return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  async function load_(quiet) {
    if (state.loading) return;
    state.loading = true;
    if (!quiet) state.root.querySelector('.hl-feed').innerHTML = '<div class="hl-empty">Loading highlights…</div>';
    try {
      const res = await fetch(API + '?action=highlights&date=' + encodeURIComponent(state.date), { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not load highlights');
      state.items = (json.items || []).slice().reverse(); // newest first
    } catch (err) {
      if (!quiet) state.root.querySelector('.hl-feed').innerHTML = '<div class="hl-empty">Couldn\'t load highlights. Try again in a minute.</div>';
      state.loading = false;
      return;
    }
    state.loading = false;
    render_();
  }

  function card_(i) {
    const what = i.type === 'goal'
      ? 'Goal' + (i.strength === 'pp' ? ' · PPG' : i.strength === 'sh' ? ' · SHG' : '') + (i.modifier === 'empty-net' ? ' · EN' : '')
      : (i.primary ? 'Primary assist' : 'Secondary assist');
    const sub = i.type === 'assist' ? 'On ' + esc(i.scorer) + '\'s goal' : (i.toDate ? 'Goal #' + i.toDate + ' this season' : '');
    const ready = !!i.embed;
    return `<button class="hl-card hl-${i.type}${ready ? '' : ' hl-wait'}" data-id="${esc(i.id)}" ${ready ? '' : 'aria-disabled="true"'}>
      <img class="hl-mug" src="https://assets.nhle.com/mugs/nhl/20262027/${esc(i.team)}/${esc(i.playerId)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="hl-body">
        <span class="hl-top"><span class="hl-tag mono">${i.type === 'goal' ? 'G' : 'A'}</span><strong>${esc(i.name)}</strong></span>
        <span class="hl-line">${what} · ${esc(i.period)} ${esc(i.time)}</span>
        <span class="hl-line hl-dim">${sub ? sub + ' · ' : ''}${esc(i.score)}</span>
      </span>
      <span class="hl-play mono">${ready ? '▶' : 'Clip coming'}</span>
    </button>`;
  }

  function render_() {
    const list = state.items.filter(i => state.filter === 'all' || i.type === state.filter);
    const goals = state.items.filter(i => i.type === 'goal').length;
    const assists = state.items.length - goals;
    state.root.querySelector('.hl-day').textContent = dayLabel_(state.date);
    state.root.querySelector('.hl-next').disabled = state.date >= hockeyDay_();
    state.root.querySelectorAll('.hl-filters .filter-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.f === state.filter);
      const n = b.dataset.f === 'all' ? state.items.length : b.dataset.f === 'goal' ? goals : assists;
      b.textContent = (b.dataset.f === 'all' ? 'All' : b.dataset.f === 'goal' ? 'Goals' : 'Assists') + ' ' + n;
    });
    state.root.querySelector('.hl-feed').innerHTML = list.length
      ? list.map(card_).join('')
      : `<div class="hl-empty">No pool player points ${state.date === hockeyDay_() ? 'yet tonight' : 'that day'}.</div>`;
  }

  function open_(item) {
    close_();
    const wrap = document.createElement('div');
    wrap.className = 'hl-modal';
    wrap.innerHTML = `<div class="hl-sheet" role="dialog" aria-label="${esc(item.name)} highlight">
      <div class="hl-video"><iframe src="${esc(item.embed)}&autoplay=1" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe></div>
      <div class="hl-meta">
        <div><strong>${esc(item.name)}</strong> <span class="hl-dim">${item.type === 'goal' ? 'Goal' : 'Assist on ' + esc(item.scorer) + '\'s goal'} · ${esc(item.matchup)} · ${esc(item.period)} ${esc(item.time)}</span></div>
        ${item.clipUrl ? `<a href="${esc(item.clipUrl)}" target="_blank" rel="noopener">Open on NHL.com</a>` : ''}
        <button class="hl-close" aria-label="Close">✕</button>
      </div>
    </div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('.hl-close')) close_(); });
    document.body.appendChild(wrap);
    document.addEventListener('keydown', escKey_);
  }
  function close_() {
    document.querySelectorAll('.hl-modal').forEach(m => m.remove());
    document.removeEventListener('keydown', escKey_);
  }
  function escKey_(e) { if (e.key === 'Escape') close_(); }

  function mount(selector) {
    const root = document.querySelector(selector);
    if (!root) return;
    if (state.root !== root) {
      state.root = root;
      state.date = hockeyDay_();
      root.innerHTML = `<div class="hl-bar">
          <button class="hl-prev filter-tab" aria-label="Previous day">‹</button>
          <span class="hl-day mono"></span>
          <button class="hl-next filter-tab" aria-label="Next day">›</button>
          <span class="hl-filters">
            <button class="filter-tab active" data-f="all">All</button>
            <button class="filter-tab" data-f="goal">Goals</button>
            <button class="filter-tab" data-f="assist">Assists</button>
          </span>
        </div>
        <div class="hl-feed"></div>
        <p class="hl-note hl-dim">Cards show up within minutes of the play; the video follows once the NHL posts it. Clips are official NHL highlights.</p>`;
      root.querySelector('.hl-prev').addEventListener('click', () => { state.date = addDays_(state.date, -1); load_(); });
      root.querySelector('.hl-next').addEventListener('click', () => { if (state.date < hockeyDay_()) { state.date = addDays_(state.date, 1); load_(); } });
      root.querySelector('.hl-filters').addEventListener('click', e => {
        const b = e.target.closest('[data-f]');
        if (b) { state.filter = b.dataset.f; render_(); }
      });
      root.querySelector('.hl-feed').addEventListener('click', e => {
        const c = e.target.closest('.hl-card');
        if (!c || c.classList.contains('hl-wait')) return;
        const item = state.items.find(i => i.id === c.dataset.id);
        if (item) open_(item);
      });
    }
    load_();
    // Refresh every 60s while the Highlights view is showing today.
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      const view = document.getElementById('view-highlights');
      if (!view || !view.classList.contains('active') || document.hidden) return;
      if (state.date === hockeyDay_()) load_(true);
    }, 60000);
  }

  window.Highlights = { mount: mount };
})();
