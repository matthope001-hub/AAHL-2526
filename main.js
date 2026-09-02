/**
 * main.js
 * UI rendering, navigation, and interaction logic.
 * Depends on data.js
 */

let allPlayers = [];
let allStandings = [];
let currentConfig = {};
let poolPlayerIds = new Set();

// ---------- Navigation ----------
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const view = link.dataset.view;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`view-${view}`).classList.add('active');

    if (view === 'home') refreshAndRenderHome();
    if (view === 'standings') refreshAndRenderStandings();
    if (view === 'players') { await ensurePlayersLoaded(); renderPlayersTable(); }
    if (view === 'lastnight') { await ensurePlayersLoaded(); renderLastNightStats(); }
    if (view === 'activity') renderActivityList_();
    if (view === 'rules') renderRulesPage();
    if (view === 'boxes') { await ensurePlayersLoaded(); renderBoxesReference(); }
    if (view === 'ir') renderIRPanel();
    if (view === 'signup') { await ensurePlayersLoaded(); renderSignupForm(); }
    if (view === 'managemoves') { await ensurePlayersLoaded(); renderManageMoves(); }
    if (view === 'admin') renderAdminPanel();
  });
});

// ---------- Init ----------
async function init() {
  allBoxes = await fetchBoxes();
  allBoxes.forEach(box => (box.players || []).forEach(p => poolPlayerIds.add(p.playerId)));

  [allStandings, currentConfig] = await Promise.all([
    fetchStandings(), fetchConfig()
  ]);

  document.getElementById('deadline-display').textContent = formatDeadlineShort(currentConfig.deadline);
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
  const btn = document.getElementById('hero-signup-cta');
  if (!btn) return;
  const deadlinePassed = currentConfig.deadline && new Date() >= new Date(currentConfig.deadline);
  const autoLocked = currentConfig.picksLocked || deadlinePassed;
  const manuallyHidden = currentConfig.showSignupCta === false;
  btn.classList.toggle('hero-cta-hidden', !!autoLocked || manuallyHidden);
}

function formatDeadlineShort(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function ensurePlayersLoaded() {
  if (allPlayers.length === 0) {
    allPlayers = await fetchPlayers();
  }
}

async function renderStatTicker() {
  const wrap = document.getElementById('stat-ticker');
  const track = document.getElementById('stat-ticker-track');

  try {
    const stars = await fetchStarsOfNight();
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
  el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Loading...</p>`;

  try {
    const stars = await fetchStarsOfNight();
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
      <select id="activity-type-filter" style="max-width:140px; margin:0;">
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
  [allStandings, currentConfig] = await Promise.all([fetchStandings(), fetchConfig()]);
  document.getElementById('deadline-display').textContent = formatDeadlineShort(currentConfig.deadline);
  document.getElementById('hero-entries').textContent = currentConfig.totalEntries ?? 0;
  document.getElementById('hero-prizepool').textContent = '$' + (currentConfig.prizePool ?? 0).toFixed(0);
  renderHomeStandingsPreview();
  renderStarsOfNight();
  renderRecentActivity();
  renderDivisionLeadersPanel();
  applySignupCtaVisibility();
}

async function renderDivisionLeadersPanel() {
  const el = document.getElementById('division-leaders-panel');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Loading...</p>`;

  try {
    const leaders = await fetchDivisionLeadersDisplay();
    if (!leaders || leaders.length === 0) {
      el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Not available yet.</p>`;
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
          <span class="mono division-leader-count-label">of ${d.totalEntries} earning</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Not available yet.</p>`;
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
    ${Object.keys(groupTitles).map(type => `
      <h3 class="group-title">${groupTitles[type]}</h3>
      <div class="modal-pick-list">
        ${grouped[type].map(p => {
          const s = allPlayers.find(ap => ap.id === p.playerId);
          const stats = (s && s.stats) || {};
          const statLine = p.boxType === 'G'
            ? `${stats.wins || 0}W ${stats.losses || 0}L ${stats.otl || 0}OTL &middot; ${stats.shutouts || 0}SO &middot; ${stats.saves || 0}SV`
            : `${stats.goals || 0}G ${stats.assists || 0}A ${stats.sog || 0}SOG${p.boxType === 'D' ? ` ${stats.pim || 0}PIM` : ''}${stats.hatTricks ? ` &middot; ${stats.hatTricks}HT` : ''}`;
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
    `).join('')}
    <h3 class="group-title">Division Picks</h3>
    <div class="panel">${divisionRows || '<span class="mono" style="color:var(--text-dim)">None</span>'}</div>
  `;
}

async function openAdminPicksModal(entryId) {
  const modal = document.getElementById('team-picks-modal');
  const body = document.getElementById('team-picks-body');
  modal.style.display = 'flex';
  body.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading...</p>`;
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
  body.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading...</p>`;

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

// ---------- Players ----------
let playerFilter = 'all';
let playerSort = { column: 'pts', dir: 'desc' };

const PLAYER_COLUMNS = [
  { key: 'name', label: 'Player', title: 'Player Name', sortable: false, filters: ['all', 'F', 'D', 'G'] },
  { key: 'team', label: 'NHL', title: 'NHL Team', sortable: false, filters: ['all', 'F', 'D', 'G'] },
  { key: 'position', label: 'Pos', title: 'Position', sortable: false, filters: ['all', 'F', 'D', 'G'] },
  { key: 'goals', label: 'G', title: 'Goals', sortable: true, filters: ['all', 'F', 'D'] },
  { key: 'assists', label: 'A', title: 'Assists', sortable: true, filters: ['all', 'F', 'D'] },
  { key: 'sog', label: 'SOG', title: 'Shots on Goal', sortable: true, filters: ['all', 'F', 'D'] },
  { key: 'pim', label: 'PIM', title: 'Penalty Minutes', sortable: true, filters: ['all', 'D'] },
  { key: 'wins', label: 'W', title: 'Wins', sortable: true, filters: ['all', 'G'] },
  { key: 'losses', label: 'L', title: 'Losses', sortable: true, filters: ['all', 'G'] },
  { key: 'otl', label: 'OTL', title: 'Overtime Losses', sortable: true, filters: ['all', 'G'] },
  { key: 'shutouts', label: 'SO', title: 'Shutouts', sortable: true, filters: ['all', 'G'] },
  { key: 'saves', label: 'SV', title: 'Saves', sortable: true, filters: ['all', 'G'] },
  { key: 'hatTricks', label: '🎩', title: 'Hat Tricks', sortable: true, filters: ['all', 'F', 'D'] },
  { key: 'pts', label: 'Pts', title: 'Fantasy Points', sortable: true, filters: ['all', 'F', 'D', 'G'] }
];

function playerColumnValue(p, key) {
  if (key === 'pts') return computePlayerPoints(p, currentConfig);
  const s = p.stats || {};
  return s[key] || 0;
}

document.querySelectorAll('.filter-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    playerFilter = btn.dataset.filter;
    renderPlayersTable(document.getElementById('player-search').value);
  });
});

function renderPlayersTable(searchQuery) {
  const el = document.getElementById('players-table');
  let list = allPlayers.filter(p => poolPlayerIds.has(p.id));

  if (playerFilter !== 'all') {
    const posGroups = { F: ['C', 'L', 'R'], D: ['D'], G: ['G'] };
    list = list.filter(p => posGroups[playerFilter].includes(p.position));
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p => (p.fullName || '').toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q));
  }

  const visibleColumns = PLAYER_COLUMNS.filter(col => col.filters.includes(playerFilter));

  // If sorting by a column that's no longer visible after switching filters
  // (e.g. was sorting by Saves, then switched to Forwards), fall back to Pts.
  if (!visibleColumns.some(c => c.key === playerSort.column)) {
    playerSort = { column: 'pts', dir: 'desc' };
  }

  list.sort((a, b) => {
    const diff = playerColumnValue(b, playerSort.column) - playerColumnValue(a, playerSort.column);
    return playerSort.dir === 'asc' ? -diff : diff;
  });

  const cellRenderers = {
    name: (p) => `${escapeHtml(p.fullName)}${p.injuryStatus ? ` <span class="ir-badge" title="Injured: ${escapeHtml(p.injuryStatus)}">🩹 ${escapeHtml(p.injuryStatus)}</span>` : ''}`,
    team: (p) => escapeHtml(p.team || ''),
    position: (p) => escapeHtml(p.position || ''),
    goals: (p) => (p.stats && p.stats.goals) || 0,
    assists: (p) => (p.stats && p.stats.assists) || 0,
    sog: (p) => (p.stats && p.stats.sog) || 0,
    pim: (p) => (p.stats && p.stats.pim) || 0,
    wins: (p) => (p.stats && p.stats.wins) || 0,
    losses: (p) => (p.stats && p.stats.losses) || 0,
    otl: (p) => (p.stats && p.stats.otl) || 0,
    shutouts: (p) => (p.stats && p.stats.shutouts) || 0,
    saves: (p) => (p.stats && p.stats.saves) || 0,
    hatTricks: (p) => (p.stats && p.stats.hatTricks) ? `<span class="hat-trick">${p.stats.hatTricks}</span>` : '—',
    pts: (p) => `<span class="pts">${computePlayerPoints(p, currentConfig).toFixed(2)}</span>`
  };

  el.innerHTML = `
    <div class="players-table-scroll">
      <table>
        <thead>
          <tr>
            ${visibleColumns.map(col => `
              <th class="${col.sortable ? 'sortable-col' : ''} ${playerSort.column === col.key ? 'sorted-col' : ''}" data-key="${col.key}" title="${escapeHtml(col.title)}">
                ${escapeHtml(col.label)}${playerSort.column === col.key ? (playerSort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${list.map(p => `
            <tr>
              ${visibleColumns.map(col => `<td>${cellRenderers[col.key](p)}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll('.sortable-col').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (playerSort.column === key) {
        playerSort.dir = playerSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        playerSort = { column: key, dir: 'desc' };
      }
      renderPlayersTable(document.getElementById('player-search').value);
    });
  });
}

document.getElementById('player-search').addEventListener('input', (e) => {
  renderPlayersTable(e.target.value);
});

// ---------- Scoring ----------
// ---------- Rules ----------
function renderRulesPage() {
  const el = document.getElementById('rules-content');
  const c = currentConfig;
  const pot = totalPot();
  const potTierNote = pot < 1000
    ? `Current pot is <strong>$${pot.toFixed(0)}</strong> — under $1,000 tier applies (40% / 10% split).`
    : `Current pot is <strong>$${pot.toFixed(0)}</strong> — $1,000+ tier applies (25% / 20% / 5% split).`;

  el.innerHTML = `
    <p style="margin-bottom:20px; color:var(--amber); font-weight:700; font-size:16px;">🏒 2026–2027 Wedding Fundraiser NHL Box Pool 🏒</p>
    <p style="margin-bottom:20px;">Help support Mackenzie and Dan (the bride and groom) with their wedding costs while competing for cash!</p>

    <h3 class="group-title" style="margin-top:0;">💰 Entry &amp; Payments</h3>
    <p style="margin-bottom:6px;">Entry fee: <strong>$${c.entryFee ?? 10}</strong> per entry (unlimited entries allowed).</p>
    <p style="margin-bottom:6px;">Payment: E-transfer to <strong>${escapeHtml(c.commissionerEmail || 'matt.hope@rocketmail.com')}</strong>. Please include your first and last name in the transfer notes.</p>
    <p style="margin-bottom:20px;">Deadline: All entries and payments are due before puck drop on <strong>Tuesday, September 29, 2026, at 5:00 PM</strong> (Panthers vs. Hurricanes).</p>

    <h3 class="group-title">📋 How to Play</h3>
    <p style="margin-bottom:6px;">Make 28 total picks: 1 choice from each of the 24 player boxes, plus 4 division winners.</p>
    <p style="margin-bottom:20px;">Standings update regularly all season via this live tracking site once games begin.</p>

    <h3 class="group-title">📊 Point System</h3>
    <div class="scoring-grid" style="margin-bottom:20px;">
      <div class="scoring-card">
        <div class="scoring-card-title">Skaters</div>
        <table class="scoring-table">
          <tbody>
            <tr><td>Goal</td><td class="pts scoring-value">1</td></tr>
            <tr><td>Assist</td><td class="pts scoring-value">1</td></tr>
            <tr><td>Shots on Goal</td><td class="pts scoring-value">0.11</td></tr>
            <tr><td>Hat Trick</td><td class="pts scoring-value hat-trick">+3</td></tr>
            <tr><td>PIM (D only)</td><td class="pts scoring-value">0.25</td></tr>
          </tbody>
        </table>
      </div>
      <div class="scoring-card">
        <div class="scoring-card-title">Goalies</div>
        <table class="scoring-table">
          <tbody>
            <tr><td>Win</td><td class="pts scoring-value">3</td></tr>
            <tr><td>OT / SO Loss</td><td class="pts scoring-value">1.5</td></tr>
            <tr><td>Loss</td><td class="pts scoring-value">1</td></tr>
            <tr><td>Shutout</td><td class="pts scoring-value">2</td></tr>
            <tr><td>Saves</td><td class="pts scoring-value">0.02</td></tr>
          </tbody>
        </table>
      </div>
      <div class="scoring-card">
        <div class="scoring-card-title">Division Winners</div>
        <table class="scoring-table">
          <tbody>
            <tr><td>Correct 1st-place pick</td><td class="pts scoring-value hat-trick">+25</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <h3 class="group-title">🏆 Payouts (50/50 Split)</h3>
    <p style="margin-bottom:8px;">50% of the total pot goes to the bride &amp; groom; 50% goes to the participant prize pool.</p>
    <p style="margin-bottom:12px; color:var(--amber);">${potTierNote}</p>

    <div class="scoring-grid" style="margin-bottom:12px;">
      <div class="scoring-card">
        <div class="scoring-card-title">Pot under $1,000</div>
        <table class="scoring-table">
          <tbody>
            <tr><td>🥇 1st Place</td><td class="pts scoring-value">40% of pot</td></tr>
            <tr><td>🥈 2nd Place</td><td class="pts scoring-value">10% of pot</td></tr>
            <tr><td>💩 Last Place</td><td class="pts scoring-value" style="font-size:12px;">Free entry next year</td></tr>
          </tbody>
        </table>
      </div>
      <div class="scoring-card">
        <div class="scoring-card-title">Pot $1,000 or more</div>
        <table class="scoring-table">
          <tbody>
            <tr><td>🥇 1st Place</td><td class="pts scoring-value" style="line-height:1.3;">30% of pot<br><span style="font-size:10px; color:var(--text-dim); font-weight:400;">(50% of player pool)</span></td></tr>
            <tr><td>🥈 2nd Place</td><td class="pts scoring-value" style="line-height:1.3;">15% of pot<br><span style="font-size:10px; color:var(--text-dim); font-weight:400;">(40% of player pool)</span></td></tr>
            <tr><td>🥉 3rd Place</td><td class="pts scoring-value" style="line-height:1.3;">5% of pot<br><span style="font-size:10px; color:var(--text-dim); font-weight:400;">(10% of player pool)</span></td></tr>
            <tr><td>💩 Last Place</td><td class="pts scoring-value" style="font-size:12px;">Free entry next year</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <p style="margin-bottom:20px; color:var(--text-dim); font-size:13px;">Live payout amounts based on the current pot are shown on the <a href="#" data-view="standings" class="rules-inline-link">Standings page</a>.</p>

    <h3 class="group-title">Roster Moves</h3>
    <p style="margin-bottom:6px;"><strong>Before the season starts</strong> (before puck drop, Sep 29, 2026, 5:00 PM):</p>
    <p style="margin-bottom:4px;">• Unlimited changes to your player picks and division picks</p>
    <p style="margin-bottom:4px;">• Instant — no approval needed, applies immediately</p>
    <p style="margin-bottom:16px;">• Doesn't use up any of your season moves</p>

    <p style="margin-bottom:6px;"><strong>Once the season starts:</strong></p>
    <p style="margin-bottom:4px;">• You get exactly 2 roster moves total for the rest of the season (player boxes only — division picks lock permanently once the season begins)</p>
    <p style="margin-bottom:4px;">• Every move needs commissioner approval before it counts — you'll get a confirmation email once it's finalized</p>
    <p style="margin-bottom:4px;">• Scored fairly regardless of approval speed: the swap takes effect at the moment you request it, not when it's approved</p>
    <p style="margin-bottom:16px;">• Hard deadline: no move requests accepted after the NHL trade deadline — <strong>Monday, March 1, 2027</strong></p>

    <p style="margin-bottom:20px; color:var(--text-dim); font-size:13px;">Manage your picks and request moves on the <a href="#" data-view="managemoves" class="rules-inline-link">My Team page</a>, using the Entry ID from your confirmation email.</p>

    <h3 class="group-title">Tiebreaker</h3>
    <p style="margin-bottom:4px;">1. Highest combined goals + assists across your roster.</p>
    <p style="margin-bottom:20px;">2. If still tied: total goalie saves.</p>

    <h3 class="group-title">Roster Reference</h3>
    <p style="margin-bottom:16px;">The players available in each box, with current-season stats, are on the <a href="#" data-view="boxes" class="rules-inline-link">Boxes page</a>. Injured players are flagged automatically each night from live NHL data.</p>

    <h3 class="group-title">Viewing Other Teams' Picks</h3>
    <p style="margin-bottom:0;">Once picks lock, any team name on the Standings page becomes clickable — showing that team's full roster and stat line for every pick, including full move history and points banked from any swaps. Before lock, picks stay private to keep strategy fair.</p>
  `;

  el.querySelectorAll('.rules-inline-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector(`.nav-link[data-view="${link.dataset.view}"]`).click();
    });
  });
}

// ---------- Last Night's Stats ----------
async function renderLastNightStats() {
  const el = document.getElementById('lastnight-content');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading...</p>`;

  try {
    const stars = await fetchStarsOfNight();
    const performers = (stars && stars.allPerformers || []).filter(p => poolPlayerIds.has(p.playerId));

    if (!stars || performers.length === 0) {
      el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No games played yet.</p>`;
      return;
    }

    const grouped = { F: [], D: [], G: [] };
    performers.forEach(p => {
      const group = p.isGoalie ? 'G' : (p.position === 'D' ? 'D' : 'F');
      grouped[group].push(p);
    });
    Object.keys(grouped).forEach(g => grouped[g].sort((a, b) => b.pts - a.pts));

    const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };
    const dateFormatted = new Date(stars.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    el.innerHTML = `
      <p class="mono" style="color:var(--text-dim); font-size:13px; margin-bottom:16px;">${escapeHtml(dateFormatted)}</p>
      ${Object.keys(groupTitles).map(g => {
        if (grouped[g].length === 0) return '';
        return `
        <h3 class="group-title">${groupTitles[g]}</h3>
        <div class="panel" style="margin-bottom:16px;">
          <table>
            <thead>
              <tr>
                <th>Player</th><th>NHL</th>
                ${g === 'G' ? '<th>Dec</th><th>SO</th><th>SV</th>' : `<th>G</th><th>A</th><th>SOG</th>${g === 'D' ? '<th>PIM</th>' : ''}`}
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              ${grouped[g].map(p => `
                <tr>
                  <td>${escapeHtml(p.fullName)}</td>
                  <td>${escapeHtml(p.team)}</td>
                  ${g === 'G'
                    ? `<td>${p.decision || '-'}</td><td>${p.shutout ? 'Y' : '-'}</td><td>${p.saves}</td>`
                    : `<td>${p.goals}</td><td>${p.assists}</td><td>${p.sog || 0}</td>${g === 'D' ? `<td>${p.pim || 0}</td>` : ''}`}
                  <td class="pts">${p.pts.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;}).join('')}
    `;
  } catch (e) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No games played yet.</p>`;
  }
}

function renderScoringSummary() {
  const el = document.getElementById('scoring-summary');
  const c = currentConfig;
  const pot = totalPot();
  const under1000 = pot < 1000;

  const cards = [
    { title: 'Forwards & Defense', rows: [
      ['Goal', c.goalPtsF ?? 1],
      ['Assist', c.assistPtsF ?? 1],
      ['Shot on Goal', c.sogPtsF ?? 0.11],
      ['PIM / min (D only)', c.pimPtsD ?? 0.25]
    ]},
    { title: 'Goalies', rows: [
      ['Win', c.winPtsG ?? 3],
      ['Loss', c.lossPtsG ?? 1],
      ['OT Loss', c.otlPtsG ?? 1.5],
      ['Shutout', c.shutoutPtsG ?? 2],
      ['Save', c.savePtsG ?? 0.02]
    ]},
    { title: 'Bonuses', rows: [
      ['Hat Trick', `+${c.hatTrickBonus ?? 3}`, true],
      ['Division winner (live)', '+25', true]
    ]},
    { title: `Payout (${under1000 ? 'pot < $1,000' : 'pot $1,000+'})`, rows: under1000 ? [
      ['1st place', '40% of pot'],
      ['2nd place', '10% of pot'],
      ['Last place', 'Free entry next yr']
    ] : [
      ['1st place', '30% of pot'],
      ['2nd place', '15% of pot'],
      ['3rd place', '5% of pot'],
      ['Last place', 'Free entry next yr']
    ]},
    { title: 'Season', rows: [
      ['Entry Fee', `$${c.entryFee ?? 10}`],
      ['Picks Lock', formatDeadline(c.deadline)]
    ]}
  ];

  el.innerHTML = `
    <p style="color:var(--amber); margin-bottom:4px; font-size:14px; font-weight:700;">🏒 Wedding Fundraiser for Mackenzie &amp; Dan 🏒</p>
    <p style="color:var(--text-dim); margin-bottom:16px; font-size:14px;">
      24-box pick'em (16 Forward, 5 Defense, 3 Goalie) + 4 division winner picks. 50% of the pot goes to the couple, 50% to the participant prize pool.
    </p>
    <div class="scoring-grid">
      ${cards.map(card => `
        <div class="scoring-card">
          <div class="scoring-card-title">${escapeHtml(card.title)}</div>
          <table class="scoring-table">
            <tbody>
              ${card.rows.map(([label, value, hat]) => `
                <tr><td>${escapeHtml(label)}</td><td class="pts scoring-value ${hat ? 'hat-trick' : ''}">${escapeHtml(String(value))}</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `).join('')}
    </div>
  `;
}

function ordinal(n) {
  if (!n) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function nhlProfileUrl(fullName, playerId) {
  const slug = (fullName || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `https://www.nhl.com/player/${slug}-${playerId}`;
}

// ---------- Signup ----------
let allBoxes = [];
let signupPicks = {}; // { boxId: playerId }
let divisionPicks = {}; // { division: teamAbbrev }
let lastSeasonStandings = {};
let signupFields = { teamName: '', ownerName: '', email: '' };

const DIVISION_TEAMS = {
  Atlantic: [['BOS','Boston Bruins'],['BUF','Buffalo Sabres'],['DET','Detroit Red Wings'],['FLA','Florida Panthers'],['MTL','Montreal Canadiens'],['OTT','Ottawa Senators'],['TBL','Tampa Bay Lightning'],['TOR','Toronto Maple Leafs']],
  Metropolitan: [['CAR','Carolina Hurricanes'],['CBJ','Columbus Blue Jackets'],['NJD','New Jersey Devils'],['NYI','New York Islanders'],['NYR','New York Rangers'],['PHI','Philadelphia Flyers'],['PIT','Pittsburgh Penguins'],['WSH','Washington Capitals']],
  Central: [['CHI','Chicago Blackhawks'],['COL','Colorado Avalanche'],['DAL','Dallas Stars'],['MIN','Minnesota Wild'],['NSH','Nashville Predators'],['STL','St. Louis Blues'],['UTA','Utah Mammoth'],['WPG','Winnipeg Jets']],
  Pacific: [['ANA','Anaheim Ducks'],['CGY','Calgary Flames'],['EDM','Edmonton Oilers'],['LAK','Los Angeles Kings'],['SJS','San Jose Sharks'],['SEA','Seattle Kraken'],['VAN','Vancouver Canucks'],['VGK','Vegas Golden Knights']]
};

async function renderSignupForm() {
  editingEntryId = null;
  signupPicks = {};
  divisionPicks = {};
  signupFields = { teamName: '', ownerName: '', email: '' };

  const deadlinePassed = currentConfig.deadline && new Date() >= new Date(currentConfig.deadline);
  if (currentConfig.picksLocked || deadlinePassed) {
    document.getElementById('signup-form').innerHTML = `
      <div class="panel" style="text-align:center; padding:32px;">
        <h2 style="color:var(--amber); margin-bottom:12px;">Picks Are Locked</h2>
        <p style="color:var(--text-dim); font-size:14px;">The season has started and new entries are no longer being accepted.</p>
      </div>
    `;
    return;
  }

  await renderSignupFormBody();
}

async function renderSignupFormBody() {
  const el = document.getElementById('signup-form');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading boxes...</p>`;

  if (allBoxes.length === 0) {
    allBoxes = await fetchBoxes();
  }
  if (Object.keys(lastSeasonStandings).length === 0) {
    lastSeasonStandings = await fetchLastSeasonStandings();
  }

  const grouped = { F: [], D: [], G: [] };
  allBoxes.forEach(b => grouped[b.boxType].push(b));
  const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };

  el.innerHTML = `
    <label>Team Name</label>
    <input type="text" id="f-teamName" value="${escapeHtml(signupFields.teamName)}">
    <div id="team-name-warning" class="status-msg" style="display:none; color:var(--amber);"></div>
    <label>Owner Name</label>
    <input type="text" id="f-ownerName" value="${escapeHtml(signupFields.ownerName)}">
    <label>Email</label>
    <input type="email" id="f-email" value="${escapeHtml(signupFields.email)}">
    <div class="picks-count mono" id="picks-count">${Object.keys(signupPicks).length} / ${TOTAL_BOXES} picked</div>

    ${Object.keys(groupTitles).map(type => `
      <h3 class="group-title">${groupTitles[type]}</h3>
      <div class="box-grid">
        ${grouped[type].map(box => `
          <div class="box-picker" id="box-picker-${box.id}">
            <div class="box-picker-label">${escapeHtml(box.boxLabel)}</div>
            <div class="box-picker-options">
              ${[...box.players].map(p => {
                const fullPlayer = allPlayers.find(ap => ap.id === p.playerId);
                const currentSeasonHasStats = fullPlayer && fullPlayer.stats && Object.values(fullPlayer.stats).some(v => v > 0);
                const s = fullPlayer ? (currentSeasonHasStats ? fullPlayer.stats : (fullPlayer.prevStats || {})) : {};
                const ptsNum = fullPlayer ? computePlayerPoints({ position: fullPlayer.position, stats: s }, currentConfig) : 0;
                return { p, fullPlayer, currentSeasonHasStats, s, ptsNum };
              }).sort((a, b) => b.ptsNum - a.ptsNum).map(({ p, fullPlayer, currentSeasonHasStats, s, ptsNum }) => {
                const currentTeam = fullPlayer ? fullPlayer.team : p.team;
                const headshot = fullPlayer ? fullPlayer.headshotUrl : '';
                const statSourceLabel = currentSeasonHasStats ? '' : ` <span class="stat-source">(25-26)</span>`;
                const pts = ptsNum.toFixed(1);
                const statLine = box.boxType === 'G'
                  ? `${s.wins || 0}W · ${s.shutouts || 0}SO · ${pts}pts${statSourceLabel}`
                  : `${s.goals || 0}G · ${s.assists || 0}A${s.hatTricks ? ` · ${s.hatTricks}HT` : ''} · ${pts}pts${statSourceLabel}`;
                const cardStats = box.boxType === 'G'
                  ? `${s.wins || 0}W ${s.losses || 0}L ${s.otl || 0}OTL &middot; ${s.shutouts || 0} SO &middot; ${s.saves || 0} SV`
                  : `${s.goals || 0}G ${s.assists || 0}A ${s.sog || 0}SOG${box.boxType === 'D' ? ` ${s.pim || 0}PIM` : ''}${s.hatTricks ? ` &middot; ${s.hatTricks} HT` : ''}`;
                return `
                <label class="box-option">
                  <input type="radio" name="box-${box.id}" value="${p.playerId}" data-box="${box.id}" ${signupPicks[box.id] === p.playerId ? 'checked' : ''}>
                  <span class="box-option-photo-wrap">
                    ${headshot ? `<a class="player-nhl-link" href="${nhlProfileUrl(p.name, p.playerId)}" target="_blank" rel="noopener"><img class="box-option-photo" src="${headshot}" alt="" loading="lazy"></a>` : `<div class="box-option-photo box-option-photo-empty"></div>`}
                    ${headshot ? `
                    <div class="player-hover-card">
                      <img class="player-hover-photo" src="${headshot}" alt="">
                      <div class="player-hover-name">${escapeHtml(p.name)}${fullPlayer && fullPlayer.injuryStatus ? ' <span class="ir-badge">🩹</span>' : ''}</div>
                      <div class="player-hover-team mono">${escapeHtml(currentTeam)} ${currentSeasonHasStats ? '· 26-27' : '· 25-26 (last season)'}</div>
                      ${fullPlayer && fullPlayer.injuryStatus ? `<div class="mono" style="color:#ff5c5c; font-size:12px; margin-bottom:6px;">Injured: ${escapeHtml(fullPlayer.injuryStatus)}</div>` : ''}
                      <div class="player-hover-stats mono">${cardStats}</div>
                      <div class="player-hover-pts mono">${pts} pts</div>
                    </div>` : ''}
                  </span>
                  <span class="box-option-name">${escapeHtml(p.name)}${fullPlayer && fullPlayer.injuryStatus ? ` <span class="ir-badge" title="Injured: ${escapeHtml(fullPlayer.injuryStatus)}">🩹</span>` : ''}</span>
                  <span class="mono box-option-stats">${statLine}</span>
                  <span class="mono box-option-meta">${escapeHtml(currentTeam)}</span>
                </label>
              `;}).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')}

    <h3 class="group-title">Division Winner Picks <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(+10 pts bonus each, awarded at season end)</span></h3>
    <div class="box-grid">
      ${DIVISIONS.map(division => {
        const teams = [...DIVISION_TEAMS[division]].sort((a, b) => {
          const ra = (lastSeasonStandings[a[0]] || {}).rank ?? 99;
          const rb = (lastSeasonStandings[b[0]] || {}).rank ?? 99;
          return ra - rb;
        });
        return `
        <div class="box-picker">
          <div class="box-picker-label">${escapeHtml(division)}</div>
          <div class="box-picker-options">
            ${teams.map(([abbrev, fullName]) => {
              const record = lastSeasonStandings[abbrev];
              const refLabel = record ? `${record.points}pts (${ordinal(record.rank)}, 25-26)` : '';
              return `
              <label class="box-option">
                <input type="radio" name="division-${division}" value="${abbrev}" data-division="${division}" ${divisionPicks[division] === abbrev ? 'checked' : ''}>
                <img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">
                <span class="box-option-name">${escapeHtml(fullName)}</span>
                <span class="mono box-option-stats">${escapeHtml(refLabel)}</span>
                <span class="mono box-option-meta">${escapeHtml(abbrev)}</span>
              </label>
            `;}).join('')}
          </div>
        </div>
      `;}).join('')}
    </div>

    <button id="submit-entry-btn">Submit Entry</button>
    <div id="signup-status" class="status-msg"></div>
  `;

  el.querySelectorAll('input[type="radio"][name^="box-"]').forEach(radio => {
    radio.addEventListener('change', () => {
      signupPicks[radio.dataset.box] = radio.value;
      updatePicksCount();
      const boxEl = document.getElementById(`box-picker-${radio.dataset.box}`);
      if (boxEl) boxEl.classList.remove('box-missing');
    });
  });

  el.querySelectorAll('input[type="radio"][name^="division-"]').forEach(radio => {
    radio.addEventListener('change', () => {
      divisionPicks[radio.dataset.division] = radio.value;
    });
  });

  el.querySelectorAll('.player-nhl-link').forEach(link => {
    link.addEventListener('click', (e) => e.stopPropagation());
  });

  document.getElementById('submit-entry-btn').addEventListener('click', handleSubmitEntry);

  document.getElementById('f-teamName').addEventListener('input', (e) => {
    const warningEl = document.getElementById('team-name-warning');
    const typed = e.target.value.trim().toLowerCase();
    const isDuplicate = typed.length > 0 && allStandings.some(s => (s.teamName || '').trim().toLowerCase() === typed);
    if (isDuplicate) {
      warningEl.textContent = `⚠️ "${e.target.value.trim()}" is already taken by another team. You can still use it, but consider something unique so it's easy to tell apart on Standings.`;
      warningEl.style.display = 'block';
    } else {
      warningEl.style.display = 'none';
    }
  });
}

function updatePicksCount() {
  const countEl = document.getElementById('picks-count');
  const count = Object.keys(signupPicks).length;
  countEl.textContent = `${count} / ${TOTAL_BOXES} picked`;
  countEl.style.color = count === TOTAL_BOXES ? 'var(--ice)' : 'var(--text-dim)';
}

async function handleSubmitEntry() {
  const teamName = document.getElementById('f-teamName').value.trim();
  const ownerName = document.getElementById('f-ownerName').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const statusEl = document.getElementById('signup-status');

  if (!teamName || !ownerName || !email) {
    statusEl.textContent = 'Fill in team name, owner name, and email.';
    statusEl.className = 'status-msg error';
    return;
  }

  document.querySelectorAll('.box-picker').forEach(el => el.classList.remove('box-missing'));

  if (Object.keys(signupPicks).length !== TOTAL_BOXES) {
    const missingBoxes = allBoxes.filter(b => !signupPicks[b.id]);
    missingBoxes.forEach(b => {
      const el = document.getElementById(`box-picker-${b.id}`);
      if (el) el.classList.add('box-missing');
    });

    const labels = missingBoxes.map(b => b.boxLabel);
    statusEl.textContent = labels.length <= 4
      ? `Missing pick: ${labels.join(', ')}`
      : `Missing ${labels.length} picks: ${labels.slice(0, 4).join(', ')}, +${labels.length - 4} more`;
    statusEl.className = 'status-msg error';

    const firstMissing = document.getElementById(`box-picker-${missingBoxes[0].id}`);
    if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  for (const division of DIVISIONS) {
    if (!divisionPicks[division]) {
      statusEl.textContent = `Pick a division winner for ${division}.`;
      statusEl.className = 'status-msg error';
      return;
    }
  }

  signupFields = { teamName, ownerName, email };
  renderSignupConfirmStep();
}

function renderSignupConfirmStep() {
  const el = document.getElementById('signup-form');
  const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };
  const grouped = { F: [], D: [], G: [] };

  Object.keys(signupPicks).forEach(boxId => {
    const box = allBoxes.find(b => String(b.id) === String(boxId));
    if (!box) return;
    const boxPlayer = (box.players || []).find(p => p.playerId === signupPicks[boxId]);
    const fullPlayer = allPlayers.find(ap => ap.id === signupPicks[boxId]);
    grouped[box.boxType].push({
      boxLabel: box.boxLabel,
      name: boxPlayer ? boxPlayer.name : signupPicks[boxId],
      team: fullPlayer ? fullPlayer.team : (boxPlayer ? boxPlayer.team : '')
    });
  });

  const divisionRows = DIVISIONS.map(division => {
    const abbrev = divisionPicks[division];
    const teamEntry = DIVISION_TEAMS[division].find(t => t[0] === abbrev);
    return `<div class="activity-row"><span>${escapeHtml(division)}</span><span class="mono" style="display:flex; align-items:center; gap:6px; justify-content:flex-end;"><img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">${escapeHtml(teamEntry ? teamEntry[1] : abbrev)}</span></div>`;
  }).join('');

  el.innerHTML = `
    <h2 style="margin-bottom:4px;">${editingEntryId ? 'Review Changes' : 'Review Your Team'}</h2>
    <p style="color:var(--text-dim); font-size:14px; margin-bottom:16px;">${editingEntryId ? "Double-check everything below, then save." : "Double-check everything below. Once confirmed, you'll get an email copy of your picks and payment instructions."}</p>

    <div class="panel" style="margin-bottom:16px;">
      <div class="activity-row"><span>Team Name</span><span class="mono">${escapeHtml(signupFields.teamName)}</span></div>
      <div class="activity-row"><span>Owner Name</span><span class="mono">${escapeHtml(signupFields.ownerName)}</span></div>
      <div class="activity-row"><span>Email</span><span class="mono">${escapeHtml(signupFields.email)}</span></div>
    </div>

    ${Object.keys(groupTitles).map(type => `
      <h3 class="group-title">${groupTitles[type]}</h3>
      <div class="modal-pick-list">
        ${grouped[type].map(p => `
          <div class="modal-pick-row">
            <span class="modal-pick-name">${escapeHtml(p.name)}</span>
            <span class="mono modal-pick-meta">${escapeHtml(p.team)}</span>
          </div>
        `).join('')}
      </div>
    `).join('')}

    <h3 class="group-title">Division Winner Picks</h3>
    <div class="panel">${divisionRows}</div>

    <div style="display:flex; gap:10px; margin-top:20px;">
      <button id="confirm-back-btn" style="background:var(--bg-panel-alt); color:var(--text);">Back to Edit</button>
      <button id="confirm-submit-btn">${editingEntryId ? 'Save Changes' : 'Confirm & Submit'}</button>
    </div>
    <div id="signup-status" class="status-msg"></div>
  `;

  document.getElementById('confirm-back-btn').addEventListener('click', renderSignupFormBody);
  document.getElementById('confirm-submit-btn').addEventListener('click', doFinalSubmit);
}

async function doFinalSubmit() {
  const statusEl = document.getElementById('signup-status');
  statusEl.textContent = editingEntryId ? 'Saving...' : 'Submitting...';
  statusEl.className = 'status-msg';

  if (editingEntryId) {
    const result = await adminUpdateEntry(adminPassword, editingEntryId, {
      teamName: signupFields.teamName,
      ownerName: signupFields.ownerName,
      email: signupFields.email,
      picks: signupPicks,
      divisionPicks: divisionPicks
    });

    if (result.success) {
      const savedId = editingEntryId;
      editingEntryId = null;
      document.getElementById('signup-form').innerHTML = `
        <div class="panel" style="text-align:center; padding:32px;">
          <h2 style="color:var(--ice); margin-bottom:12px;">Changes saved</h2>
          <p style="color:var(--text-dim); font-size:14px;">Entry ID: <span class="mono">${escapeHtml(savedId)}</span></p>
        </div>
      `;
    } else {
      statusEl.textContent = 'Error: ' + result.error;
      statusEl.className = 'status-msg error';
    }
    return;
  }

  const result = await submitEntry({
    teamName: signupFields.teamName,
    ownerName: signupFields.ownerName,
    email: signupFields.email,
    picks: signupPicks,
    divisionPicks: divisionPicks
  });

  if (result.success) {
    document.getElementById('signup-form').innerHTML = `
      <div class="panel" style="text-align:center; padding:32px;">
        <h2 style="color:var(--ice); margin-bottom:12px;">You're in!</h2>
        <p style="margin-bottom:8px;">Entry ID: <span class="mono">${escapeHtml(result.entryId)}</span></p>
        <p style="color:var(--text-dim); font-size:14px;">A confirmation email with your picks and payment instructions is on its way to ${escapeHtml(signupFields.email)}.</p>
        <p style="color:var(--text-dim); font-size:13px; margin-top:12px;">Don't see it in a few minutes? Check your spam/junk folder.</p>
      </div>
    `;
  } else {
    statusEl.textContent = 'Error: ' + result.error;
    statusEl.className = 'status-msg error';
  }
}

// ---------- Boxes Reference (public, read-only) ----------
async function renderBoxesReference() {
  const el = document.getElementById('boxes-reference');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading...</p>`;

  if (allBoxes.length === 0) {
    allBoxes = await fetchBoxes();
  }
  if (Object.keys(lastSeasonStandings).length === 0) {
    lastSeasonStandings = await fetchLastSeasonStandings();
  }

  const grouped = { F: [], D: [], G: [] };
  allBoxes.forEach(b => grouped[b.boxType].push(b));
  const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };

  const playerBoxesHtml = Object.keys(groupTitles).map(type => `
    <h3 class="group-title">${groupTitles[type]}</h3>
    <div class="box-grid">
      ${grouped[type].map(box => {
        const ranked = [...box.players].map(p => {
          const fullPlayer = allPlayers.find(ap => ap.id === p.playerId);
          const s = (fullPlayer && fullPlayer.stats) || {};
          const ptsNum = fullPlayer ? computePlayerPoints(fullPlayer, currentConfig) : 0;
          return { p, fullPlayer, s, ptsNum };
        }).sort((a, b) => b.ptsNum - a.ptsNum);

        return `
        <div class="box-picker">
          <div class="box-picker-label">${escapeHtml(box.boxLabel)}</div>
          <div class="box-picker-options">
            ${ranked.map(({ p, fullPlayer, s, ptsNum }) => {
              const currentTeam = fullPlayer ? fullPlayer.team : p.team;
              const headshot = fullPlayer ? fullPlayer.headshotUrl : '';
              const statLine = box.boxType === 'G'
                ? `${s.wins || 0}W ${s.losses || 0}L ${s.otl || 0}OTL · ${s.shutouts || 0}SO · ${s.saves || 0}SV`
                : `${s.goals || 0}G ${s.assists || 0}A ${s.sog || 0}SOG${box.boxType === 'D' ? ` ${s.pim || 0}PIM` : ''}${s.hatTricks ? ` · ${s.hatTricks}HT` : ''}`;
              return `
              <div class="box-option box-option-readonly">
                <span class="box-option-photo-wrap">
                  ${headshot ? `<a class="player-nhl-link" href="${nhlProfileUrl(p.name, p.playerId)}" target="_blank" rel="noopener"><img class="box-option-photo" src="${headshot}" alt="" loading="lazy"></a>` : `<div class="box-option-photo box-option-photo-empty"></div>`}
                </span>
                <span class="box-option-name">${escapeHtml(p.name)}${fullPlayer && fullPlayer.injuryStatus ? ` <span class="ir-badge" title="Injured: ${escapeHtml(fullPlayer.injuryStatus)}">🩹</span>` : ''}</span>
                <span class="mono box-option-stats">${statLine} · ${ptsNum.toFixed(2)}pts</span>
                <span class="mono box-option-meta">${escapeHtml(currentTeam)}</span>
              </div>
            `;}).join('')}
          </div>
        </div>
      `;}).join('')}
    </div>
  `).join('');

  const divisionBoxesHtml = `
    <h3 class="group-title">Division Winner Boxes <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(+10 pts bonus each, awarded live all season)</span></h3>
    <div class="box-grid">
      ${DIVISIONS.map(division => {
        const teams = [...DIVISION_TEAMS[division]].sort((a, b) => {
          const ra = (lastSeasonStandings[a[0]] || {}).rank ?? 99;
          const rb = (lastSeasonStandings[b[0]] || {}).rank ?? 99;
          return ra - rb;
        });
        return `
        <div class="box-picker">
          <div class="box-picker-label">${escapeHtml(division)}</div>
          <div class="box-picker-options">
            ${teams.map(([abbrev, fullName]) => {
              const record = lastSeasonStandings[abbrev];
              const refLabel = record ? `${record.points}pts (${ordinal(record.rank)}, 25-26)` : '';
              return `
              <div class="box-option box-option-readonly">
                <img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">
                <span class="box-option-name">${escapeHtml(fullName)}</span>
                <span class="mono box-option-stats">${escapeHtml(refLabel)}</span>
                <span class="mono box-option-meta">${escapeHtml(abbrev)}</span>
              </div>
            `;}).join('')}
          </div>
        </div>
      `;}).join('')}
    </div>
  `;

  el.innerHTML = playerBoxesHtml + divisionBoxesHtml;
}

// ---------- My Team (Roster Moves) ----------
let myTeamEntry = null;

function renderManageMoves() {
  const el = document.getElementById('managemoves-content');
  el.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <p style="color:var(--text-dim); font-size:14px; margin-bottom:14px;">Look up your team using the Entry ID and email from your confirmation email. Before the season starts, you can change your picks freely at no cost. Once the season begins, you get 2 roster moves total, each needing commissioner approval before it counts, and all moves must be requested before the NHL trade deadline (March 1, 2027).</p>
      <label>Entry ID</label>
      <input type="text" id="moves-entryid-input" placeholder="From your confirmation email">
      <label>Email</label>
      <input type="email" id="moves-email-input">
      <button id="moves-lookup-btn">Find My Team</button>
      <div id="moves-lookup-status" class="status-msg"></div>
    </div>
    <div id="moves-team-panel"></div>
  `;

  document.getElementById('moves-lookup-btn').addEventListener('click', async () => {
    const entryId = document.getElementById('moves-entryid-input').value.trim();
    const email = document.getElementById('moves-email-input').value.trim();
    const statusEl = document.getElementById('moves-lookup-status');

    if (!entryId || !email) {
      statusEl.textContent = 'Enter both your Entry ID and email.';
      statusEl.className = 'status-msg error';
      return;
    }

    statusEl.textContent = 'Looking up...';
    statusEl.className = 'status-msg';

    const result = await findEntryForMoves(entryId, email);
    if (result.success) {
      statusEl.textContent = '';
      myTeamEntry = result.data;
      renderMyTeamMovesPanel();
    } else {
      statusEl.textContent = result.error || 'Not found';
      statusEl.className = 'status-msg error';
    }
  });
}

let stagedMoves = {}; // boxId -> { oldPlayerId, newPlayerId }
let stagedDivisionChanges = {}; // division -> { oldTeam, newTeam }

function renderMyTeamMovesPanel() {
  const el = document.getElementById('moves-team-panel');
  if (!myTeamEntry) return;
  stagedMoves = {};
  stagedDivisionChanges = {};

  const boxById = {};
  allBoxes.forEach(b => { boxById[b.id] = b; });

  el.innerHTML = `
    <h3 style="margin-bottom:4px;">${escapeHtml(myTeamEntry.teamName)}</h3>
    <p class="mono" style="color:var(--ice); margin-bottom:16px;">${myTeamEntry.movesRemaining} move${myTeamEntry.movesRemaining === 1 ? '' : 's'} remaining</p>

    ${myTeamEntry.moveHistory.length > 0 ? `
      <h4 class="group-title">Move History</h4>
      <div class="panel" style="margin-bottom:16px;">
        ${myTeamEntry.moveHistory.map(m => {
          const box = boxById[m.boxId];
          const outP = allPlayers.find(p => p.id === m.outPlayerId);
          const inP = allPlayers.find(p => p.id === m.inPlayerId);
          const statusColor = m.status === 'approved' ? 'var(--ice)' : (m.status === 'rejected' ? '#ff5c5c' : 'var(--amber)');
          return `<div class="activity-row">
            <span>${escapeHtml(box ? box.boxLabel : m.boxId)}: ${escapeHtml(outP ? outP.fullName : m.outPlayerId)} → ${escapeHtml(inP ? inP.fullName : m.inPlayerId)}</span>
            <span class="mono" style="color:${statusColor}; text-transform:capitalize;">${escapeHtml(m.status)}</span>
          </div>`;
        }).join('')}
      </div>
    ` : ''}

    ${!myTeamEntry.seasonStarted ? `
      <h4 class="group-title">Division Winner Picks <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(free to change until the season starts, then these lock permanently)</span></h4>
      <div class="box-grid" id="my-team-division-grid"></div>
    ` : ''}

    ${myTeamEntry.movesRemaining > 0 ? `
      <h4 class="group-title">Request Moves <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(pick as many box changes as you want, then submit together at the bottom)</span></h4>
      <div class="box-grid" id="my-team-box-grid"></div>
    ` : `<p class="mono" style="color:var(--text-dim);">No moves remaining.</p>`}

    <div id="unified-changes-summary" style="margin-top:24px;"></div>
  `;

  if (!myTeamEntry.seasonStarted) {
    renderMyTeamDivisionPicker();
  }

  if (myTeamEntry.movesRemaining > 0) {
    renderMyTeamBoxPicker();
  }

  renderUnifiedChangesSummary_();
}

function renderMyTeamBoxPicker() {
  const grid = document.getElementById('my-team-box-grid');
  const boxById = {};
  allBoxes.forEach(b => { boxById[b.id] = b; });

  grid.innerHTML = REQUIRED_BOX_IDS.map(boxId => {
    const box = boxById[boxId];
    if (!box) return '';
    const currentPlayerId = myTeamEntry.picks[boxId];
    const stagedId = stagedMoves[boxId] ? stagedMoves[boxId].newPlayerId : currentPlayerId;

    return `
      <div class="box-picker">
        <div class="box-picker-label">${escapeHtml(box.boxLabel)}</div>
        <div class="box-picker-options">
          ${box.players.map(p => {
            const isCurrent = p.playerId === currentPlayerId;
            const isSelected = p.playerId === stagedId;
            return `
            <label class="box-option ${isCurrent ? 'box-option-current' : ''}">
              <input type="radio" name="move-target-${boxId}" data-box="${boxId}" value="${p.playerId}" ${isSelected ? 'checked' : ''}>
              <span class="box-option-name">${escapeHtml(p.name)}${isCurrent ? ' <span class="mono" style="color:var(--ice); font-size:11px;">(current)</span>' : ''}</span>
              <span class="mono box-option-meta">${escapeHtml(p.team)}</span>
            </label>
          `;}).join('')}
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const boxId = radio.dataset.box;
      const currentPlayerId = myTeamEntry.picks[boxId];
      if (radio.value === currentPlayerId) {
        delete stagedMoves[boxId]; // reverted back to their original pick
      } else {
        stagedMoves[boxId] = { oldPlayerId: currentPlayerId, newPlayerId: radio.value };
      }
      renderUnifiedChangesSummary_();
    });
  });
}

function renderMyTeamDivisionPicker() {
  const grid = document.getElementById('my-team-division-grid');
  if (!grid) return;

  grid.innerHTML = DIVISIONS.map(division => {
    const currentAbbrev = myTeamEntry.divisionPicks[division];
    const stagedAbbrev = stagedDivisionChanges[division] ? stagedDivisionChanges[division].newTeam : currentAbbrev;

    return `
      <div class="box-picker">
        <div class="box-picker-label">${escapeHtml(division)}</div>
        <div class="box-picker-options">
          ${DIVISION_TEAMS[division].map(([abbrev, fullName]) => {
            const isCurrent = abbrev === currentAbbrev;
            const isSelected = abbrev === stagedAbbrev;
            return `
            <label class="box-option ${isCurrent ? 'box-option-current' : ''}">
              <input type="radio" name="division-target-${division}" data-division="${division}" value="${abbrev}" ${isSelected ? 'checked' : ''}>
              <img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">
              <span class="box-option-name">${escapeHtml(fullName)}${isCurrent ? ' <span class="mono" style="color:var(--ice); font-size:11px;">(current)</span>' : ''}</span>
              <span class="mono box-option-meta">${escapeHtml(abbrev)}</span>
            </label>
          `;}).join('')}
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const division = radio.dataset.division;
      const currentAbbrev = myTeamEntry.divisionPicks[division];
      if (radio.value === currentAbbrev) {
        delete stagedDivisionChanges[division];
      } else {
        stagedDivisionChanges[division] = { oldTeam: currentAbbrev, newTeam: radio.value };
      }
      renderUnifiedChangesSummary_();
    });
  });
}

/**
 * ONE combined summary of every staged change (box moves + division picks
 * together) with a single submit button, placed at the bottom of the page
 * so it reads naturally as "review everything, then submit."
 */
function renderUnifiedChangesSummary_() {
  const el = document.getElementById('unified-changes-summary');
  if (!el) return;

  const boxById = {};
  allBoxes.forEach(b => { boxById[b.id] = b; });

  const stagedBoxIds = Object.keys(stagedMoves);
  const stagedDivisions = Object.keys(stagedDivisionChanges);
  const totalStaged = stagedBoxIds.length + stagedDivisions.length;

  if (totalStaged === 0) {
    el.innerHTML = '';
    return;
  }

  const seasonStarted = currentConfig.seasonStartDate && new Date() >= new Date(currentConfig.seasonStartDate);
  const overLimit = seasonStarted && stagedBoxIds.length > myTeamEntry.movesRemaining;

  el.innerHTML = `
    <div class="panel" style="border-color:var(--amber);">
      <h4 style="margin-bottom:10px; color:var(--amber);">Review Your Changes (${totalStaged})</h4>
      ${stagedBoxIds.map(boxId => {
        const box = boxById[boxId];
        const move = stagedMoves[boxId];
        const oldOption = (box.players || []).find(p => p.playerId === move.oldPlayerId);
        const newOption = (box.players || []).find(p => p.playerId === move.newPlayerId);
        return `
          <div class="activity-row">
            <span><strong>${escapeHtml(box.boxLabel)}:</strong> ${escapeHtml(oldOption ? oldOption.name : move.oldPlayerId)} → ${escapeHtml(newOption ? newOption.name : move.newPlayerId)}</span>
            <button class="admin-btn" data-remove-box="${boxId}">Remove</button>
          </div>
        `;
      }).join('')}
      ${stagedDivisions.map(division => {
        const change = stagedDivisionChanges[division];
        const oldTeam = DIVISION_TEAMS[division].find(t => t[0] === change.oldTeam);
        const newTeam = DIVISION_TEAMS[division].find(t => t[0] === change.newTeam);
        return `
          <div class="activity-row">
            <span><strong>${escapeHtml(division)}:</strong> ${escapeHtml(oldTeam ? oldTeam[1] : change.oldTeam)} → ${escapeHtml(newTeam ? newTeam[1] : change.newTeam)}</span>
            <button class="admin-btn" data-remove-division="${division}">Remove</button>
          </div>
        `;
      }).join('')}
      ${overLimit ? `<p class="status-msg error" style="margin-top:10px;">You only have ${myTeamEntry.movesRemaining} move${myTeamEntry.movesRemaining === 1 ? '' : 's'} remaining - remove ${stagedBoxIds.length - myTeamEntry.movesRemaining} player change${stagedBoxIds.length - myTeamEntry.movesRemaining === 1 ? '' : 's'} before submitting.</p>` : ''}
      <button id="submit-all-changes-btn" ${overLimit ? 'disabled' : ''} style="margin-top:12px;">Submit ${totalStaged} Change${totalStaged === 1 ? '' : 's'}</button>
      <div id="unified-changes-status" class="status-msg"></div>
    </div>
  `;

  el.querySelectorAll('[data-remove-box]').forEach(btn => {
    btn.addEventListener('click', () => {
      const boxId = btn.dataset.removeBox;
      delete stagedMoves[boxId];
      const currentPlayerId = myTeamEntry.picks[boxId];
      const radio = document.querySelector(`input[name="move-target-${boxId}"][value="${currentPlayerId}"]`);
      if (radio) radio.checked = true;
      renderUnifiedChangesSummary_();
    });
  });

  el.querySelectorAll('[data-remove-division]').forEach(btn => {
    btn.addEventListener('click', () => {
      const division = btn.dataset.removeDivision;
      delete stagedDivisionChanges[division];
      const currentAbbrev = myTeamEntry.divisionPicks[division];
      const radio = document.querySelector(`input[name="division-target-${division}"][value="${currentAbbrev}"]`);
      if (radio) radio.checked = true;
      renderUnifiedChangesSummary_();
    });
  });

  if (!overLimit) {
    document.getElementById('submit-all-changes-btn').addEventListener('click', submitAllUnifiedChanges_);
  }
}

async function submitAllUnifiedChanges_() {
  const entryId = document.getElementById('moves-entryid-input').value.trim();
  const email = document.getElementById('moves-email-input').value.trim();
  const boxIds = Object.keys(stagedMoves);
  const divisions = Object.keys(stagedDivisionChanges);
  const totalStaged = boxIds.length + divisions.length;

  const btn = document.getElementById('submit-all-changes-btn');
  const statusEl = document.getElementById('unified-changes-status');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  if (statusEl) statusEl.textContent = `Submitting ${totalStaged} change${totalStaged === 1 ? '' : 's'}...`;

  try {
    const boxChanges = boxIds.map(boxId => ({ boxId, newPlayerId: stagedMoves[boxId].newPlayerId }));
    const divisionChanges = divisions.map(division => ({ division, newTeamAbbrev: stagedDivisionChanges[division].newTeam }));

    // One round trip does everything: applies all changes, writes the entry
    // once, recomputes standings once, and sends one confirmation email -
    // instead of a separate round trip (and full recompute) per change.
    const result = await submitBatchTeamChanges(entryId, email, boxChanges, divisionChanges);

    if (statusEl) statusEl.textContent = 'Refreshing your team...';
    const refreshed = await findEntryForMoves(entryId, email);
    if (refreshed.success) myTeamEntry = refreshed.data;
    renderMyTeamMovesPanel();

    if (!result.success && result.errors && result.errors.length > 0) {
      alert('Some changes could not be submitted:\n\n' + result.errors.join('\n'));
    } else if (result.error) {
      alert('Error: ' + result.error);
    } else {
      alert('Changes submitted!');
    }
  } catch (err) {
    console.error('submitAllUnifiedChanges_ failed:', err);
    if (statusEl) { statusEl.textContent = 'Something went wrong: ' + err.message; statusEl.className = 'status-msg error'; }
    btn.disabled = false;
    btn.textContent = `Submit ${totalStaged} Change${totalStaged === 1 ? '' : 's'}`;
    alert('Something went wrong submitting your changes. Please try again.\n\n' + err.message);
  }
}

// ---------- IR List (public) ----------
async function renderIRPanel() {
  const el = document.getElementById('ir-panel');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading...</p>`;
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

// ---------- Admin (password gated) ----------
let adminPassword = null;
let adminEntriesCache = [];
let editingEntryId = null;

function renderAdminPanel() {
  const el = document.getElementById('admin-panel');

  if (!adminPassword) {
    el.innerHTML = `
      <label>Admin Password</label>
      <div class="pw-field-wrap">
        <input type="password" id="admin-pw-input" style="max-width:300px;">
        <button type="button" id="admin-pw-toggle" class="pw-toggle-btn">Show</button>
      </div>
      <button id="admin-login-btn">Log In</button>
      <div id="admin-login-status" class="status-msg"></div>
    `;
    document.getElementById('admin-pw-toggle').addEventListener('click', () => {
      const input = document.getElementById('admin-pw-input');
      const btn = document.getElementById('admin-pw-toggle');
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    });

    async function doAdminLogin() {
      const pw = document.getElementById('admin-pw-input').value;
      const statusEl = document.getElementById('admin-login-status');
      statusEl.textContent = 'Checking...';
      statusEl.className = 'status-msg';

      const result = await adminGetEntries(pw);
      if (result.success) {
        adminPassword = pw;
        renderAdminEntries(result.data);
      } else {
        statusEl.textContent = result.error || 'Invalid password';
        statusEl.className = 'status-msg error';
      }
    }

    document.getElementById('admin-login-btn').addEventListener('click', doAdminLogin);
    document.getElementById('admin-pw-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdminLogin();
    });
    return;
  }

  loadAdminEntries();
}

async function loadAdminEntries() {
  const el = document.getElementById('admin-panel');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading entries...</p>`;
  const result = await adminGetEntries(adminPassword);
  if (!result.success) {
    adminPassword = null;
    renderAdminPanel();
    return;
  }
  renderAdminEntries(result.data);
}

function renderAdminEntries(entries) {
  const el = document.getElementById('admin-panel');
  adminEntriesCache = entries;

  const ctaVisible = currentConfig.showSignupCta !== false;
  const toggleHtml = `
    <div class="panel" style="margin-bottom:16px; display:flex; align-items:center; justify-content:space-between;">
      <span>Sign Up button on Home page</span>
      <label class="toggle-switch">
        <input type="checkbox" id="admin-toggle-cta" ${ctaVisible ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div id="admin-pending-moves"></div>
  `;

  loadAdminPendingMoves();

  if (entries.length === 0) {
    el.innerHTML = toggleHtml + `<p class="mono" style="color:var(--text-dim)">No entries yet.</p>`;
    wireAdminCtaToggle_();
    return;
  }

  el.innerHTML = toggleHtml + `
    <table>
      <thead><tr><th>Team</th><th>Owner</th><th>Email</th><th>Status</th><th>Paid</th><th>Actions</th></tr></thead>
      <tbody>
        ${entries.map(e => `
          <tr data-entry-id="${e.id}">
            <td>${escapeHtml(e.teamName)}</td>
            <td>${escapeHtml(e.ownerName)}</td>
            <td class="mono">${escapeHtml(e.email)}</td>
            <td>${e.approved ? '<span style="color:var(--ice)">Approved</span>' : '<span style="color:var(--amber)">Pending</span>'}</td>
            <td>${e.paymentReceived ? '<span style="color:var(--ice)">✓ Paid</span>' : '<span style="color:var(--text-dim)">Unpaid</span>'}</td>
            <td>
              ${!e.approved ? `<button class="admin-btn admin-approve" data-id="${e.id}">Approve</button>` : ''}
              <button class="admin-btn admin-view-picks" data-id="${e.id}">View Picks</button>
              <button class="admin-btn admin-edit-picks" data-id="${e.id}">Edit</button>
              <button class="admin-btn admin-resend-email" data-id="${e.id}">Resend Email</button>
              <button class="admin-btn admin-toggle-paid" data-id="${e.id}" data-paid="${e.paymentReceived ? '1' : '0'}">${e.paymentReceived ? 'Mark Unpaid' : 'Mark Paid'}</button>
              <button class="admin-btn admin-rename" data-id="${e.id}">Rename</button>
              <button class="admin-btn admin-delete" data-id="${e.id}">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;

  el.querySelectorAll('.admin-approve').forEach(btn => {
    btn.addEventListener('click', async () => {
      await adminApproveEntry(adminPassword, btn.dataset.id);
      loadAdminEntries();
    });
  });

  el.querySelectorAll('.admin-view-picks').forEach(btn => {
    btn.addEventListener('click', () => {
      openAdminPicksModal(btn.dataset.id);
    });
  });

  el.querySelectorAll('.admin-edit-picks').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = adminEntriesCache.find(e => e.id === btn.dataset.id);
      if (entry) startEditingEntry(entry);
    });
  });

  el.querySelectorAll('.admin-resend-email').forEach(btn => {
    btn.addEventListener('click', async () => {
      const originalText = btn.textContent;
      btn.textContent = 'Sending...';
      btn.disabled = true;
      const result = await adminResendEmail(adminPassword, btn.dataset.id);
      btn.textContent = result.success ? 'Sent!' : 'Failed';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
    });
  });

  el.querySelectorAll('.admin-toggle-paid').forEach(btn => {
    btn.addEventListener('click', async () => {
      const currentlyPaid = btn.dataset.paid === '1';
      await adminSetPayment(adminPassword, btn.dataset.id, !currentlyPaid);
      loadAdminEntries();
    });
  });

  el.querySelectorAll('.admin-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry permanently?')) return;
      await adminRejectEntry(adminPassword, btn.dataset.id);
      loadAdminEntries();
    });
  });

  el.querySelectorAll('.admin-rename').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newName = prompt('New team name:');
      if (!newName) return;
      await adminUpdateEntry(adminPassword, btn.dataset.id, { teamName: newName });
      loadAdminEntries();
    });
  });

  wireAdminCtaToggle_();
}

async function loadAdminPendingMoves() {
  const container = document.getElementById('admin-pending-moves');
  if (!container) return;
  container.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Loading pending moves...</p>`;

  const result = await adminGetPendingMoves(adminPassword);
  if (!result.success || !result.data || result.data.length === 0) {
    container.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px; margin-bottom:16px;">No pending moves.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h3 style="margin-bottom:12px;">Pending Moves (${result.data.length})</h3>
      ${result.data.map(m => `
        <div class="activity-row">
          <span><strong>${escapeHtml(m.teamName)}</strong> — ${escapeHtml(m.boxLabel)}: ${escapeHtml(m.outPlayerName)} → ${escapeHtml(m.inPlayerName)}</span>
          <span>
            <button class="admin-btn admin-approve-move" data-id="${m.moveId}">Approve</button>
            <button class="admin-btn admin-reject-move" data-id="${m.moveId}">Reject</button>
          </span>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.admin-approve-move').forEach(btn => {
    btn.addEventListener('click', async () => {
      await adminApproveMove(adminPassword, btn.dataset.id);
      loadAdminPendingMoves();
      loadAdminEntries();
    });
  });

  container.querySelectorAll('.admin-reject-move').forEach(btn => {
    btn.addEventListener('click', async () => {
      await adminRejectMove(adminPassword, btn.dataset.id);
      loadAdminPendingMoves();
    });
  });
}

function wireAdminCtaToggle_() {
  const checkbox = document.getElementById('admin-toggle-cta');
  if (!checkbox) return;
  checkbox.addEventListener('change', async () => {
    const newVisible = checkbox.checked;
    const result = await adminUpdateConfig(adminPassword, { showSignupCta: newVisible });
    if (result.success) {
      currentConfig.showSignupCta = newVisible;
      applySignupCtaVisibility();
    } else {
      checkbox.checked = !newVisible; // revert on failure
    }
  });
}

// ---------- Utility ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function handleDeepLink_() {
  const params = new URLSearchParams(window.location.search);
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
