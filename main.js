/**
 * main.js
 * UI rendering, navigation, and interaction logic.
 * Depends on data.js
 */

let allPlayers = [];
let allStandings = [];
let currentConfig = {};

// ---------- Navigation ----------
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const view = link.dataset.view;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`view-${view}`).classList.add('active');

    if (view === 'standings') renderStandingsTable();
    if (view === 'players') renderPlayersTable();
    if (view === 'signup') renderSignupForm();
    if (view === 'admin') renderAdminPanel();
  });
});

// ---------- Init ----------
async function init() {
  [allPlayers, allStandings, currentConfig] = await Promise.all([
    fetchPlayers(), fetchStandings(), fetchConfig()
  ]);

  document.getElementById('deadline-display').textContent = formatDeadline(currentConfig.deadline);
  renderHomeStandingsPreview();
}

// ---------- Home ----------
function renderHomeStandingsPreview() {
  const top5 = [...allStandings].sort((a, b) => a.rank - b.rank).slice(0, 5);
  const el = document.getElementById('home-standings-preview');
  if (top5.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No approved entries yet.</p>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>Rank</th><th>Team</th><th>Box</th><th>Pts</th></tr></thead>
      <tbody>
        ${top5.map(e => `
          <tr>
            <td class="${e.rank === 1 ? 'rank-1' : ''}">${e.rank}</td>
            <td>${escapeHtml(e.teamName)}</td>
            <td>${escapeHtml(e.boxLabel || '')}</td>
            <td class="pts">${e.pts}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------- Standings ----------
function renderStandingsTable() {
  const el = document.getElementById('standings-table');
  const sorted = [...allStandings].sort((a, b) => a.rank - b.rank);
  if (sorted.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No approved entries yet.</p>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>Rank</th><th>Team</th><th>Box</th><th>Points</th></tr></thead>
      <tbody>
        ${sorted.map(e => `
          <tr>
            <td class="${e.rank === 1 ? 'rank-1' : ''}">${e.rank}</td>
            <td>${escapeHtml(e.teamName)}</td>
            <td>${escapeHtml(e.boxLabel || '')}</td>
            <td class="pts">${e.pts}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------- Players ----------
function renderPlayersTable(filter) {
  const el = document.getElementById('players-table');
  let list = [...allPlayers];
  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(p => (p.fullName || '').toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q));
  }
  list.sort((a, b) => computePlayerPoints(b, currentConfig) - computePlayerPoints(a, currentConfig));
  list = list.slice(0, 100);

  el.innerHTML = `
    <table>
      <thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>G</th><th>A</th><th>Pts</th></tr></thead>
      <tbody>
        ${list.map(p => `
          <tr>
            <td>${escapeHtml(p.fullName)}${p.injuryStatus ? ' <span style="color:#ff5c5c">IR</span>' : ''}</td>
            <td>${escapeHtml(p.team || '')}</td>
            <td>${escapeHtml(p.position || '')}</td>
            <td>${(p.stats && p.stats.goals) || 0}${p.stats && p.stats.hatTricks ? ` <span class="hat-trick">(${p.stats.hatTricks} HT)</span>` : ''}</td>
            <td>${(p.stats && p.stats.assists) || 0}</td>
            <td class="pts">${computePlayerPoints(p, currentConfig).toFixed(2)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

document.getElementById('player-search').addEventListener('input', (e) => {
  renderPlayersTable(e.target.value);
});

// ---------- Signup ----------
let allBoxes = [];
let signupPicks = {}; // { boxId: playerId }

async function renderSignupForm() {
  signupPicks = {};
  const el = document.getElementById('signup-form');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading boxes...</p>`;

  if (allBoxes.length === 0) {
    allBoxes = await fetchBoxes();
  }

  const grouped = { F: [], D: [], G: [] };
  allBoxes.forEach(b => grouped[b.boxType].push(b));
  const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };

  el.innerHTML = `
    <label>Team Name</label>
    <input type="text" id="f-teamName">
    <label>Owner Name</label>
    <input type="text" id="f-ownerName">
    <label>Email</label>
    <input type="email" id="f-email">
    <div class="picks-count mono" id="picks-count">0 / ${TOTAL_BOXES} picked</div>

    ${Object.keys(groupTitles).map(type => `
      <h3 class="group-title">${groupTitles[type]}</h3>
      ${grouped[type].map(box => `
        <div class="box-picker">
          <div class="box-picker-label">${escapeHtml(box.boxLabel)}</div>
          <div class="box-picker-options">
            ${box.players.map(p => {
              const fullPlayer = allPlayers.find(ap => ap.id === p.playerId);
              const currentTeam = fullPlayer ? fullPlayer.team : p.team;
              const headshot = fullPlayer ? fullPlayer.headshotUrl : '';
              const currentSeasonHasStats = fullPlayer && fullPlayer.stats && Object.values(fullPlayer.stats).some(v => v > 0);
              const s = fullPlayer ? (currentSeasonHasStats ? fullPlayer.stats : (fullPlayer.prevStats || {})) : {};
              const statSourceLabel = currentSeasonHasStats ? '' : ` <span class="stat-source">(25-26)</span>`;
              const pts = fullPlayer ? computePlayerPoints({ position: fullPlayer.position, stats: s }, currentConfig).toFixed(1) : '0.0';
              const statLine = box.boxType === 'G'
                ? `${s.wins || 0}W · ${s.shutouts || 0}SO · ${pts}pts${statSourceLabel}`
                : `${s.goals || 0}G · ${s.assists || 0}A${s.hatTricks ? ` · ${s.hatTricks}HT` : ''} · ${pts}pts${statSourceLabel}`;
              const cardStats = box.boxType === 'G'
                ? `${s.wins || 0}W ${s.losses || 0}L ${s.otl || 0}OTL &middot; ${s.shutouts || 0} SO &middot; ${s.saves || 0} SV`
                : `${s.goals || 0}G ${s.assists || 0}A ${s.sog || 0}SOG${box.boxType === 'D' ? ` ${s.pim || 0}PIM` : ''}${s.hatTricks ? ` &middot; ${s.hatTricks} HT` : ''}`;
              return `
              <label class="box-option">
                <input type="radio" name="box-${box.id}" value="${p.playerId}" data-box="${box.id}">
                <span class="box-option-photo-wrap">
                  ${headshot ? `<img class="box-option-photo" src="${headshot}" alt="" loading="lazy">` : `<div class="box-option-photo box-option-photo-empty"></div>`}
                  ${headshot ? `
                  <div class="player-hover-card">
                    <img class="player-hover-photo" src="${headshot}" alt="">
                    <div class="player-hover-name">${escapeHtml(p.name)}</div>
                    <div class="player-hover-team mono">${escapeHtml(currentTeam)} ${currentSeasonHasStats ? '· 26-27' : '· 25-26 (last season)'}</div>
                    <div class="player-hover-stats mono">${cardStats}</div>
                    <div class="player-hover-pts mono">${pts} pts</div>
                  </div>` : ''}
                </span>
                <span class="box-option-name">${escapeHtml(p.name)}</span>
                <span class="mono box-option-stats">${statLine}</span>
                <span class="mono box-option-meta">${escapeHtml(currentTeam)}</span>
              </label>
            `;}).join('')}
          </div>
        </div>
      `).join('')}
    `).join('')}

    <button id="submit-entry-btn">Submit Entry</button>
    <div id="signup-status" class="status-msg"></div>
  `;

  el.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      signupPicks[radio.dataset.box] = radio.value;
      updatePicksCount();
    });
  });

  document.getElementById('submit-entry-btn').addEventListener('click', handleSubmitEntry);
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

  if (Object.keys(signupPicks).length !== TOTAL_BOXES) {
    statusEl.textContent = `Pick a player in every box (${Object.keys(signupPicks).length} / ${TOTAL_BOXES} done).`;
    statusEl.className = 'status-msg error';
    return;
  }

  statusEl.textContent = 'Submitting...';
  statusEl.className = 'status-msg';

  const result = await submitEntry({
    teamName, ownerName, email,
    picks: signupPicks
  });

  if (result.success) {
    statusEl.textContent = `Entry submitted! ID: ${result.entryId}`;
    statusEl.className = 'status-msg success';
  } else {
    statusEl.textContent = 'Error: ' + result.error;
    statusEl.className = 'status-msg error';
  }
}

// ---------- Admin ----------
async function renderAdminPanel() {
  const el = document.getElementById('admin-panel');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading...</p>`;
  const irList = await fetchIRList();
  el.innerHTML = `
    <h3 style="margin-bottom:12px; font-size:20px;">IR List (${irList.length})</h3>
    <table>
      <thead><tr><th>Player ID</th><th>Note</th><th>Flagged</th></tr></thead>
      <tbody>
        ${irList.map(p => `<tr><td>${escapeHtml(p.id)}</td><td>${escapeHtml(p.note || '')}</td><td class="mono">${escapeHtml(p.flaggedAt || '')}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

// ---------- Utility ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

init();
