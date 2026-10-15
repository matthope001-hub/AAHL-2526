/**
 * ux.js
 * Small extras, all optional - if a library doesn't load, the site works
 * exactly as before.
 *
 *  1. Stat tooltips (Tippy.js): hover a stat on a player card or a table
 *     header (phones: press and hold) to see what it is and how it scores.
 *     PTS on a card shows that player's points breakdown.
 *  2. Pull to refresh (PullToRefresh.js): in the installed app only (the
 *     browser has its own), pull down at the top of the page to reload.
 *  3. Loading bar (NProgress): a thin bar along the top while data loads
 *     after something you tapped (not for background live updates).
 *  4. Countdowns (easytimer.js): the Home milestone box ("in 136d 8h"),
 *     "Next puck drop 7:00 PM · in 2h 13m" in the Today's Games heading, and the
 *     trade deadline on My Team. Any element with data-countdown="..."
 *     (milestone / puck / trade) is kept up to date every second.
 *  5. "Last Night in the AAHL" recap card on Home (written each morning by
 *     the Worker with Workers AI - config/nightlyRecap).
 *  6. What's New: More -> What's New shows CHANGELOG.md (the one place the
 *     update history is kept), the footer shows the current version, and
 *     a dot marks What's New until you've seen the latest update.
 *
 * Loaded last (defer) in index.html, after the three libraries.
 */
(function () {
  // ------------------------------------------------------------ helpers
  const cfg = () => (typeof currentConfig !== 'undefined' && currentConfig) || {};
  const num = (v, d) => (v ?? d);
  const fmt = (n) => String(Math.round(n * 100) / 100);

  // Points per stat for a position group ('F', 'D' or 'G').
  function rates(pos) {
    const c = cfg();
    if (pos === 'G') return {
      W: num(c.winPtsG, 3), L: num(c.lossPtsG, 1), OTL: num(c.otlPtsG, 1.5),
      SO: num(c.shutoutPtsG, 2), SV: num(c.savePtsG, 0.02)
    };
    const d = pos === 'D';
    const r = {
      G: num(d ? c.goalPtsD : c.goalPtsF, 1),
      A: num(d ? c.assistPtsD : c.assistPtsF, 1),
      SOG: num(d ? c.sogPtsD : c.sogPtsF, 0.11),
      HT: num(c.hatTrickBonus, 3)
    };
    if (d) r.PIM = num(c.pimPtsD, 0.25);
    return r;
  }

  // General explanation of a stat label (table headers, cards).
  function statTip(label, pos) {
    const c = cfg();
    const f = rates('F'), d = rates('D'), g = rates('G');
    const both = (k) => pos === 'F' || pos === 'D'
      ? `${fmt(rates(pos)[k])} pts each`
      : (f[k] === d[k] ? `${fmt(f[k])} pts each` : `F ${fmt(f[k])} · D ${fmt(d[k])} pts each`);
    switch (label) {
      case 'GP': return 'Games played';
      case 'G': return 'Goals · ' + both('G');
      case 'A': return 'Assists · ' + both('A');
      case 'SOG': return 'Shots on goal · ' + both('SOG');
      case 'HT': return `Hat tricks · +${fmt(f.HT)} bonus each`;
      case 'PIM': return `Penalty minutes · ${fmt(d.PIM)} pts each (defence only)`;
      case 'W': return `Wins · ${fmt(g.W)} pts each`;
      case 'L': return `Losses · ${fmt(g.L)} pts each`;
      case 'OTL': return `Overtime / shootout losses · ${fmt(g.OTL)} pts each`;
      case 'SO': return `Shutouts · +${fmt(g.SO)} bonus each`;
      case 'SV': return `Saves · ${fmt(g.SV)} pts each`;
      case 'PTS': return 'Pool points';
      default: return '';
    }
  }

  // Position of the player on a card: goalie if it shows W, D if PIM, or
  // read from the "TEAM · POS" line.
  function cardPos(strip) {
    const labels = [...strip.querySelectorAll('small')].map(s => s.textContent.trim());
    if (labels.includes('W') || labels.includes('SV')) return 'G';
    if (labels.includes('PIM')) return 'D';
    const card = strip.closest('.aahl-pc, .aahl-fc');
    const meta = card && card.querySelector('.aahl-pc-meta, .aahl-fc-meta');
    if (meta && / · D\b/.test(meta.textContent)) return 'D';
    return 'F';
  }

  // "4 G × 1 + 13 A × 1 + 14 SOG × 0.11 = 18.54" from the card's own numbers.
  function ptsBreakdown(strip) {
    const pos = cardPos(strip);
    const r = rates(pos);
    const parts = [];
    let total = 0;
    strip.querySelectorAll(':scope > div').forEach(cell => {
      const lbl = (cell.querySelector('small') || {}).textContent;
      const val = parseFloat((cell.querySelector('b') || {}).textContent);
      if (!lbl || !(lbl.trim() in r) || !val) return;
      const k = lbl.trim();
      total += val * r[k];
      parts.push(`${val} ${k} × ${fmt(r[k])}`);
    });
    if (!parts.length) return 'Pool points · nothing scored yet';
    return parts.join(' + ') + ' = ' + fmt(total);
  }

  // Text for whatever was hovered / tapped (or '' for no tooltip).
  function tipFor(el) {
    const strip = el.closest('.aahl-pc-strip, .aahl-fc-strip');
    if (strip) {
      const lbl = ((el.querySelector('small') || {}).textContent || '').trim();
      if (lbl === 'PTS') return ptsBreakdown(strip);
      return statTip(lbl, cardPos(strip));
    }
    if (el.tagName === 'TH') {
      const lbl = el.textContent.replace(/[▲▼↑↓]/g, '').trim().toUpperCase();
      return statTip(lbl);
    }
    return '';
  }

  // ------------------------------------------------------- 1. tooltips
  // Created on first hover, so hundreds of cards cost nothing. On phones:
  // press and hold a stat (a normal tap still opens the card).
  const TIP_TARGETS = '.aahl-pc-strip > div, .aahl-fc-strip > div, th';
  function makeTip(el) {
    if (el._tippy) return el._tippy;
    if (!tipFor(el)) return null;
    tippy(el, {
      content: '',
      theme: 'aahl',
      delay: [250, 0],
      touch: false,             // touch handled by the press-and-hold below
      maxWidth: 260,
      appendTo: () => document.body,
      // Numbers can change (live points) - work the text out each time.
      onShow: (inst) => { const t = tipFor(el); if (!t) return false; inst.setContent(t); }
    });
    return el._tippy;
  }
  function onHover(e) {
    if (typeof tippy !== 'function' || !e.target.closest) return;
    const el = e.target.closest(TIP_TARGETS);
    if (!el || el._tippy) return;
    const inst = makeTip(el);
    if (inst) inst.show(); // this first hover created it, so show it now
  }
  document.addEventListener('mouseover', onHover);
  document.addEventListener('focusin', onHover);

  let holdTimer = null, swallowClick = false;
  document.addEventListener('touchstart', (e) => {
    if (typeof tippy !== 'function' || !e.target.closest) return;
    const el = e.target.closest(TIP_TARGETS);
    if (!el) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      const inst = makeTip(el);
      if (!inst) return;
      swallowClick = true;      // the finger lifting shouldn't open the card
      inst.show();
      setTimeout(() => inst.hide(), 3500);
    }, 450);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(t =>
    document.addEventListener(t, () => clearTimeout(holdTimer), { passive: true }));
  document.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  document.addEventListener('contextmenu', (e) => {
    // Long-press on a stat: no browser menu.
    if (e.target.closest && e.target.closest(TIP_TARGETS)) e.preventDefault();
  });

  // ------------------------------------------------ 2. pull to refresh
  function isInstalledApp() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  }
  function startPullToRefresh() {
    if (!isInstalledApp() || typeof PullToRefresh === 'undefined' || !PullToRefresh.init) return;
    PullToRefresh.init({
      mainElement: 'body',
      distThreshold: 70,
      distMax: 90,
      instructionsPullToRefresh: 'Pull to refresh',
      instructionsReleaseToRefresh: 'Release to refresh',
      instructionsRefreshing: 'Refreshing…',
      // Only when scrolled to the very top and no popup is open.
      shouldPullToRefresh: () => window.scrollY === 0
        && ![...document.querySelectorAll('.modal-overlay')].some(m => m.style.display === 'flex')
        && !document.querySelector('.aahl-card-ov.on'),
      onRefresh: () => { window.location.reload(); }
    });
  }

  // ---------------------------------------------------- 3. loading bar
  // Shown only for data requests that start within 3 seconds of a tap /
  // click / key press and take longer than 0.3s - never for the silent
  // background refreshes during games.
  let lastInput = 0;
  ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => { lastInput = Date.now(); }, { capture: true, passive: true }));
  let inFlight = 0, barTimer = null, barOn = false;
  const DATA_HOSTS = /supabase\.co|script\.google|googleusercontent|api\.theaahl\.ca/;

  function barStart() {
    if (barOn || barTimer || typeof NProgress === 'undefined') return;
    barTimer = setTimeout(() => { barTimer = null; if (inFlight > 0) { barOn = true; NProgress.start(); } }, 300);
  }
  function barDone() {
    if (inFlight > 0) return;
    if (barTimer) { clearTimeout(barTimer); barTimer = null; }
    if (barOn) { barOn = false; NProgress.done(); }
  }
  function wrapFetch() {
    if (!window.fetch || window.fetch._aahlWrapped) return;
    const orig = window.fetch;
    const wrapped = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const track = DATA_HOSTS.test(url) && !/\/health\b/.test(url) && Date.now() - lastInput < 3000;
      if (!track) return orig.apply(this, arguments);
      inFlight++; barStart();
      const p = orig.apply(this, arguments);
      p.then(() => {}, () => {}).then(() => { inFlight = Math.max(0, inFlight - 1); barDone(); });
      return p;
    };
    wrapped._aahlWrapped = true;
    window.fetch = wrapped;
  }

  // ---------------------------------------------------- 4. countdowns
  // "136d 8h" / "2h 13m" / "12m 30s" until a date (null when past).
  function cdText(date) {
    if (!date) return null;
    let sec = Math.floor((date.getTime() - Date.now()) / 1000);
    if (sec <= 0) return null;
    const d = Math.floor(sec / 86400); sec -= d * 86400;
    const h = Math.floor(sec / 3600); sec -= h * 3600;
    const m = Math.floor(sec / 60); const s = sec - m * 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  function milestoneDate() {
    return typeof getNextMilestone_ === 'function' ? (getNextMilestone_() || {}).date || null : null;
  }
  function tradeDate() {
    if (typeof parseMilestoneDate_ !== 'function') return null;
    const c = cfg();
    const fallback = typeof DEFAULT_TRADE_DEADLINE !== 'undefined' ? DEFAULT_TRADE_DEADLINE : null;
    return parseMilestoneDate_(c.tradeDeadline || fallback);
  }
  // Next game tonight that hasn't started, and how many start then.
  function nextPuckDrop() {
    const data = typeof todaysGamesData_ !== 'undefined' ? todaysGamesData_ : null;
    const now = Date.now();
    const upcoming = ((data && data.games) || [])
      .filter(g => g.state === 'pre' && new Date(g.startTimeUTC).getTime() > now)
      .sort((a, b) => String(a.startTimeUTC).localeCompare(String(b.startTimeUTC)));
    if (!upcoming.length) return null;
    const first = upcoming[0].startTimeUTC;
    return { date: new Date(first), count: upcoming.filter(g => g.startTimeUTC === first).length };
  }

  function tickCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach(el => {
      const kind = el.dataset.countdown;
      let text = '';
      if (kind === 'milestone') {
        const t = cdText(milestoneDate());
        text = t ? 'in ' + t : '';
      } else if (kind === 'trade') {
        const t = cdText(tradeDate());
        text = t ? ' · ' + t + ' left' : '';
      } else if (kind === 'puck') {
        const n = nextPuckDrop();
        const t = n && cdText(n.date);
        if (t) {
          const time = n.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          const html = `· Next puck drop <b>${time}</b>${n.count > 1 ? ` (${n.count} games)` : ''} · in <b>${t}</b>`;
          if (el.innerHTML !== html) el.innerHTML = html;
          el.hidden = false;
        } else if (!el.hidden) {
          el.hidden = true;
          el.innerHTML = '';
        }
        return;
      }
      if (el.textContent !== text) el.textContent = text;
    });
  }

  function startCountdowns() {
    tickCountdowns();
    // easytimer.js drives the once-a-second tick; plain setInterval if it
    // didn't load. Times are always worked out from the real clock, so a
    // phone waking up shows the right value straight away.
    if (typeof easytimer !== 'undefined' && easytimer.Timer) {
      const timer = new easytimer.Timer();
      timer.start({ precision: 'seconds' });
      timer.addEventListener('secondsUpdated', tickCountdowns);
    } else {
      setInterval(tickCountdowns, 1000);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tickCountdowns(); });
  }

  // ------------------------------------------------- 5. nightly recap
  async function showRecap() {
    const el = document.getElementById('home-recap');
    if (!el || typeof supabaseDirectGet_ !== 'function') return;
    let r = null;
    try { r = await supabaseDirectGet_('config', 'nightlyRecap'); } catch (e) { r = null; }
    // Only fresh ones (last night or the night before) and not hidden.
    const fresh = r && r.date && (Date.now() - new Date(r.date + 'T12:00:00Z').getTime()) < 2.5 * 86400000;
    if (!r || r.hidden || !r.text || !fresh) { el.hidden = true; return; }
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    el.innerHTML = `<div class="home-recap-head mono">📰 LAST NIGHT IN THE AAHL <span>${esc(r.night || r.date)}</span></div><p>${esc(r.text)}</p>`;
    el.hidden = false;
  }

  // ---------------------------------------------------- 6. what's new
  let changelog_ = null;
  async function loadChangelog() {
    if (changelog_) return changelog_;
    const res = await fetch('CHANGELOG.md', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    changelog_ = parseChangelog(await res.text());
    return changelog_;
  }
  // "## vX.Y — Title" / "_Date_" / "### Sub" / "- bullet" (with **bold**).
  function parseChangelog(md) {
    const out = [];
    let cur = null;
    md.split('\n').forEach(raw => {
      const line = raw.trim();
      let m;
      if ((m = line.match(/^##\s+(v[\d.]+)\s*[—-]\s*(.+)$/))) { cur = { version: m[1], title: m[2], date: '', blocks: [] }; out.push(cur); return; }
      if (!cur) return;
      if ((m = line.match(/^_(.+)_$/))) { cur.date = m[1]; return; }
      if ((m = line.match(/^###\s+(.+)$/))) { cur.blocks.push({ head: m[1], items: [] }); return; }
      if ((m = line.match(/^-\s+(.+)$/))) {
        if (!cur.blocks.length) cur.blocks.push({ head: '', items: [] });
        cur.blocks[cur.blocks.length - 1].items.push(m[1]);
      }
    });
    return out;
  }
  const mdInline = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const SEEN_KEY = 'aahl_seen_version';
  function seenVersion() { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; } }
  function markSeen(v) { try { localStorage.setItem(SEEN_KEY, v); } catch (e) { /* private mode */ } }
  function setNewDots(on) { document.querySelectorAll('.new-dot').forEach(d => { d.hidden = !on; }); }

  async function renderWhatsNew() {
    const el = document.getElementById('whatsnew-content');
    if (!el) return;
    try {
      const list = await loadChangelog();
      el.innerHTML = list.map((r, i) => `
        <article class="wn-release${i === 0 ? ' wn-latest' : ''}">
          <div class="wn-head"><span class="mono wn-ver">${mdInline(r.version)}</span><h3>${mdInline(r.title)}</h3><span class="mono wn-date">${mdInline(r.date)}</span></div>
          ${r.blocks.map(b => `${b.head ? `<h4 class="wn-sub mono">${mdInline(b.head)}</h4>` : ''}<ul>${b.items.map(it => `<li>${mdInline(it)}</li>`).join('')}</ul>`).join('')}
        </article>`).join('');
      if (list[0]) { markSeen(list[0].version); setNewDots(false); }
    } catch (e) {
      el.innerHTML = '<p class="mono" style="color:var(--text-dim)">Couldn\'t load the update list - try again in a moment.</p>';
    }
  }
  window.renderWhatsNew_ = renderWhatsNew;

  async function startWhatsNew() {
    const foot = document.getElementById('footer-version');
    if (foot) foot.addEventListener('click', (e) => {
      e.preventDefault();
      const link = document.querySelector('.nav-link[data-view="whatsnew"]');
      if (link) { link.click(); window.scrollTo(0, 0); }
    });
    try {
      const list = await loadChangelog();
      const latest = list[0] && list[0].version;
      if (!latest) return;
      if (foot) foot.textContent = 'AAHL 26-27 · ' + latest;
      const seen = seenVersion();
      if (!seen) markSeen(latest);          // first visit: nothing is "new" yet
      else if (seen !== latest) setNewDots(true);
    } catch (e) { /* footer just shows "AAHL 26-27" */ }
  }

  function init() {
    if (typeof NProgress !== 'undefined') NProgress.configure({ showSpinner: false, trickleSpeed: 150, minimum: 0.15 });
    wrapFetch();
    startPullToRefresh();
    startCountdowns();
    showRecap();
    startWhatsNew();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
