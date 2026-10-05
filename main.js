/**
 * main.js
 * Core: navigation, init, Home, Standings, team picks popup, IR list,
 * shared utilities. Split files: stats.js, signup.js, admin.js.
 * Load order in index.html: data.js, stats.js, signup.js, admin.js,
 * main.js (this file LAST - it calls init() at the bottom).
 */

let allPlayers = [];
let allStandings = [];
let currentConfig = {};
let poolPlayerIds = new Set();

// Fallback trade deadline if config/season has no tradeDeadline field.
const DEFAULT_TRADE_DEADLINE = '2027-03-01T23:59:00-05:00';

// ---------- Navigation ----------
const VIEW_TITLES = {
  home: 'Home', standings: 'Standings', players: 'Players', lastnight: "Last Night",
  activity: 'Activity', rules: 'Rules', boxes: 'Boxes', ir: 'IR List',
  signup: 'Sign Up', managemoves: 'My Team', admin: 'Commissioner'
};

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const view = link.dataset.view;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`view-${view}`).classList.add('active');
    document.title = `${VIEW_TITLES[view] || 'AAHL'} — AAHL 26/27`;
    if (view !== 'signup') {
      const jumpBtn = document.getElementById('jump-to-missing-btn');
      if (jumpBtn) jumpBtn.remove();
      isAdminCreatingEntry = false;
    }

    if (view === 'home') refreshAndRenderHome();
    if (view === 'standings') refreshAndRenderStandings();
    if (view === 'players') { await ensurePlayersLoaded(); renderPlayersTable(); }
    if (view === 'lastnight') { await ensurePlayersLoaded(); renderLastNightStats(); }
    if (view === 'activity') renderActivityList_();
    if (view === 'rules') renderRulesPage();
    if (view === 'boxes') { await ensurePlayersLoaded(); renderBoxesReference(); }
    if (view === 'ir') renderIRPanel();
    if (view === 'signup') { await Promise.all([ensurePlayersLoaded(), ensureBoxesLoaded_(), ensureLastSeasonStandingsLoaded_()]); renderSignupForm(); }
    if (view === 'managemoves') { await ensurePlayersLoaded(); renderManageMoves(); }
    if (view === 'admin') renderAdminPanel();
  });
});

// ---------- Init ----------
async function init() {
  [allBoxes, allStandings, currentConfig] = await Promise.all([
    fetchBoxes(), fetchStandings(), fetchConfig()
  ]);
  allBoxes.forEach(box => (box.players || []).forEach(p => poolPlayerIds.add(p.playerId)));

  renderHeroMilestone_();
  renderSeasonCountdown_();
  document.getElementById('hero-entries').textContent = currentConfig.totalEntries ?? 0;
  document.getElementById('hero-prizepool').textContent = '$' + (currentConfig.prizePool ?? 0).toFixed(0);
  renderHomeStandingsPreview();
  renderStarsOfNight();
  renderRecentActivity();
  renderStatTicker();
  renderDivisionLeadersPanel();
  applySignupCtaVisibility();
}

function applySignupCtaVisibility() {
  const deadlinePassed = currentConfig.deadline && new Date() >= new Date(currentConfig.deadline);
  const autoLocked = currentConfig.picksLocked || deadlinePassed;
  const manuallyHidden = currentConfig.showSignupCta === false;
  const shouldHide = !!autoLocked || manuallyHidden;

  const btn = document.getElementById('hero-signup-cta');
  if (btn) btn.classList.toggle('hero-cta-hidden', shouldHide);

  // Someone holding a valid late-entry invite keeps the Sign Up tab, so
  // they can get back to the form if they click away before submitting.
  const navLink = document.querySelector('.nav-link[data-view="signup"]');
  if (navLink) navLink.style.display = (shouldHide && !lateInviteToken) ? 'none' : '';
}

/**
 * Hero countdown badges: NHL regular-season games still to be played
 * (league-wide) and days left until the season ends.
 * - Games: total = 32 teams x games per team / 2 (84-game schedule,
 *   override with config gamesPerTeam). Played = sum of every team's
 *   games played / 2, from the nightly current-season standings.
 * - Days: counts down to config seasonEndDate; shows a dash if not set.
 */
async function renderSeasonCountdown_() {
  const gamesEl = document.getElementById('hero-games-left');
  const daysEl = document.getElementById('hero-days-left');

  const endEl = document.getElementById('hero-season-end');
  if (endEl) {
    const lastDay = parseMilestoneDate_((currentConfig || {}).seasonEndDate);
    endEl.textContent = lastDay
      ? 'Ends ' + lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
  }

  if (daysEl) {
    const end = parseMilestoneDate_((currentConfig || {}).seasonEndDate);
    if (end) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const endDay = new Date(end); endDay.setHours(0, 0, 0, 0);
      daysEl.textContent = Math.max(0, Math.round((endDay - today) / 86400000));
    } else {
      daysEl.textContent = '—';
    }
  }

  if (gamesEl) {
    try {
      await ensureCurrentSeasonStandingsLoaded_();
      const teams = Object.values(currentSeasonStandings || {});
      const perTeam = Number((currentConfig || {}).gamesPerTeam) || 84;
      const total = 32 * perTeam / 2;
      const played = teams.reduce((sum, t) => sum + (Number(t.gamesPlayed) || 0), 0) / 2;
      gamesEl.textContent = Math.max(0, Math.round(total - played)).toLocaleString('en-US');
    } catch (e) {
      gamesEl.textContent = '—';
    }
  }
}

function formatDeadlineShort(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Parses a config date. Date-only strings (YYYY-MM-DD) are treated as noon
 * local time so they don't display as the previous day in ET.
 */
function parseMilestoneDate_(value) {
  if (!value) return null;
  const str = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + 'T12:00:00') : new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Returns the next upcoming season milestone:
 * Picks Lock -> Trade Deadline -> Season Ends -> Season Over.
 */
function getNextMilestone_() {
  const c = currentConfig || {};
  const now = new Date();
  const milestones = [
    { label: 'Picks Lock', date: parseMilestoneDate_(c.deadline) },
    { label: 'Trade Deadline', date: parseMilestoneDate_(c.tradeDeadline || DEFAULT_TRADE_DEADLINE) },
    { label: 'Season Ends', date: parseMilestoneDate_(c.seasonEndDate) }
  ].filter(m => m.date);

  const next = milestones.find(m => m.date > now);
  return next || { label: 'Season Over', date: null };
}

/**
 * Fills the hero milestone box (formerly the fixed "Deadline" box) with
 * the next upcoming milestone, and relabels it to match.
 */
function renderHeroMilestone_() {
  const valueEl = document.getElementById('deadline-display');
  if (!valueEl) return;

  const m = getNextMilestone_();
  valueEl.textContent = m.date
    ? m.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';

  // Relabel the box: find the sibling label element that says "Deadline"
  // (or a previously set milestone label) and swap its text.
  const box = valueEl.parentElement;
  if (!box) return;
  let labelEl = document.getElementById('deadline-label');
  if (!labelEl) {
    labelEl = Array.from(box.querySelectorAll('*')).find(n =>
      n !== valueEl && !n.contains(valueEl) && n.children.length === 0 &&
      /deadline|picks lock|season ends|season over/i.test(n.textContent || ''));
    if (labelEl) labelEl.id = 'deadline-label';
  }
  if (labelEl) labelEl.textContent = m.label;
}

/**
 * Games played for a stats object. Current-season stats use gamesPlayed;
 * prior-season stats may use gp. Returns null if neither is present, so
 * callers can hide GP rather than show a misleading 0.
 */
function gamesPlayedOf_(s) {
  if (!s) return null;
  if (s.gamesPlayed != null) return s.gamesPlayed;
  if (s.gp != null) return s.gp;
  return null;
}

/**
 * "12GP " prefix for stat lines, or '' when GP isn't known.
 */
function gpPrefix_(s, sep) {
  const gp = gamesPlayedOf_(s);
  return gp == null ? '' : `${gp}GP${sep == null ? ' ' : sep}`;
}

async function ensurePlayersLoaded() {
  if (allPlayers.length === 0) {
    allPlayers = await fetchPlayers();
  }
}

async function ensureBoxesLoaded_() {
  if (allBoxes.length === 0) {
    allBoxes = await fetchBoxes();
  }
}

async function ensureLastSeasonStandingsLoaded_() {
  if (Object.keys(lastSeasonStandings).length === 0) {
    lastSeasonStandings = await fetchLastSeasonStandings();
  }
}

/**
 * Live current-season standings for every team (points, division rank),
 * used on the Boxes page's Division Winner reference section once the
 * season has real games played - replaces the historical last-season
 * numbers there. Falls back to last-season data automatically wherever
 * a team has no current-season entry yet (e.g. very start of season).
 */
let currentSeasonStandings = {};
async function ensureCurrentSeasonStandingsLoaded_() {
  if (Object.keys(currentSeasonStandings).length === 0) {
    currentSeasonStandings = await fetchCurrentSeasonStandings();
  }
}

let starsOfNightPromise = null;
function getStarsOfNightData() {
  if (!starsOfNightPromise) starsOfNightPromise = fetchStarsOfNight();
  return starsOfNightPromise;
}

async function renderStatTicker() {
  const wrap = document.getElementById('stat-ticker');
  const track = document.getElementById('stat-ticker-track');

  try {
    const stars = await getStarsOfNightData();
    const performers = (stars && stars.allPerformers || []).filter(p => poolPlayerIds.has(p.playerId) && p.pts > 0);

    if (!stars || performers.length === 0) {
      wrap.style.display = 'none';
      return;
    }

    const chips = performers.map(p => {
      const statLine = p.isGoalie
        ? `${p.decision === 'W' ? 'W' : p.decision === 'L' ? 'L' : 'OTL'}${p.shutout ? ' SO' : ''} ${p.saves}SV`
        : `${p.goals}G ${p.assists}A`;
      return `<span class="ticker-chip"><span class="ticker-name">${escapeHtml(p.fullName)}</span> (${escapeHtml(p.team)}) <span class="ticker-stats">${statLine}</span> <span class="ticker-pts">+${p.pts}pts</span></span>`;
    });

    // Duplicate the chip list so the marquee loops seamlessly.
    track.innerHTML = chips.concat(chips).join('<span class="ticker-chip">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>');
    wrap.style.display = 'block';
  } catch (e) {
    wrap.style.display = 'none';
  }
}

async function renderStarsOfNight() {
  const el = document.getElementById('stars-of-night');
  el.innerHTML = `${skeletonLoader_()}`;

  try {
    const stars = await getStarsOfNightData();
    const performers = (stars && stars.topPerformers || []).filter(p => poolPlayerIds.has(p.playerId)).slice(0, 3);

    if (!stars || performers.length === 0) {
      el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">No games played yet.</p>`;
      return;
    }

    const starLabels = ['1ST STAR', '2ND STAR', '3RD STAR'];
    const dateFormatted = new Date(stars.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    el.innerHTML = `
      <div class="stars-cards-row">
        ${performers.map((p, i) => {
          const headshot = p.headshotUrl || '';
          const posLabel = p.isGoalie ? 'G' : (p.position || '');
          const chips = p.isGoalie
            ? [`${p.decision === 'W' ? '1W' : p.decision === 'L' ? '1L' : '1OTL'}`, p.shutout ? 'SO' : null, `${p.saves}SV`].filter(Boolean)
            : [p.goals ? `${p.goals}G` : null, p.assists ? `${p.assists}A` : null, p.sog ? `${p.sog}SOG` : null].filter(Boolean);
          return `
          <div class="star-card">
            <div class="star-badge">${starLabels[i]}</div>
            <div class="star-card-body">
              ${headshot ? `<img class="star-photo" src="${headshot}" alt="">` : `<div class="star-photo star-photo-empty"></div>`}
              <div class="star-info">
                <div class="star-player-name">${escapeHtml(p.fullName)}</div>
                <div class="mono star-player-meta">${escapeHtml(p.team)} · ${escapeHtml(posLabel)}</div>
                <div class="star-chips">${chips.map(c => `<span class="stat-chip">${escapeHtml(c)}</span>`).join('')}</div>
              </div>
              <div class="star-pts-wrap">
                <span class="star-pts">+${p.pts.toFixed(2)}</span>
                <span class="mono star-pts-label">pts</span>
              </div>
            </div>
          </div>
        `;}).join('')}
        <div class="star-date mono">${escapeHtml(dateFormatted)}</div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">No games played yet.</p>`;
  }
}

let allActivity = [];
let activityTypeFilter = 'all';
let activityTeamFilter = 'all';

async function renderRecentActivity() {
  try {
    allActivity = await fetchRecentActivity();
    activityTypeFilter = 'all';
    activityTeamFilter = 'all';
    renderHomeActivityTeaser_();
    renderActivityList_();
  } catch (e) {
    const teaserEl = document.getElementById('home-activity-teaser');
    if (teaserEl) teaserEl.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">No activity yet.</p>`;
  }
}

function renderHomeActivityTeaser_() {
  const el = document.getElementById('home-activity-teaser');
  if (!el) return;

  if (allActivity.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">No activity yet.</p>`;
    return;
  }

  const typeIcons = { join: '🆕', move: '🔄' };
  el.innerHTML = allActivity.slice(0, 3).map(a => `
    <div class="activity-row">
      <span>${typeIcons[a.type] || '•'} ${escapeHtml(a.description)}</span>
      <span class="mono" style="color:var(--text-dim); font-size:12px;">${escapeHtml((a.date || '').slice(0,10))}</span>
    </div>
  `).join('');
}

function renderActivityList_() {
  const el = document.getElementById('recent-activity');
  if (!el) return;

  if (allActivity.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">No activity yet.</p>`;
    return;
  }

  const teamNames = [...new Set(allActivity.map(a => a.teamName))].sort();
  const typeIcons = { join: '🆕', move: '🔄' };

  let filtered = allActivity;
  if (activityTypeFilter !== 'all') filtered = filtered.filter(a => a.type === activityTypeFilter);
  if (activityTeamFilter !== 'all') filtered = filtered.filter(a => a.teamName === activityTeamFilter);

  el.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
      <select id="activity-type-filter" style="max-width:160px; margin:0;">
        <option value="all">All Activity</option>
        <option value="join">Joins Only</option>
        <option value="move">Moves Only</option>
      </select>
      <select id="activity-team-filter" style="max-width:180px; margin:0;">
        <option value="all">All Teams</option>
        ${teamNames.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
      </select>
    </div>
    <div style="max-height:420px; overflow-y:auto;">
      ${filtered.length === 0
        ? `<p class="mono" style="color:var(--text-dim); font-size:13px;">No matching activity.</p>`
        : filtered.map(a => `
          <div class="activity-row">
            <span>${typeIcons[a.type] || '•'} ${escapeHtml(a.description)}</span>
            <span class="mono" style="color:var(--text-dim); font-size:12px;">${escapeHtml((a.date || '').slice(0,10))}</span>
          </div>
        `).join('')}
    </div>
  `;

  document.getElementById('activity-type-filter').value = activityTypeFilter;
  document.getElementById('activity-team-filter').value = activityTeamFilter;

  document.getElementById('activity-type-filter').addEventListener('change', (e) => {
    activityTypeFilter = e.target.value;
    renderActivityList_();
  });
  document.getElementById('activity-team-filter').addEventListener('change', (e) => {
    activityTeamFilter = e.target.value;
    renderActivityList_();
  });
}

async function refreshAndRenderHome() {
  starsOfNightPromise = null;
  [allStandings, currentConfig] = await Promise.all([fetchStandings(), fetchConfig()]);
  renderHeroMilestone_();
  renderSeasonCountdown_();
  document.getElementById('hero-entries').textContent = currentConfig.totalEntries ?? 0;
  document.getElementById('hero-prizepool').textContent = '$' + (currentConfig.prizePool ?? 0).toFixed(0);
  renderHomeStandingsPreview();
  renderStarsOfNight();
  renderRecentActivity();
  renderDivisionLeadersPanel();
  applySignupCtaVisibility();
}

async function renderDivisionLeadersPanel(preloadedLeaders) {
  const el = document.getElementById('division-leaders-panel');
  el.innerHTML = `${skeletonLoader_()}`;

  try {
    const leaders = preloadedLeaders !== undefined ? preloadedLeaders : await fetchDivisionLeadersDisplay();
    if (!leaders || leaders.length === 0) {
      el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Not available yet — check back once the season is underway.</p>`;
      return;
    }

    el.innerHTML = leaders.map(d => `
      <div class="division-leader-row">
        <div class="division-leader-info">
          <div class="mono division-leader-name-label">${escapeHtml(d.division)}</div>
          <div class="division-leader-team">
            ${d.teamAbbrev ? `<img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${d.teamAbbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            ${escapeHtml(d.teamName)}
          </div>
          <div class="mono division-leader-record">${d.points}pts · ${d.gamesPlayed}GP</div>
        </div>
        <div class="division-leader-earning">
          <span class="division-leader-count">${d.earningCount}</span>
          <span class="mono division-leader-count-label">of ${d.totalEntries} picked</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Not available yet — check back once the season is underway.</p>`;
  }
}

// ---------- Home ----------
function totalPot() {
  const c = currentConfig;
  return (c.totalEntries ?? 0) * (c.entryFee ?? 10);
}

function payoutForRank(rank) {
  if (rank == null || rank > 3) return null;
  const pot = totalPot();
  if (pot < 1000) {
    if (rank === 1) return pot * 0.40;
    if (rank === 2) return pot * 0.10;
    return null; // no 3rd place payout under the $1000 tier
  }
  if (rank === 1) return pot * 0.30;
  if (rank === 2) return pot * 0.15;
  if (rank === 3) return pot * 0.05;
  return null;
}

function payoutHtml(rank, isLastPlace) {
  const amount = payoutForRank(rank);
  if (amount != null) {
    return `<span class="mono" style="color:var(--amber); font-weight:700;">$${amount.toFixed(2)}</span>`;
  }
  if (isLastPlace) {
    return `<span class="mono" style="color:var(--ice); font-size:11px;">🎟️ Free entry</span>`;
  }
  return '<span class="mono" style="color:var(--text-dim)">—</span>';
}

function rankMovementHtml(e) {
  if (e.rankChange == null) return '<span class="mono" style="color:var(--text-dim)">—</span>';
  if (e.rankChange > 0) return `<span class="mono" style="color:#3ecf6a">▲${e.rankChange}</span>`;
  if (e.rankChange < 0) return `<span class="mono" style="color:#ff5c5c">▼${Math.abs(e.rankChange)}</span>`;
  return '<span class="mono" style="color:var(--text-dim)">—</span>';
}

function ptsDeltaHtml(e) {
  if (e.ptsDelta == null) return '<span class="mono" style="color:var(--text-dim)">—</span>';
  const sign = e.ptsDelta > 0 ? '+' : '';
  const color = e.ptsDelta > 0 ? '#3ecf6a' : (e.ptsDelta < 0 ? '#ff5c5c' : 'var(--text-dim)');
  return `<span class="mono" style="color:${color}">${sign}${e.ptsDelta.toFixed(2)}</span>`;
}

function renderHomeStandingsPreview() {
  const sorted = [...allStandings].sort((a, b) => {
    if (a.rank == null && b.rank == null) return 0;
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return a.rank - b.rank;
  });
  const el = document.getElementById('home-standings-preview');
  if (sorted.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No entries yet.</p>`;
    return;
  }
  const approvedRanks = sorted.filter(e => e.approved && e.rank != null).map(e => e.rank);
  const lastRank = approvedRanks.length > 0 ? Math.max(...approvedRanks) : null;
  el.innerHTML = `
    <div class="players-table-scroll" style="max-height:50vh;">
      <table>
        <thead><tr><th>Rank</th><th>Team</th><th>Pts</th><th>±Pts</th><th>Move</th><th>Payout</th></tr></thead>
        <tbody>
          ${sorted.map(e => `
            <tr>
              <td class="${e.rank === 1 ? 'rank-1' : ''}">${e.rank ?? '—'}</td>
              <td><span class="team-link" data-entry-id="${e.entryId}">${escapeHtml(e.teamName)}</span></td>
              <td class="pts">${e.pts.toFixed(2)}</td>
              <td>${ptsDeltaHtml(e)}</td>
              <td>${rankMovementHtml(e)}</td>
              <td>${payoutHtml(e.rank, lastRank != null && e.rank === lastRank)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  attachTeamLinkListeners(el);
}

// ---------- Standings ----------
async function refreshAndRenderStandings() {
  allStandings = await fetchStandings();
  renderStandingsTable();
}

function renderStandingsTable() {
  const el = document.getElementById('standings-table');
  const sorted = [...allStandings].sort((a, b) => {
    if (a.rank == null && b.rank == null) return 0;
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return a.rank - b.rank;
  });
  if (sorted.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No entries yet.</p>`;
    return;
  }
  const approvedRanks = sorted.filter(e => e.approved && e.rank != null).map(e => e.rank);
  const lastRank = approvedRanks.length > 0 ? Math.max(...approvedRanks) : null;
  el.innerHTML = `
    <table>
      <thead><tr><th>Rank</th><th>Team</th><th>Points</th><th>±Pts (24h)</th><th>Move</th><th>Payout</th></tr></thead>
      <tbody>
        ${sorted.map(e => `
          <tr>
            <td class="${e.rank === 1 ? 'rank-1' : ''}">${e.rank ?? '—'}</td>
            <td><span class="team-link" data-entry-id="${e.entryId}">${escapeHtml(e.teamName)}</span></td>
            <td class="pts">${e.pts.toFixed(2)}</td>
            <td>${ptsDeltaHtml(e)}</td>
            <td>${rankMovementHtml(e)}</td>
            <td>${payoutHtml(e.rank, lastRank != null && e.rank === lastRank)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  attachTeamLinkListeners(el);
}

function renderPicksModalBody_(data, ownerLine) {
  const grouped = { F: [], D: [], G: [] };
  (data.picks || []).forEach(p => grouped[p.boxType || 'F'].push(p));

  const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };
  const divisionRows = Object.entries(data.divisionPicks || {})
    .map(([div, team]) => `<div class="activity-row"><span>${escapeHtml(div)}</span><span class="mono" style="display:flex; align-items:center; gap:6px; justify-content:flex-end;"><img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${team}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">${escapeHtml(team)}</span></div>`)
    .join('');

  return `
    <h2 style="margin-bottom:4px;">${escapeHtml(data.teamName)}</h2>
    ${ownerLine ? `<p style="color:var(--text-dim); font-size:13px; margin-bottom:8px;">${ownerLine}</p>` : ''}
    ${data.pointBank ? `<p class="mono" style="color:var(--amber); font-size:13px; margin-bottom:12px;">Banked from moves: +${data.pointBank.toFixed(2)}pts</p>` : ''}
    ${Object.keys(groupTitles).map(type => {
      // Group total = every pick's points since acquired + points banked
      // from any players traded out of these boxes, so F + D + G always
      // adds up to the team's total on Standings.
      const groupTotal = grouped[type].reduce((sum, p) => {
        const banked = (p.moves || []).reduce((b, m) => b + (m.bankedAmount || 0), 0);
        return sum + (p.contributionSinceAcquired || 0) + banked;
      }, 0);
      return `
      <h3 class="group-title">${groupTitles[type]} <span class="mono" style="color:var(--ice); font-size:14px; font-weight:400; text-transform:none; letter-spacing:0; margin-left:8px;">${groupTotal.toFixed(2)} pts</span></h3>
      <div class="modal-pick-list">
        ${grouped[type].map(p => {
          const s = allPlayers.find(ap => ap.id === p.playerId);
          const stats = (s && s.stats) || {};
          const gp = `${gamesPlayedOf_(stats) || 0}GP &middot; `;
          const statLine = p.boxType === 'G'
            ? `${gp}${stats.wins || 0}W ${stats.losses || 0}L ${stats.otl || 0}OTL &middot; ${stats.shutouts || 0}SO &middot; ${stats.saves || 0}SV`
            : `${gp}${stats.goals || 0}G ${stats.assists || 0}A ${stats.sog || 0}SOG${p.boxType === 'D' ? ` ${stats.pim || 0}PIM` : ''}${stats.hatTricks ? ` &middot; ${stats.hatTricks}HT` : ''}`;
          const hasMoves = p.moves && p.moves.length > 0;
          return `
          <div class="modal-pick-wrap">
            ${hasMoves ? p.moves.map(m => `
              <div class="move-history-line mono">
                🔁 ${escapeHtml(m.outPlayerName)} banked +${m.bankedAmount.toFixed(2)}pts <span style="color:var(--text-dim);">(${escapeHtml((m.resolvedAt || m.requestedAt || '').slice(0,10))})</span>
              </div>
            `).join('') : ''}
            <div class="modal-pick-row">
              ${p.headshotUrl ? `<img class="modal-pick-photo" src="${p.headshotUrl}" alt="">` : `<div class="modal-pick-photo modal-pick-photo-empty"></div>`}
              <span class="modal-pick-name">${escapeHtml(p.playerName)}</span>
              <span class="mono modal-pick-stats">${statLine}</span>
              <span class="mono modal-pick-pts">${hasMoves ? `+${p.contributionSinceAcquired.toFixed(2)}pts since acquired` : `${p.contributionSinceAcquired.toFixed(2)}pts`}</span>
              <span class="mono modal-pick-meta">${escapeHtml(p.team)}</span>
            </div>
          </div>
        `;}).join('')}
      </div>
    `;}).join('')}
    <h3 class="group-title">Division Picks</h3>
    <div class="panel">${divisionRows || '<span class="mono" style="color:var(--text-dim)">None</span>'}</div>
  `;
}

async function openAdminPicksModal(entryId) {
  const modal = document.getElementById('team-picks-modal');
  const body = document.getElementById('team-picks-body');
  modal.style.display = 'flex';
  body.innerHTML = `${skeletonLoader_()}`;
  await ensurePlayersLoaded();

  const entry = adminEntriesCache.find(e => e.id === entryId);
  const result = await adminGetEntryPicks(adminPassword, entryId);
  if (!result.success) {
    body.innerHTML = `<p class="mono" style="color:var(--text-dim)">${escapeHtml(result.error || "Couldn't load picks.")}</p>`;
    return;
  }

  const ownerLine = entry ? `${escapeHtml(entry.ownerName)} · ${escapeHtml(entry.email)}` : '';
  body.innerHTML = renderPicksModalBody_(result.data, ownerLine);
}

async function startEditingEntry(entry) {
  editingEntryId = entry.id;
  signupPicks = Object.assign({}, entry.picks || {});
  divisionPicks = Object.assign({}, entry.divisionPicks || {});
  signupFields = { teamName: entry.teamName, ownerName: entry.ownerName, email: entry.email };

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-signup').classList.add('active');

  await ensurePlayersLoaded();
  renderSignupFormBody();
}

function attachTeamLinkListeners(container) {
  container.querySelectorAll('.team-link').forEach(el => {
    el.addEventListener('click', () => openTeamPicksModal(el.dataset.entryId, el.textContent));
  });
}

// ---------- Team Picks Modal ----------
async function openTeamPicksModal(entryId, teamName) {
  const modal = document.getElementById('team-picks-modal');
  const body = document.getElementById('team-picks-body');
  modal.style.display = 'flex';
  body.innerHTML = `${skeletonLoader_()}`;

  const data = await fetchEntryPicks(entryId);
  if (!data || data.error) {
    body.innerHTML = `<p class="mono" style="color:var(--text-dim)">${escapeHtml((data && data.error) || "Couldn't load picks.")}</p>`;
    return;
  }
  await ensurePlayersLoaded();

  body.innerHTML = renderPicksModalBody_(data, '');
}

const teamPicksCloseBtn = document.getElementById('team-picks-close');
const teamPicksModalEl = document.getElementById('team-picks-modal');
if (teamPicksCloseBtn && teamPicksModalEl) {
  teamPicksCloseBtn.addEventListener('click', () => {
    teamPicksModalEl.style.display = 'none';
  });
  teamPicksModalEl.addEventListener('click', (e) => {
    if (e.target.id === 'team-picks-modal') e.target.style.display = 'none';
  });
}


// ---------- IR List (public) ----------
async function renderIRPanel() {
  const el = document.getElementById('ir-panel');
  el.innerHTML = `${skeletonLoader_()}`;
  const irList = await fetchIRList();

  if (irList.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No players currently on IR.</p>`;
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr><th>Player</th><th>Note</th><th>Flagged</th></tr></thead>
      <tbody>
        ${irList.map(p => `<tr><td>${escapeHtml(p.id)}</td><td>${escapeHtml(p.note || '')}</td><td class="mono">${escapeHtml((p.flaggedAt || '').slice(0,10))}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}


// ---------- Utility ----------
/**
 * A few pulsing gray bars instead of a plain "Loading..." line - easier to
 * notice at a glance, especially on a slow connection where "Loading..."
 * text can blend into everything else on the page.
 */
function skeletonLoader_(count) {
  count = count || 3;
  const widths = ['92%', '68%', '84%', '76%', '90%'];
  const bars = Array.from({ length: count }, (_, i) => `<div class="skeleton-bar" style="width:${widths[i % widths.length]}"></div>`).join('');
  return `<div class="skeleton-wrap">${bars}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/**
 * Late-entry invite link (?late=TOKEN): checks the link with the server,
 * then opens the Sign Up form even though picks are locked. If the link
 * is expired, already used or invalid, shows a clear message instead.
 */
async function handleLateInviteLink_(token) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const viewEl = document.getElementById('view-signup');
  if (viewEl) viewEl.classList.add('active');
  document.title = 'Sign Up — AAHL 26/27';

  const formEl = document.getElementById('signup-form');
  formEl.innerHTML = `<p class="mono" style="color:var(--text-dim)">Checking your invite link...</p>`;

  const check = await checkLateInvite(token);
  if (!check || !check.success) {
    formEl.innerHTML = `
      <div class="panel" style="text-align:center; padding:32px;">
        <h2 style="color:var(--amber); margin-bottom:12px;">Invite Link Not Valid</h2>
        <p style="color:var(--text-dim); font-size:14px;">${escapeHtml((check && check.error) || 'This late-entry link could not be verified.')}</p>
        <p style="color:var(--text-dim); font-size:13px; margin-top:12px;">Contact the commissioner for a new link.</p>
      </div>
    `;
    return;
  }

  lateInviteToken = token;
  applySignupCtaVisibility();
  const signupLink = document.querySelector('.nav-link[data-view="signup"]');
  if (signupLink) signupLink.classList.add('active');

  await Promise.all([ensurePlayersLoaded(), ensureBoxesLoaded_(), ensureLastSeasonStandingsLoaded_()]);
  renderSignupForm();
}

async function handleDeepLink_() {
  const params = new URLSearchParams(window.location.search);

  const lateToken = params.get('late');
  if (lateToken) {
    await handleLateInviteLink_(lateToken);
    return;
  }

  const entryId = params.get('entryId');
  const email = params.get('email');
  if (!entryId || !email) return;

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const myTeamLink = document.querySelector('.nav-link[data-view="managemoves"]');
  if (myTeamLink) myTeamLink.classList.add('active');
  const viewEl = document.getElementById('view-managemoves');
  if (viewEl) viewEl.classList.add('active');

  await ensurePlayersLoaded();
  renderManageMoves();

  const idInput = document.getElementById('moves-entryid-input');
  const emailInput = document.getElementById('moves-email-input');
  if (idInput && emailInput) {
    idInput.value = entryId;
    emailInput.value = email;
    document.getElementById('moves-lookup-btn').click();
  }
}

init();
handleDeepLink_();
