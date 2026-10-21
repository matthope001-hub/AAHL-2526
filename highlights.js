/**
 * Highlights - goal and assist clips, plus fight cards, for every pool player.
 * Data comes from the worker (GET api.theaahl.ca/?action=highlights&date=),
 * which picks the clips out of the NHL score feed during live points.
 * Clips play in an overlay (NHL's Brightcove player) with a link to NHL.com.
 */
(function () {
  const API = 'https://api.theaahl.ca/';
  const TZ = 'America/Toronto';
  const state = { root: null, date: null, filter: 'all', items: [], games: {}, open: {}, timer: null };

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

  // Latest request wins: a tap on ‹ / › never waits on (or is blocked by)
  // an earlier load. Each load gives up after 20s.
  let reqSeq_ = 0;
  async function load_(quiet) {
    const seq = ++reqSeq_, date = state.date;
    if (state.openDate !== date) { state.open = {}; state.openDate = date; }
    if (!quiet) {
      state.items = [];
      state.root.querySelector('.hl-day').textContent = dayLabel_(date);
      state.root.querySelector('.hl-next').disabled = date >= hockeyDay_();
      state.root.querySelector('.hl-feed').innerHTML = '<div class="hl-empty">Loading highlights…</div>';
    }
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
    try {
      const res = await fetch(API + '?action=highlights&date=' + encodeURIComponent(date), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not load highlights');
      if (seq !== reqSeq_) return; // a newer day was picked meanwhile
      state.items = json.items || []; // in game order, then play order
      state.games = json.games || {};
      render_();
    } catch (err) {
      if (seq !== reqSeq_ || quiet) return;
      state.root.querySelector('.hl-feed').innerHTML = '<div class="hl-empty">Couldn\'t load highlights. Try again in a minute.</div>';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function card_(i) {
    if (i.type === 'fight') {
      return `<button type="button" class="hl-card hl-fight" data-id="${esc(i.id)}">
      <img class="hl-mug" src="https://assets.nhle.com/mugs/nhl/20262027/${esc(i.team)}/${esc(i.playerId)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="hl-body">
        <span class="hl-top"><span class="hl-tag mono">F</span><strong>${esc(i.name)}</strong></span>
        <span class="hl-line">Fight · ${esc(i.period)} ${esc(i.time)}</span>
        <span class="hl-line hl-dim">${i.opponent ? 'vs ' + esc(i.opponent) + (i.opponentTeam ? ' (' + esc(i.opponentTeam) + ')' : '') + ' · ' : ''}${esc(i.matchup)}</span>
      </span>
      <span class="hl-play mono">${i.hfUrl ? '🥊 ▶' : '🥊'}</span>
    </button>`;
    }
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

  function syncAll_() {
    const ds = [...state.root.querySelectorAll('.hl-game')];
    const btn = state.root.querySelector('.hl-all');
    btn.hidden = !ds.length;
    btn.textContent = ds.length && ds.every(d => d.open) ? 'Collapse all' : 'Expand all';
  }

  function render_() {
    const list = state.items.filter(i => state.filter === 'all' || i.type === state.filter);
    const count = { all: state.items.length, goal: 0, assist: 0, fight: 0 };
    state.items.forEach(i => { count[i.type] = (count[i.type] || 0) + 1; });
    const label = { all: 'All', goal: 'Goals', assist: 'Assists', fight: 'Fights' };
    state.root.querySelector('.hl-day').textContent = dayLabel_(state.date);
    state.root.querySelector('.hl-next').disabled = state.date >= hockeyDay_();
    state.root.querySelectorAll('.hl-filters .filter-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.f === state.filter);
      b.textContent = label[b.dataset.f] + ' ' + (count[b.dataset.f] || 0);
    });
    // Grouped by game (start order), plays in order within each game.
    const games = [];
    list.forEach(i => {
      let g = games.find(x => x.id === i.gameId);
      if (!g) games.push(g = { id: i.gameId, matchup: i.matchup, items: [] });
      g.items.push(i);
    });
    games.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    state.root.querySelector('.hl-feed').innerHTML = list.length
      ? games.map(g => {
          const gi = state.games[String(g.id)];
          const score = gi ? `${gi.away} ${gi.awayScore}, ${gi.home} ${gi.homeScore} · ${gi.state === 'final' ? 'Final' + (gi.finalType ? '/' + gi.finalType : '') : 'Live' + (gi.period ? ' ' + gi.period : '')}` : '';
          return `<details class="hl-game" data-game="${esc(g.id)}"${state.open[g.id] ? ' open' : ''}>
            <summary class="hl-game-head"><span class="hl-chev">▸</span><strong>${esc(g.matchup)}</strong><span class="hl-dim mono">${esc(score)}${score ? ' · ' : ''}${g.items.length} ${g.items.length === 1 ? 'clip' : 'clips'}</span></summary>
            <div class="hl-game-list">${g.items.map(card_).join('')}</div>
          </details>`;
        }).join('')
      : `<div class="hl-empty">No pool player points ${state.date === hockeyDay_() ? 'yet tonight' : 'that day'}.</div>`;
    syncAll_();
  }

  function fightLinks_(item) {
    const q = encodeURIComponent([item.name.replace(/^[A-Z]\. /, ''), item.opponent ? item.opponent.replace(/^[A-Z]\. /, '') : '', 'fight'].join(' ').trim());
    if (item.hfUrl) {
      return `<a href="${esc(item.hfUrl)}" target="_blank" rel="noopener">Watch on HockeyFights.com</a>
      <a href="https://www.nhl.com/gamecenter/${esc(item.gameId)}" target="_blank" rel="noopener">Game on NHL.com</a>`;
    }
    return `<a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Find the video on YouTube</a>
      <a href="https://www.nhl.com/gamecenter/${esc(item.gameId)}" target="_blank" rel="noopener">Game on NHL.com</a>`;
  }

  function open_(item) {
    close_();
    const wrap = document.createElement('div');
    wrap.className = 'hl-modal';
    wrap.innerHTML = `<div class="hl-sheet" role="dialog" aria-label="${esc(item.name)} highlight">
      ${item.type === 'fight'
        ? `<div class="hl-fight-box"><div class="hl-fight-icon">🥊</div><div><strong>${esc(item.name)}</strong> vs <strong>${esc(item.opponent || 'unknown')}</strong></div><div class="hl-dim">${esc(item.matchup)} · ${esc(item.period)} ${esc(item.time)} · 5 min fighting major</div><div class="hl-dim">${item.hfUrl ? 'Fight video courtesy of HockeyFights.com.' : 'No HockeyFights.com video found yet — it\'s usually posted later that night.'}</div></div>`
        : `<div class="hl-video"><iframe src="${esc(item.embed)}&autoplay=1" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe></div>`}
      <div class="hl-meta">
        ${item.type === 'fight' ? fightLinks_(item) : `<div><strong>${esc(item.name)}</strong> <span class="hl-dim">${item.type === 'goal' ? 'Goal' : 'Assist on ' + esc(item.scorer) + '\'s goal'} · ${esc(item.matchup)} · ${esc(item.period)} ${esc(item.time)}</span></div>
        ${item.clipUrl ? `<a href="${esc(item.clipUrl)}" target="_blank" rel="noopener">Open on NHL.com</a>` : ''}`}
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
          <button type="button" class="hl-prev filter-tab" aria-label="Previous day">‹</button>
          <span class="hl-day mono"></span>
          <button type="button" class="hl-next filter-tab" aria-label="Next day">›</button>
          <span class="hl-filters">
            <button class="filter-tab active" data-f="all">All</button>
            <button class="filter-tab" data-f="goal">Goals</button>
            <button class="filter-tab" data-f="assist">Assists</button>
            <button class="filter-tab" data-f="fight">Fights</button>
          </span>
        </div>
        <div class="hl-tools"><button type="button" class="hl-all">Expand all</button></div>
        <div class="hl-feed"></div>
        <p class="hl-note hl-dim">Cards show up within minutes of the play; the video follows once the NHL posts it. Clips are official NHL highlights. Fight videos are from HockeyFights.com.</p>`;
      root.querySelector('.hl-prev').addEventListener('click', () => { state.date = addDays_(state.date, -1); load_(); });
      root.querySelector('.hl-next').addEventListener('click', () => { if (state.date < hockeyDay_()) { state.date = addDays_(state.date, 1); load_(); } });
      root.querySelector('.hl-filters').addEventListener('click', e => {
        const b = e.target.closest('[data-f]');
        if (b) { state.filter = b.dataset.f; render_(); }
      });
      root.querySelector('.hl-feed').addEventListener('toggle', e => {
        const d = e.target.closest && e.target.closest('.hl-game');
        if (d) state.open[d.dataset.game] = d.open;
        syncAll_();
      }, true);
      root.querySelector('.hl-all').addEventListener('click', () => {
        const ds = [...root.querySelectorAll('.hl-game')];
        const openAll = ds.some(d => !d.open);
        ds.forEach(d => { d.open = openAll; state.open[d.dataset.game] = openAll; });
        syncAll_();
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
