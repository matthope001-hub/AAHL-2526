/**
 * trades.js - Trade Tracker (More -> Trade Tracker).
 * Every NHL trade this season that involves a player in the pool's boxes,
 * with both sides of the deal. Data: worker GET api.theaahl.ca/?action=trades
 * - NHL.com's official season trade tracker (full details), ESPN's public
 * transactions feed (second source), trades the commissioner
 * adds in Admin, NHL roster changes and trade headlines from NHL.com, ESPN
 * and Sportsnet. Until full details are posted, a pool player who changed
 * teams or was reported traded gets a "breaking" card; every source that
 * confirms a trade is shown as a badge.
 * Load after main.js (uses allPlayers, poolPlayerIds, currentConfig,
 * ensurePlayersLoaded, escapeHtml, and pick counts from stats.js).
 */
(function () {
  const API = 'https://api.theaahl.ca/';
  const MOUNT = '#trades-content';
  let loading = false;

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  // "F A, D B and a 2027 pick (No. 3 and 4)" -> ["F A", "D B", "a 2027 pick (No. 3 and 4)"]
  function splitAssets_(str) {
    const out = []; let cur = '', depth = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(') depth++;
      if (c === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && c === ',') { out.push(cur); cur = ''; continue; }
      if (depth === 0 && s.slice(i, i + 5) === ' and ') { out.push(cur); cur = ''; i += 4; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim().replace(/^and\s+/i, '')).filter(Boolean);
  }

  function poolIndex_() {
    const ids = (typeof poolPlayerIds !== 'undefined' && poolPlayerIds) || new Set();
    return (allPlayers || []).filter(p => ids.has(p.id) && p.fullName)
      .map(p => ({ p, key: ' ' + norm(p.fullName) + ' ' }));
  }

  function findPool_(asset, idx) {
    const a = ' ' + norm(asset) + ' ';
    const hit = idx.find(x => a.includes(x.key));
    return hit ? hit.p : null;
  }

  function dateLabel_(ymd) {
    return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function assetHtml_(asset, idx, side, nhlTeams) {
    const p = findPool_(asset, idx);
    if (!p) return `<li class="tt-asset">${esc(asset)}</li>`;
    const m = asset.match(/^(F|D|G|Fs|Ds|Gs|forwards?|defensem[ae]n|goalies?)\s+/i);
    if (m) m[1] = m[1][0].toUpperCase();
    const n = typeof pickedCount_ === 'function' ? pickedCount_(p.id) : 0;
    const label = n ? `Picked by ${n}` : 'In the pool';
    const picked = n && typeof pickedLink_ === 'function' ? pickedLink_(p.id, label) : esc(label);
    const nhlOk = side.team && nhlTeams[String(p.id)] === side.team;
    return `<li class="tt-asset tt-pool">
      ${m ? `<span class="tt-pos mono">${m[1]}</span>` : ''}<b>${esc(p.fullName)}</b>
      <span class="tt-tag mono">${picked}</span>
      ${nhlOk ? '<span class="tt-tag tt-ok mono" title="NHL roster shows him on this team">✓ NHL</span>' : ''}
    </li>`;
  }

  const SRC_LABEL = { tracker: 'NHL.com trade tracker', roster: 'NHL roster', 'nhl.com': 'NHL.com', espn: 'ESPN', sportsnet: 'Sportsnet', feed: 'ESPN transactions', manual: 'Commissioner' };
  function badgesHtml_(srcs) {
    const list = [...new Set(srcs)].filter(x => SRC_LABEL[x]);
    return list.length ? `<div class="tt-confirm mono">CONFIRMED BY ${list.map(x => `<span class="tt-tag tt-ok">✓ ${esc(SRC_LABEL[x])}</span>`).join('')}</div>` : '';
  }

  function cardHtml_(t, idx, ctx) {
    const srcs = [t.source === 'manual' ? 'manual' : t.source === 'tracker' ? 'tracker' : 'feed'].concat(t.also || []);
    t.sides.forEach(side => splitAssets_(side.gets).forEach(a => {
      const p = findPool_(a, idx);
      if (!p) return;
      if (side.team && ctx.nhlTeams[String(p.id)] === side.team) srcs.push('roster');
      const r = ctx.reports[String(p.id)];
      if (r && Math.abs(new Date(r.date) - new Date(t.date)) <= 7 * 86400000) srcs.push(...Object.keys(r.sources || {}));
    }));
    return `<div class="tt-card">
      <div class="tt-head mono"><span>🔁 TRADE${t.source === 'manual' ? ' · <span class="tt-src">DETAILS TO FOLLOW</span>' : ''}</span><span>${esc(dateLabel_(t.date))}</span></div>
      <div class="tt-sides">
        ${t.sides.map(s => `<div class="tt-side">
          <div class="tt-team">
            ${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">` : ''}
            <span>${esc(s.name || s.team)}</span>
          </div>
          <div class="tt-gets mono">GETS</div>
          <ul>${splitAssets_(s.gets).map(a => assetHtml_(a, idx, s, ctx.nhlTeams)).join('')}</ul>
        </div>`).join('<div class="tt-swap mono">⇄</div>')}
      </div>
      ${badgesHtml_(srcs)}
    </div>`;
  }

  // A pool player the NHL roster moved and/or the news reported traded,
  // before the full trade is posted.
  function breakingHtml_(id, c, r) {
    const p = (allPlayers || []).find(x => String(x.id) === String(id));
    const name = (p && p.fullName) || (c && c.name) || (r && r.name) || 'Player';
    const n = p && typeof pickedCount_ === 'function' ? pickedCount_(p.id) : 0;
    const picked = n && typeof pickedLink_ === 'function' ? pickedLink_(p.id, `Picked by ${n}`) : 'In the pool';
    const rs = (r && r.sources) || {};
    const head = ['nhl.com', 'espn', 'sportsnet'].map(k => rs[k] && rs[k].title).find(Boolean);
    const logo = t => `<img src="https://assets.nhle.com/logos/nhl/svg/${esc(t)}_light.svg" alt="">`;
    const srcs = (c ? ['roster'] : []).concat(Object.keys(rs));
    return `<div class="tt-card tt-change">
      <div class="tt-head mono"><span>🚨 BREAKING · DETAILS TO FOLLOW</span><span>${esc(dateLabel_((c && c.date) || (r && r.date)))}</span></div>
      <div class="tt-move">
        <b>${esc(name)}</b>
        ${c ? `<span class="tt-route mono">${logo(c.from)}${esc(c.from)}<span class="tt-arrow">→</span>${logo(c.to)}${esc(c.to)}</span>` : ''}
        <span class="tt-tag mono">${picked}</span>
      </div>
      ${head ? `<div class="tt-headline">“${esc(head)}”</div>` : ''}
      ${badgesHtml_(srcs).replace('CONFIRMED BY', 'REPORTED BY')}
    </div>`;
  }

  function injectCss_() {
    if (document.getElementById('tt-css')) return;
    const st = document.createElement('style');
    st.id = 'tt-css';
    st.textContent = `
      .tt-list { display: grid; gap: 12px; }
      .tt-card { background: var(--bg-panel); border: 1px solid var(--border); border-left: 3px solid var(--ice); padding: 12px 14px; }
      .tt-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-dim); letter-spacing: 1px; margin-bottom: 10px; }
      .tt-sides { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: start; }
      .tt-swap { align-self: center; color: var(--ice); font-size: 20px; }
      .tt-team { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; text-transform: uppercase; }
      .tt-team img { width: 28px; height: 28px; object-fit: contain; }
      .tt-gets { font-size: 11px; color: var(--text-dim); margin: 6px 0 4px; letter-spacing: 1px; }
      .tt-side ul { list-style: none; display: grid; gap: 4px; }
      .tt-asset { font-size: 15px; line-height: 1.3; }
      .tt-pool { background: color-mix(in srgb, var(--ice) 16%, transparent); border-left: 3px solid var(--ice); padding: 4px 8px; border-radius: 3px; }
      .tt-pool b { color: var(--ice); font-size: 16px; }
      .tt-pool::before { content: 'IN POOL'; font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px; color: var(--bg); background: var(--ice); padding: 1px 5px; margin-right: 6px; border-radius: 2px; vertical-align: 2px; }
      .tt-pos { font-size: 11px; color: var(--text-dim); margin-right: 4px; }
      .tt-tag { display: inline-block; font-size: 11px; color: var(--text-dim); border: 1px solid var(--border); padding: 0 5px; margin-left: 4px; }
      .tt-note { color: var(--text-dim); font-size: 13px; margin-bottom: 12px; }
      .tt-ok { color: var(--ice); border-color: var(--ice); }
      .tt-src { color: var(--amber); }
      .tt-change { border-left-color: var(--amber); }
      .tt-move { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 18px; }
      .tt-move b { color: var(--ice); }
      .tt-route { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
      .tt-route img { width: 24px; height: 24px; object-fit: contain; }
      .tt-arrow { color: var(--amber); }
      .tt-confirm { font-size: 11px; color: var(--text-dim); letter-spacing: 1px; margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
      .tt-confirm .tt-tag { margin-left: 0; }
      .tt-headline { font-size: 14px; color: var(--text-dim); margin-top: 6px; font-style: italic; }
      @media (max-width: 600px) {
        .tt-sides { grid-template-columns: 1fr; }
        .tt-swap { justify-self: center; transform: rotate(90deg); }
      }`;
    document.head.appendChild(st);
  }

  async function mount() {
    const root = document.querySelector(MOUNT);
    if (!root || loading) return;
    loading = true;
    injectCss_();
    root.innerHTML = '<p class="mono" style="color:var(--text-dim)">Loading trades…</p>';
    try {
      const cfg = (typeof currentConfig !== 'undefined' && currentConfig) || {};
      const since = String(cfg.seasonStartDate || cfg.deadline || '2026-09-01').slice(0, 10);
      const [res] = await Promise.all([
        fetch(API + '?action=trades&since=' + encodeURIComponent(since), { cache: 'no-store' }).then(r => r.json()),
        typeof ensurePlayersLoaded === 'function' ? ensurePlayersLoaded() : null,
        typeof ensurePickCountsLoaded_ === 'function' ? ensurePickCountsLoaded_() : null
      ]);
      if (!res.success) throw new Error(res.error || 'Could not load trades');
      const idx = poolIndex_();
      const reports = {};
      (res.reports || []).forEach(r => { if (!reports[r.id]) reports[r.id] = r; });
      const ctx = { nhlTeams: res.nhlTeams || {}, reports };
      const trades = (res.trades || []).filter(t => t.sides.some(s => splitAssets_(s.gets).some(a => findPool_(a, idx))));
      // A breaking card goes away once a trade mentions that player.
      const inTrade = new Set();
      trades.forEach(t => t.sides.forEach(s => splitAssets_(s.gets).forEach(a => { const p = findPool_(a, idx); if (p) inTrade.add(String(p.id)); })));
      const changes = {};
      (res.changes || []).forEach(c => { if (!changes[c.id]) changes[c.id] = c; });
      const breakIds = [...new Set(Object.keys(changes).concat(Object.keys(reports)))].filter(id => !inTrade.has(String(id)))
        // A news report with no roster move and no trade after 14 days is dropped.
        .filter(id => changes[id] || (Date.now() - new Date(reports[id].date + 'T12:00:00Z')) <= 14 * 86400000);
      const items = trades.map(t => ({ date: t.date, html: cardHtml_(t, idx, ctx) }))
        .concat(breakIds.map(id => ({ date: (changes[id] && changes[id].date) || reports[id].date, html: breakingHtml_(id, changes[id], reports[id]) })))
        .sort((a, b) => b.date.localeCompare(a.date));
      root.innerHTML = `
        <p class="tt-note">Every NHL trade since ${esc(dateLabel_(res.since))} that involves a player in the pool. Players in the pool are highlighted. Each trade lists the sources that confirm it: NHL.com's trade tracker, the NHL roster, ESPN and Sportsnet. Checked every 30 minutes.</p>
        ${items.length ? `<div class="tt-list">${items.map(i => i.html).join('')}</div>`
          : '<p class="mono" style="color:var(--text-dim); font-size:13px;">No trades involving pool players yet this season.</p>'}`;
    } catch (err) {
      root.innerHTML = '<p class="mono" style="color:var(--text-dim); font-size:13px;">Couldn\'t load trades. Try again in a minute.</p>';
    } finally {
      loading = false;
    }
  }

  document.querySelectorAll('.nav-link[data-view="trades"]').forEach(l => l.addEventListener('click', () => {
    document.title = 'Trade Tracker — AAHL 26/27';
    mount();
  }));

  window.Trades = { mount };
})();
