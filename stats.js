/**
 * stats.js
 * Players table, Rules, Last Night, Season 3 Stars Tally, Boxes reference.
 * Plain script (shared global scope with data.js, main.js, stats.js,
 * signup.js, admin.js). Load order in index.html: data.js, stats.js,
 * signup.js, admin.js, main.js (main.js LAST - it calls init()).
 */

// ---------- Players ----------
let playerFilter = 'all';
let playerSort = { column: 'pts', dir: 'desc' };

const PLAYER_COLUMNS = [
  { key: 'name', label: 'Player', title: 'Player Name', sortable: false, filters: ['all', 'F', 'D', 'G'] },
  { key: 'team', label: 'NHL', title: 'NHL Team', sortable: false, filters: ['all', 'F', 'D', 'G'] },
  { key: 'position', label: 'Pos', title: 'Position', sortable: false, filters: ['all', 'F', 'D', 'G'] },
  { key: 'gamesPlayed', label: 'GP', title: 'Games Played', sortable: true, filters: ['all', 'F', 'D', 'G'] },
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
  { key: 'picked', label: 'Picked', title: 'Pool teams that picked this player', sortable: true, filters: ['all', 'F', 'D', 'G'] },
  { key: 'pts', label: 'Pts', title: 'Fantasy Points', sortable: true, filters: ['all', 'F', 'D', 'G'] }
];

// How many pool teams picked each player / division winner (PickCounts.gs).
// null until loaded; total is 0 until picks are locked.
let pickCounts = null;
async function ensurePickCountsLoaded_() {
  if (pickCounts) return;
  try { pickCounts = await fetchPickCounts(); } catch (e) { pickCounts = null; }
}
function hasPickCounts_() { return !!(pickCounts && pickCounts.total > 0); }
function pickedCount_(playerId) { return (hasPickCounts_() && pickCounts.players && pickCounts.players[playerId]) || 0; }
/** " · 18 of 47 picked" for the Boxes page ('' until counts exist). */
function pickedSuffix_(count) {
  return hasPickCounts_() ? ` <span style="color:var(--amber); white-space:nowrap;">· ${count} of ${pickCounts.total} picked</span>` : '';
}

function playerColumnValue(p, key) {
  if (key === 'pts') return computePlayerPoints(p, currentConfig);
  if (key === 'picked') return pickedCount_(p.id);
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

  const visibleColumns = PLAYER_COLUMNS.filter(col => col.filters.includes(playerFilter) && (col.key !== 'picked' || hasPickCounts_()));

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
    name: (p) => `${escapeHtml(p.fullName)}${p.injuryStatus ? ` <span class="ir-badge" title="Status: ${escapeHtml(p.injuryStatus)}">🩹 ${escapeHtml(p.injuryStatus)}</span>` : ''}`,
    team: (p) => escapeHtml(p.team || ''),
    position: (p) => escapeHtml(p.position || ''),
    gamesPlayed: (p) => (p.stats && p.stats.gamesPlayed) || 0,
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
    picked: (p) => `${pickedCount_(p.id)}<span style="color:var(--text-dim);">/${pickCounts.total}</span>`,
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
    : `Current pot is <strong>$${pot.toFixed(0)}</strong> — $1,000+ tier applies (30% / 15% / 5% split).`;

  const sections = [
    { title: '💰 Entry & Payments', html: `
      <p style="margin-bottom:6px;">Entry fee: <strong>$${c.entryFee ?? 10}</strong> per entry (unlimited entries allowed).</p>
      <p style="margin-bottom:6px;">Payment: E-transfer to <strong>${escapeHtml(c.commissionerEmail || 'matt.hope@rocketmail.com')}</strong>. Please include your first and last name in the transfer notes.</p>
      <p style="margin-bottom:0;">Deadline: All entries and payments are due before puck drop on <strong>Tuesday, September 29, 2026, at 5:00 PM</strong> (Panthers vs. Hurricanes).</p>
    ` },
    { title: '📋 How to Play', html: `
      <p style="margin-bottom:6px;">Make 31 total picks: 1 choice from each of the 27 player boxes (16 Forwards, 5 Defense, 6 Goalies), plus 4 division winners.</p>
      <p style="margin-bottom:0;">Standings update regularly all season via this live tracking site once games begin.</p>
    ` },
    { title: '📊 Point System', html: `
      <div class="scoring-grid" style="margin-bottom:0;">
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
              <tr><td>Correct 1st-place pick (season end)</td><td class="pts scoring-value hat-trick">+25</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    ` },
    { title: '🏆 Payouts (50/50 Split)', html: `
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
      <p style="margin-bottom:0; color:var(--text-dim); font-size:13px;">Live payout amounts based on the current pot are shown on the <a href="#" data-view="standings" class="rules-inline-link">Standings page</a>.</p>
    ` },
    { title: '🔄 Roster Moves', html: `
      <p style="margin-bottom:6px;"><strong>Before the season starts</strong> (before puck drop, Sep 29, 2026, 5:00 PM):</p>
      <p style="margin-bottom:4px;">• Unlimited changes to your player picks and division picks</p>
      <p style="margin-bottom:4px;">• Instant — no approval needed, applies immediately</p>
      <p style="margin-bottom:16px;">• Doesn't use up any of your season moves</p>
      <p style="margin-bottom:6px;"><strong>Once the season starts:</strong></p>
      <p style="margin-bottom:4px;">• You get exactly 2 roster moves total for the rest of the season (player boxes only — division picks lock permanently once the season begins)</p>
      <p style="margin-bottom:4px;">• Every move needs commissioner approval before it counts — you'll get a confirmation email once it's finalized</p>
      <p style="margin-bottom:4px;">• Scored fairly regardless of approval speed: the swap takes effect at the moment you request it, not when it's approved</p>
      <p style="margin-bottom:16px;">• Hard deadline: no move requests accepted after the NHL trade deadline — <strong>Monday, March 1, 2027</strong></p>
      <p style="margin-bottom:0; color:var(--text-dim); font-size:13px;">Manage your picks and request moves on the <a href="#" data-view="managemoves" class="rules-inline-link">My Team page</a>, using the Entry ID from your confirmation email.</p>
    ` },
    { title: '⚖️ Tiebreaker', html: `
      <p style="margin-bottom:4px;">1. Highest combined goals + assists across your roster.</p>
      <p style="margin-bottom:0;">2. If still tied: total goalie saves.</p>
    ` },
    { title: '📖 Roster Reference', html: `
      <p style="margin-bottom:0;">The players available in each box, with current-season stats, are on the <a href="#" data-view="boxes" class="rules-inline-link">Boxes page</a>. Injured players are flagged automatically each night from live NHL data.</p>
    ` },
    { title: "👀 Viewing Other Teams' Picks", html: `
      <p style="margin-bottom:0;">Once picks lock, any team name on the Standings page becomes clickable — showing that team's full roster and stat line for every pick, including full move history and points banked from any swaps. Before lock, picks stay private to keep strategy fair.</p>
    ` }
  ];

  el.innerHTML = `
    <p style="margin-bottom:20px; color:var(--amber); font-weight:700; font-size:16px;">🏒 2026–2027 Wedding Fundraiser NHL Box Pool 🏒</p>
    <p style="margin-bottom:20px;">Help support Mackenzie and Dan (the bride and groom) with their wedding costs while competing for cash!</p>
    <div class="rules-accordion">
      ${sections.map((s, i) => `
        <div class="rules-accordion-item ${i === 0 ? 'open' : ''}">
          <button class="rules-accordion-header" type="button">
            <span>${s.title}</span>
            <span class="rules-accordion-chevron">▾</span>
          </button>
          <div class="rules-accordion-body"><div class="rules-accordion-body-inner">${s.html}</div></div>
        </div>
      `).join('')}
    </div>
  `;

  el.querySelectorAll('.rules-accordion-header').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.rules-accordion-item').classList.toggle('open');
    });
  });

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
  el.innerHTML = `${skeletonLoader_()}`;

  // Season tally loads in parallel with last night's stats.
  const tallyHtmlPromise = buildSeasonStarsTallyHtml_();

  try {
    const stars = await fetchStarsOfNight();
    const performers = (stars && stars.allPerformers || []).filter(p => poolPlayerIds.has(p.playerId));

    if (!stars || performers.length === 0) {
      el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No games played yet.</p>`;
      el.insertAdjacentHTML('beforeend', await tallyHtmlPromise);
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
      <div id="lastnight-team"></div>
      <h3 class="group-title" style="margin-top:28px;">All Pool Players</h3>
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
    renderLastNightTeamPanel_(stars);
    el.insertAdjacentHTML('beforeend', await tallyHtmlPromise);
  } catch (e) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No games played yet.</p>`;
  }
}

// ---------- Last Night: How Each Team Did ----------
let lastNightTeamId = null;

/**
 * "How Did Your Team Do?" panel at the top of Last Night: pick a team and
 * see which of its players played, what they did, and the team's total
 * for the night. Also lists the night's top teams (click one to open it).
 * The chosen team is remembered on this device.
 */
function renderLastNightTeamPanel_(stars) {
  const wrap = document.getElementById('lastnight-team');
  if (!wrap) return;

  const teams = (allStandings || []).filter(e => e.entryId);
  if (teams.length === 0) { wrap.innerHTML = ''; return; }

  if (!lastNightTeamId) {
    try { lastNightTeamId = localStorage.getItem('aahl_lastNightTeam'); } catch (e) { /* ignore */ }
  }
  if (!teams.some(t => t.entryId === lastNightTeamId)) lastNightTeamId = null;

  const byName = [...teams].sort((a, b) => (a.teamName || '').localeCompare(b.teamName || ''));
  const topNights = [...teams].filter(t => (t.ptsDelta || 0) > 0)
    .sort((a, b) => b.ptsDelta - a.ptsDelta).slice(0, 5);

  wrap.innerHTML = `
    <h3 class="group-title">How Did Your Team Do?</h3>
    <div class="panel" style="margin-bottom:16px;">
      <select id="lastnight-team-select" style="max-width:320px; margin:0 0 4px 0;">
        <option value="">Pick a team...</option>
        ${byName.map(t => `<option value="${escapeHtml(t.entryId)}" ${t.entryId === lastNightTeamId ? 'selected' : ''}>${escapeHtml(t.teamName)}</option>`).join('')}
      </select>
      <div id="lastnight-team-detail"></div>
    </div>
    ${topNights.length ? `
      <h3 class="group-title">Best Team Nights</h3>
      <div class="panel" style="margin-bottom:16px;">
        ${top