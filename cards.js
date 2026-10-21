/**
 * cards.js
 *
 * Player cards: mini cards (team popup pick grid) and the full player
 * card popup opened by tapping a mini card or any player cell
 * (.dt-player[data-player-id]) anywhere on the site.
 *
 * Plain script, shared global scope. Load order in index.html:
 * data.js, stats.js, signup.js, admin.js, cards.js, main.js.
 * Uses globals from main.js at call time: allPlayers, currentConfig,
 * escapeHtml, statusBadge_, tonightTagHtml_, ensurePlayersLoaded.
 */

// Team tint colours: each team's main colour, brightened where the
// official one is too dark to show on a black card (TOR navy, LAK black).
const TEAM_TINT_ = {
  ANA: '#F47A38', BOS: '#FFB81C', BUF: '#2C5CB8', CGY: '#C8102E', CAR: '#CE1126', CHI: '#CF0A2C',
  COL: '#8A2D4E', CBJ: '#2A5AA8', DAL: '#008C5A', DET: '#CE1126', EDM: '#FF4C00', FLA: '#C8102E',
  LAK: '#A2AAAD', MIN: '#2E7D4F', MTL: '#AF1E2D', NSH: '#FFB81C', NJD: '#CE1126', NYI: '#1B6FC1',
  NYR: '#1E55C8', OTT: '#DA1A32', PHI: '#F74902', PIT: '#FCB514', SJS: '#00A0AB', SEA: '#68A2B9',
  STL: '#2A5DC1', TBL: '#2D62C2', TOR: '#2B5BB5', UTA: '#6CACE4', VAN: '#1F6FBF', VGK: '#B4975A',
  WSH: '#C8102E', WPG: '#2E6DB4'
};
/** Attributes that tint a card in its team's colour (see style.css). */
const cardTeamAttr_ = t => (t && TEAM_TINT_[t]) ? ` data-team="${t}" style="--tc:${TEAM_TINT_[t]}"` : '';

const CARD_LOGO_ = t => t ? `https://assets.nhle.com/logos/nhl/svg/${t}_light.svg` : '';
const cardF2_ = n => (Number(n) || 0).toFixed(2);
const cardPlayer_ = id => ((typeof allPlayers !== 'undefined' && allPlayers) || []).find(p => String(p.id) === String(id)) || {};
const cardIsG_ = p => p.isGoalie || p.position === 'G';
const cardType_ = (p, x) => (x && x.boxType) || (cardIsG_(p) ? 'G' : (p.position === 'D' ? 'D' : 'F'));
const cardGp_ = s => (s && (s.gamesPlayed ?? s.games)) || 0;

function cardCfg_(k, d) {
  const c = (typeof currentConfig !== 'undefined' && currentConfig) || {};
  return c[k] != null ? Number(c[k]) : d;
}

// Season pool points from raw stats, using the pool's scoring config.
function cardSeasonPts_(s, type, player) {
  if (player && typeof computePlayerPoints === 'function') {
    try { return computePlayerPoints(player, (typeof currentConfig !== 'undefined' && currentConfig) || {}); } catch (e) { /* fall through */ }
  }
  s = s || {};
  if (type === 'G') {
    return (s.wins || 0) * cardCfg_('winPtsG', 3) + (s.otl || 0) * cardCfg_('otlPtsG', 1.5)
      + (s.losses || 0) * cardCfg_('lossPtsG', 1) + (s.shutouts || 0) * cardCfg_('shutoutPtsG', 2)
      + (s.saves || 0) * cardCfg_('savePtsG', 0.02);
  }
  return (s.goals || 0) * cardCfg_('goalPtsF', 1) + (s.assists || 0) * cardCfg_('assistPtsF', 1)
    + (s.sog || 0) * cardCfg_('sogPtsF', 0.11) + (s.hatTricks || 0) * cardCfg_('hatTrickBonus', 3)
    + (type === 'D' ? (s.pim || 0) * cardCfg_('pimPtsD', 0.25) : 0);
}

function cardStatList_(s, type) {
  s = s || {};
  if (type === 'G') return [[cardGp_(s), 'GP'], [s.wins || 0, 'W'], [s.losses || 0, 'L'], [s.otl || 0, 'OTL'], [s.shutouts || 0, 'SO'], [s.saves || 0, 'SV']];
  const a = [[cardGp_(s), 'GP'], [s.goals || 0, 'G'], [s.assists || 0, 'A'], [s.sog || 0, 'SOG'], [s.hatTricks || 0, 'HT', 'ht']];
  if (type === 'D') a.push([s.pim || 0, 'PIM']);
  return a;
}

function cardSplitName_(n) {
  const parts = String(n || '').trim().split(' ');
  return parts.length > 1 ? [parts.shift(), parts.join(' ')] : ['', parts[0] || ''];
}

// Pick objects attached to mini cards, so the full card can show
// box / since-acquired / trade info. Keyed by a running id.
const cardPickStore_ = {};
let cardPickSeq_ = 0;

/** Mini card for one pick (team popup grid). */
function miniPickCardHtml_(pk) {
  const p = cardPlayer_(pk.playerId);
  const team = pk.team || p.team || '';
  const hs = pk.headshotUrl || p.headshotUrl || '';
  const key = 'c' + (++cardPickSeq_);
  cardPickStore_[key] = pk;
  const moved = pk.moves && pk.moves.length;
  const badge = typeof statusBadge_ === 'function' ? statusBadge_(pk.playerId) : '';
  const tonight = typeof tonightTagHtml_ === 'function' ? tonightTagHtml_(pk.playerId, team) : '';
  return `<div class="aahl-mc" data-player-id="${escapeHtml(pk.playerId)}" data-pick-key="${key}" role="button" tabindex="0"${cardTeamAttr_(team)}>
    ${team ? `<img class="aahl-mc-wm" src="${CARD_LOGO_(team)}" alt="" width="78" height="78" onerror="this.remove()">` : ''}
    ${hs ? `<img class="aahl-mc-hs" src="${escapeHtml(hs)}" alt="" width="52" height="52" loading="lazy">` : `<div class="aahl-mc-hs"></div>`}
    ${moved ? `<div class="aahl-mc-tr" title="Traded in">⇄</div>` : ''}
    <div class="aahl-mc-n" title="${escapeHtml(pk.playerName || p.fullName || '')}">${escapeHtml(cardSplitName_(pk.playerName || p.fullName)[1])}</div>
    <div class="aahl-mc-m">${escapeHtml(team)} · ${escapeHtml(pk.boxType || p.position || '')}${badge}${tonight}</div>
    ${pk.boxId ? `<div class="aahl-mc-bx">#${escapeHtml(pk.boxId)}</div>` : ''}
    <div class="aahl-mc-p">${moved ? '+' : ''}${cardF2_(pk.contributionSinceAcquired)}</div>
  </div>`;
}

function ensureCardOverlay_() {
  let ov = document.getElementById('aahl-card-ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'aahl-card-ov';
    ov.className = 'aahl-card-ov';
    ov.addEventListener('click', e => { if (e.target === ov) closePlayerCard(); });
    document.body.appendChild(ov);
  }
  return ov;
}

/** Full player card popup. extra = pick object (optional). */
async function openPlayerCard(playerId, extra) {
  if (typeof ensurePlayersLoaded === 'function' && !cardPlayer_(playerId).id) {
    try { await ensurePlayersLoaded(); } catch (e) { /* show what we have */ }
  }
  const p = cardPlayer_(playerId);
  const x = extra || {};
  const name = p.fullName || x.playerName || '';
  if (!name) return;
  const team = p.team || x.team || '';
  const s = p.stats || {};
  const type = cardType_(p, x);
  const [first, last] = cardSplitName_(name);
  const hs = p.headshotUrl || x.headshotUrl || '';
  const num = p.sweaterNumber || p.number || '';
  const stats = cardStatList_(s, type);
  const moved = x.moves && x.moves.length;
  const season = cardF2_(cardSeasonPts_(s, type, p.id ? p : null));
  const forTeamRaw = x.contributionSinceAcquired != null ? cardF2_(x.contributionSinceAcquired) : null;
  // Only show the second number when it tells you something new.
  const forTeam = forTeamRaw != null && (moved || forTeamRaw !== season) ? forTeamRaw : null;
  const badge = typeof statusBadge_ === 'function' ? statusBadge_(playerId) : '';

  const ov = ensureCardOverlay_();
  ov.innerHTML = `
    <div class="aahl-fc" role="dialog" aria-label="${escapeHtml(name)}"${cardTeamAttr_(team)}>
      ${team ? `<img class="aahl-fc-wm" src="${CARD_LOGO_(team)}" alt="" onerror="this.remove()">` : ''}
      <button class="aahl-fc-x" aria-label="Close">×</button>
      <div class="aahl-fc-top">
        <div class="aahl-fc-info">
          <div class="aahl-fc-nm">${escapeHtml(first)}<br>${escapeHtml(last)}</div>
          <div class="aahl-fc-meta">${team ? `<img src="${CARD_LOGO_(team)}" alt="" onerror="this.remove()">` : ''}${escapeHtml(team)} · ${escapeHtml(type === 'G' ? 'G' : (p.position || type))}${num ? ' · #' + escapeHtml(num) : ''}</div>
          ${x.boxId ? `<div class="aahl-fc-sub">BOX ${escapeHtml(x.boxId)}</div>` : ''}
          ${badge ? `<div class="aahl-fc-badge">${badge}</div>` : ''}
        </div>
        <div class="aahl-fc-hs">${hs ? `<img src="${escapeHtml(hs)}" alt="" onerror="this.remove()">` : ''}</div>
      </div>
      <div class="aahl-fc-pool">
        <div><small>SEASON POOL PTS</small><br><b>${season}</b></div>
        ${forTeam != null ? `<div class="alt"><small>${moved ? 'SINCE ACQUIRED' : 'FOR THIS TEAM'}</small><br><b>${moved ? '+' : ''}${forTeam}</b></div>` : ''}
      </div>
      <div class="aahl-fc-strip" style="grid-template-columns:repeat(${stats.length},1fr)">
        ${stats.map(t => `<div><b class="${t[2] && t[0] ? t[2] : ''}">${t[0]}</b><small>${t[1]}</small></div>`).join('')}
      </div>
      ${moved ? `<div class="aahl-fc-moves">${x.moves.map(mv => `<div>⇄ Replaced ${escapeHtml(mv.outPlayerName)} · banked +${cardF2_(mv.bankedAmount)}${mv.resolvedAt || mv.requestedAt ? ' · ' + escapeHtml(String(mv.resolvedAt || mv.requestedAt).slice(0, 10)) : ''}</div>`).join('')}</div>` : ''}
    </div>`;
  const xBtn = ov.querySelector('.aahl-fc-x');
  xBtn.addEventListener('click', closePlayerCard);
  ov.classList.add('on');
  document.documentElement.classList.add('aahl-noscroll');
  try { xBtn.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
}

function closePlayerCard() {
  const ov = document.getElementById('aahl-card-ov');
  if (ov) ov.classList.remove('on');
  document.documentElement.classList.remove('aahl-noscroll');
}

// One delegated listener: mini cards and any player cell open the card.
document.addEventListener('click', e => {
  const mc = e.target.closest('.aahl-mc');
  if (mc) { openPlayerCard(mc.dataset.playerId, cardPickStore_[mc.dataset.pickKey]); return; }
  const cell = e.target.closest('.dt-player[data-player-id], .aahl-pc[data-player-id]');
  if (cell && cell.dataset.playerId) openPlayerCard(cell.dataset.playerId);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePlayerCard();
  if (e.key === 'Enter' && e.target.classList && (e.target.classList.contains('aahl-mc') || e.target.classList.contains('aahl-pc'))) e.target.click();
});

// ---------- 3D tilt (VanillaTilt) ----------
// Player cards (Players, Boxes, Last Night) and the full card popup tilt
// toward the mouse with a shine. The popup tilts on mouse devices only —
// on phones it stays flat and centred so it's easy to read.
// A watcher applies it to any card as soon as it's drawn, so pages don't
// need to call anything. Skipped if VanillaTilt didn't load or the
// device is set to reduce motion.
(function () {
  if (typeof VanillaTilt === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const GRID = { max: 12, speed: 400, scale: 1.03, glare: true, 'max-glare': 0.3, gyroscope: false };
  const POPUP = { max: 6, speed: 500, scale: 1, glare: true, 'max-glare': 0.2, gyroscope: false };
  const FINE = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let queued = false;
  function apply() {
    queued = false;
    document.querySelectorAll('.aahl-pc:not([data-tilted])').forEach(el => { el.dataset.tilted = '1'; VanillaTilt.init(el, GRID); });
    if (FINE) document.querySelectorAll('.aahl-fc:not([data-tilted])').forEach(el => { el.dataset.tilted = '1'; el.classList.add('tilt'); VanillaTilt.init(el, POPUP); });
  }
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(apply); } })
    .observe(document.body, { childList: true, subtree: true });
  apply();
})();
