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
function renderSignupForm() {
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
    <p style="color:var(--text-dim); margin-top:20px; font-size:14px;">
      Player picker UI coming — for now, roster submission is handled by the commissioner during signup review.
    </p>
    <button id="submit-entry-btn">Submit Entry</button>
    <div id="signup-status" class="status-msg"></div>
  `;

  document.getElementById('submit-entry-btn').addEventListener('click', async () => {
    const teamName = document.getElementById('f-teamName').value.trim();
    const ownerName = document.getElementById('f-ownerName').value.trim();
    const email = document.getElementById('f-email').value.trim();
    const boxLabel = document.getElementById('f-boxLabel').value;
    const statusEl = document.getElementById('signup-status');

    if (!teamName || !ownerName || !email) {
      statusEl.textContent = 'Fill in all fields.';
      statusEl.className = 'status-msg error';
      return;
    }

    statusEl.textContent = 'Submitting...';
    statusEl.className = 'status-msg';

    // Placeholder picks until player-picker UI is built
    const result = await submitEntry({
      teamName, ownerName, email, boxLabel,
      picks: { F: [], D: [], G: [] }
    });

    if (result.success) {
      statusEl.textContent = `Entry submitted! ID: ${result.entryId}`;
      statusEl.className = 'status-msg success';
    } else {
      statusEl.textContent = 'Error: ' + result.error;
      statusEl.className = 'status-msg error';
    }
  });
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
