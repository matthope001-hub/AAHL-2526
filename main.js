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
  list.sort((a, b) => computePlayerPoints(b.stats) - computePlayerPoints(a.stats));
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
            <td class="pts">${computePlayerPoints(p.stats)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

document.getElementById('player-search').addEventListener('input', (e) => {
  renderPlayersTable(e.target.value);
});

// ---------- Signup ----------
const POSITION_MAP = { F: ['C', 'L', 'R'], D: ['D'], G: ['G'] };
const BOX_TITLES = { F: 'Forwards', D: 'Defense', G: 'Goalies' };

let signupPicks = { F: [], D: [], G: [] };

function renderSignupForm() {
  signupPicks = { F: [], D: [], G: [] };
  const el = document.getElementById('signup-form');
  el.innerHTML = `
    <label>Team Name</label>
    <input type="text" id="f-teamName">
    <label>Owner Name</label>
    <input type="text" id="f-ownerName">
    <label>Email</label>
    <input type="email" id="f-email">
    <label>Box</label>
    <select id="f-boxLabel">
      <option>Box A</option><option>Box B</option><option>Box C</option>
    </select>

    ${Object.keys(BOX_LIMITS).map(box => `
      <div class="picker-section">
        <label style="margin-top:24px;">${BOX_TITLES[box]} <span class="mono picker-count" id="count-${box}">0 / ${BOX_LIMITS[box]}</span></label>
        <input type="text" class="search-input mono picker-search" id="search-${box}" placeholder="Search ${BOX_TITLES[box].toLowerCase()}...">
        <div class="picker-results" id="results-${box}"></div>
        <div class="picker-chips" id="chips-${box}"></div>
      </div>
    `).join('')}

    <button id="submit-entry-btn">Submit Entry</button>
    <div id="signup-status" class="status-msg"></div>
  `;

  Object.keys(BOX_LIMITS).forEach(box => {
    document.getElementById(`search-${box}`).addEventListener('input', (e) => {
      renderPickerResults(box, e.target.value);
    });
    renderPickerChips(box);
  });

  document.getElementById('submit-entry-btn').addEventListener('click', handleSubmitEntry);
}

function renderPickerResults(box, query) {
  const resultsEl = document.getElementById(`results-${box}`);
  if (!query || query.trim().length < 2) {
    resultsEl.innerHTML = '';
    return;
  }
  const q = query.toLowerCase();
  const positions = POSITION_MAP[box];
  const matches = allPlayers
    .filter(p => positions.includes(p.position))
    .filter(p => (p.fullName || '').toLowerCase().includes(q))
    .filter(p => !signupPicks[box].includes(p.id))
    .slice(0, 8);

  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="picker-empty mono">No matches.</div>`;
    return;
  }

  resultsEl.innerHTML = matches.map(p => `
    <div class="picker-row" data-player-id="${p.id}" data-box="${box}">
      <span>${escapeHtml(p.fullName)}</span>
      <span class="mono picker-meta">${escapeHtml(p.team || '')} · ${escapeHtml(p.position || '')}</span>
    </div>
  `).join('');

  resultsEl.querySelectorAll('.picker-row').forEach(row => {
    row.addEventListener('click', () => {
      addPick(row.dataset.box, row.dataset.playerId);
    });
  });
}

function addPick(box, playerId) {
  if (signupPicks[box].length >= BOX_LIMITS[box]) return;
  if (signupPicks[box].includes(playerId)) return;
  signupPicks[box].push(playerId);
  document.getElementById(`search-${box}`).value = '';
  document.getElementById(`results-${box}`).innerHTML = '';
  renderPickerChips(box);
}

function removePick(box, playerId) {
  signupPicks[box] = signupPicks[box].filter(id => id !== playerId);
  renderPickerChips(box);
}

function renderPickerChips(box) {
  const chipsEl = document.getElementById(`chips-${box}`);
  const countEl = document.getElementById(`count-${box}`);
  countEl.textContent = `${signupPicks[box].length} / ${BOX_LIMITS[box]}`;
  countEl.style.color = signupPicks[box].length === BOX_LIMITS[box] ? 'var(--ice)' : 'var(--text-dim)';

  chipsEl.innerHTML = signupPicks[box].map(id => {
    const player = allPlayers.find(p => p.id === id);
    const name = player ? player.fullName : id;
    return `<span class="chip">${escapeHtml(name)} <span class="chip-remove" data-box="${box}" data-id="${id}">&times;</span></span>`;
  }).join('');

  chipsEl.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => removePick(btn.dataset.box, btn.dataset.id));
  });
}

async function handleSubmitEntry() {
  const teamName = document.getElementById('f-teamName').value.trim();
  const ownerName = document.getElementById('f-ownerName').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const boxLabel = document.getElementById('f-boxLabel').value;
  const statusEl = document.getElementById('signup-status');

  if (!teamName || !ownerName || !email) {
    statusEl.textContent = 'Fill in team name, owner name, and email.';
    statusEl.className = 'status-msg error';
    return;
  }

  for (const box of Object.keys(BOX_LIMITS)) {
    if (signupPicks[box].length !== BOX_LIMITS[box]) {
      statusEl.textContent = `${BOX_TITLES[box]}: need exactly ${BOX_LIMITS[box]}, have ${signupPicks[box].length}.`;
      statusEl.className = 'status-msg error';
      return;
    }
  }

  statusEl.textContent = 'Submitting...';
  statusEl.className = 'status-msg';

  const result = await submitEntry({
    teamName, ownerName, email, boxLabel,
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
