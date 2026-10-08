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
  return hasPickCounts_() ? ` <span style="color:var(--amber); white-space:nowrap; margin-left:6px;">${count} of ${pickCounts.total} picked</span>` : '';
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
    name: (p) => playerCellHtml_(p.fullName, p.headshotUrl, p.team, p.position, p.id),
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
      <table class="data-table">
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
      <p class="mono" style="color:var(--text-dim); font-size:13px; margin-bottom:16px;">${escapeHtml(dateFormatted)} <span class="updated-stamp" data-stamp="stats" style="margin-left:8px;"></span></p>
      <div id="lastnight-team"></div>
      <h3 class="group-title" style="margin-top:28px;">All Pool Players</h3>
      ${Object.keys(groupTitles).map(g => {
        if (grouped[g].length === 0) return '';
        return `
        <h3 class="group-title">${groupTitles[g]}</h3>
        <div class="panel" style="margin-bottom:16px;">
          <table class="data-table lastnight-table">
            <thead>
              <tr>
                <th data-sort="text">Player</th>
                ${g === 'G' ? '<th data-sort="text">Dec</th><th data-sort="text">SO</th><th data-sort="num">SV</th>' : `<th data-sort="num">G</th><th data-sort="num">A</th><th data-sort="num">SOG</th>${g === 'D' ? '<th data-sort="num">PIM</th>' : ''}`}
                <th data-sort="num" class="sorted-col">Pts ▼</th>
              </tr>
            </thead>
            <tbody>
              ${grouped[g].map(p => `
                <tr>
                  <td data-v="${escapeHtml(p.fullName)}">${playerCellHtml_(p.fullName, p.headshotUrl, p.team, p.isGoalie ? 'G' : p.position, p.playerId)}</td>
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
    el.querySelectorAll('.lastnight-table').forEach(tbl => {
      makeTableSortable_(tbl);
      const pts = tbl.querySelector('th.sorted-col');
      if (pts) { pts.dataset.dir = 'desc'; } // already sorted by points
    });
    fillUpdatedStamps_();
    el.insertAdjacentHTML('beforeend', await tallyHtmlPromise);
    makeTableSortable_(el.querySelector('.tally-table'));
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
        ${topNights.map((t, i) => `
          <div class="activity-row">
            <span><span class="mono" style="color:var(--text-dim); margin-right:8px;">${i + 1}</span><span class="team-link" data-night-team="${escapeHtml(t.entryId)}">${escapeHtml(t.teamName)}</span></span>
            <span class="mono" style="color:#3ecf6a; font-weight:700;">+${t.ptsDelta.toFixed(2)}</span>
          </div>`).join('')}
      </div>` : ''}
  `;

  const select = document.getElementById('lastnight-team-select');
  const choose = (id) => {
    lastNightTeamId = id || null;
    try {
      if (id) localStorage.setItem('aahl_lastNightTeam', id);
      else localStorage.removeItem('aahl_lastNightTeam');
    } catch (e) { /* ignore */ }
    select.value = id || '';
    renderLastNightTeamDetail_(stars);
  };
  select.addEventListener('change', () => choose(select.value));
  wrap.querySelectorAll('[data-night-team]').forEach(link => {
    link.addEventListener('click', () => {
      choose(link.dataset.nightTeam);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  renderLastNightTeamDetail_(stars);
}

async function renderLastNightTeamDetail_(stars) {
  const el = document.getElementById('lastnight-team-detail');
  if (!el) return;
  if (!lastNightTeamId) { el.innerHTML = ''; return; }

  const requestedId = lastNightTeamId;
  el.innerHTML = skeletonLoader_();
  const data = await fetchEntryPicks(requestedId);
  if (requestedId !== lastNightTeamId) return; // a different team was picked meanwhile

  if (!data || data.error) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px; margin-top:12px;">${escapeHtml((data && data.error) || "Couldn't load this team.")}</p>`;
    return;
  }

  const perfById = {};
  (stars.allPerformers || []).forEach(p => { perfById[p.playerId] = p; });

  const picks = data.picks || [];
  const played = picks.filter(p => perfById[p.playerId])
    .map(p => ({ pick: p, perf: perfById[p.playerId] }))
    .sort((a, b) => b.perf.pts - a.perf.pts);
  const idle = picks.filter(p => !perfById[p.playerId]);
  const total = played.reduce((sum, x) => sum + (x.perf.pts || 0), 0);

  const chipsFor = (perf, boxType) => (perf.isGoalie
    ? [perf.decision === 'W' ? 'W' : perf.decision === 'L' ? 'L' : (perf.decision ? 'OTL' : null), perf.shutout ? 'SO' : null, `${perf.saves || 0} SV`]
    : [`${perf.goals || 0} G`, `${perf.assists || 0} A`, `${perf.sog || 0} SOG`, boxType === 'D' ? `${perf.pim || 0} PIM` : null]
  ).filter(Boolean);

  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; margin:14px 0 10px; padding-bottom:10px; border-bottom:1px solid var(--border, rgba(255,255,255,0.1));">
      <div>
        <div style="font-size:22px; font-weight:700;">${escapeHtml(data.teamName)}</div>
        <div class="mono" style="color:var(--text-dim); font-size:12px;">${played.length} of ${picks.length} players played</div>
      </div>
      <div style="text-align:right;">
        <div class="mono" style="color:var(--ice); font-size:28px; font-weight:700; line-height:1;">+${total.toFixed(2)}</div>
        <div class="mono" style="color:var(--text-dim); font-size:11px;">pts last night</div>
      </div>
    </div>
    ${played.length === 0
      ? `<p class="mono" style="color:var(--text-dim); font-size:13px;">None of this team's players played last night.</p>`
      : played.map(({ pick, perf }) => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border, rgba(255,255,255,0.06));">
          ${pick.headshotUrl ? `<img class="modal-pick-photo" style="width:36px; height:36px;" src="${pick.headshotUrl}" alt="" loading="lazy">` : `<div class="modal-pick-photo modal-pick-photo-empty" style="width:36px; height:36px;"></div>`}
          <div style="flex:1; min-width:0;">
            <div style="font-weight:700;">${escapeHtml(pick.playerName)} <span class="mono" style="color:var(--text-dim); font-size:11px; font-weight:400;">${escapeHtml(perf.team || pick.team || '')} · ${escapeHtml(pick.boxType || '')}</span></div>
            <div class="star-chips" style="margin-top:4px;">${chipsFor(perf, pick.boxType).map(c => `<span class="stat-chip">${escapeHtml(c)}</span>`).join('')}</div>
          </div>
          <div class="mono" style="color:var(--ice); font-weight:700; white-space:nowrap;">+${(perf.pts || 0).toFixed(2)}</div>
        </div>`).join('')}
    ${idle.length ? `
      <details style="margin-top:12px;">
        <summary class="mono" style="color:var(--text-dim); font-size:12px; cursor:pointer;">${idle.length} didn't play</summary>
        <p class="mono" style="color:var(--text-dim); font-size:12px; line-height:1.7; margin-top:6px;">${idle.map(p => escapeHtml(p.playerName) + statusBadge_(p.playerId)).join(' · ')}</p>
      </details>` : ''}
  `;
}

// ---------- Points Race chart (Standings page) ----------
// Line chart of how far each team is behind 1st place, night by night.
// Current top 5 in colour, every other team in faint grey, plus one team
// of your choice in white (remembered with the Last Night team picker).
const RACE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
let pointsRaceData_ = null;
let pointsRaceResizeWired_ = false;

async function renderPointsRace() {
  const wrap = document.getElementById('points-race');
  if (!wrap) return;
  try {
    pointsRaceData_ = await fetchPointsRace();
    drawPointsRace_();
    if (!pointsRaceResizeWired_) {
      pointsRaceResizeWired_ = true;
      let timer = null;
      window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(drawPointsRace_, 150); });
    }
  } catch (e) {
    wrap.style.display = 'none';
  }
}

function drawPointsRace_() {
  const wrap = document.getElementById('points-race');
  const data = pointsRaceData_;
  if (!wrap) return;
  if (!data || !data.dates || data.dates.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  const dates = data.dates;
  const n = dates.length;
  const last = n - 1;

  // Gap to the leader on each night (0 = in first place).
  const leader = dates.map((_, d) => Math.max(...Object.values(data.teams).map(t => (t.pts[d] == null ? -Infinity : t.pts[d]))));
  const teams = Object.keys(data.teams).map(id => {
    const t = data.teams[id];
    return { id, name: t.name, pts: t.pts, gap: t.pts.map((v, d) => (v == null ? null : v - leader[d])) };
  }).filter(t => t.pts[last] != null).sort((a, b) => b.pts[last] - a.pts[last]);
  if (teams.length === 0) { wrap.style.display = 'none'; return; }

  let myId = null;
  try { myId = localStorage.getItem('aahl_lastNightTeam'); } catch (e) { /* ignore */ }
  const top = teams.slice(0, 5);
  const mine = teams.find(t => t.id === myId) || null;
  const mineInTop = mine && top.includes(mine);
  const shown = mine && !mineInTop ? top.concat([mine]) : top;
  const colorOf = (t) => (top.includes(t) ? RACE_COLORS[top.indexOf(t)] : '#e8edf1');

  // Layout. Names sit to the right of the chart on wide screens, below it on phones.
  wrap.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
      <h3 class="mini-title" style="margin:0;">Points Race <span class="mono" style="font-weight:400; font-size:12px; text-transform:none; letter-spacing:0;">points behind 1st place</span></h3>
      <select id="points-race-team" style="max-width:240px; margin:0;">
        <option value="">Highlight a team...</option>
        ${[...teams].sort((a, b) => a.name.localeCompare(b.name)).map(t => `<option value="${escapeHtml(t.id)}" ${t.id === myId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="panel" style="padding:10px; position:relative; overflow:hidden;">
      <div id="points-race-plot"></div>
      <div id="points-race-tip" class="mono" style="display:none; position:absolute; pointer-events:none; background:var(--bg-panel-alt); border:1px solid var(--border); padding:8px 10px; font-size:11px; z-index:3; white-space:nowrap;"></div>
      <div id="points-race-legend"></div>
    </div>`;

  const plot = document.getElementById('points-race-plot');
  const W = Math.max(280, plot.clientWidth);
  const wide = W >= 700;
  const H = wide ? 360 : 260;
  const L = 40, R = wide ? 230 : 12, T = 12, B = 26;

  const worst = Math.max(5, ...shown.map(t => Math.max(...t.gap.map(g => (g == null ? 0 : -g)))));
  const step = [5, 10, 20, 25, 50, 100, 200].find(s => worst / s <= 5) || 500;
  const yMax = Math.ceil(worst / step) * step;
  const X = (d) => L + (W - L - R) * (n === 1 ? 0 : d / last);
  const Y = (g) => T + (H - T - B) * (-g / yMax);
  const path = (t) => {
    let out = '', pen = false;
    t.gap.forEach((g, d) => {
      if (g == null) { pen = false; return; }
      out += `${pen ? 'L' : 'M'}${X(d).toFixed(1)},${Y(g).toFixed(1)} `;
      pen = true;
    });
    return out;
  };
  const day = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  let grid = '';
  for (let v = 0; v <= yMax; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${Y(-v)}" y2="${Y(-v)}" stroke="#2a2a2a"/><text x="${L - 6}" y="${Y(-v) + 4}" text-anchor="end" class="race-ax">${v === 0 ? '0' : '-' + v}</text>`;
  }
  const tickCount = Math.min(n, wide ? 6 : 4);
  for (let i = 0; i < tickCount; i++) {
    const d = tickCount === 1 ? 0 : Math.round(i * last / (tickCount - 1));
    grid += `<text x="${X(d)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : (i === tickCount - 1 ? 'end' : 'middle')}" class="race-ax">${escapeHtml(day(dates[d]))}</text>`;
  }

  const field = teams.filter(t => !shown.includes(t))
    .map(t => `<path d="${path(t)}" fill="none" stroke="#5a6066" stroke-width="1" opacity="0.35"/>`).join('');
  const lines = [...shown].reverse().map(t => {
    const isMine = t === mine;
    return `<path d="${path(t)}" fill="none" stroke="${colorOf(t)}" stroke-width="${isMine ? 3 : 2}" stroke-linejoin="round" ${isMine && !mineInTop ? 'stroke-dasharray="6 4"' : ''}/>
      <circle cx="${X(last)}" cy="${Y(t.gap[last])}" r="4" fill="${colorOf(t)}" stroke="#141414" stroke-width="2"/>`;
  }).join('');

  // Names at the line ends (wide screens), nudged apart so they never overlap.
  let endLabels = '';
  if (wide) {
    const ys = shown.map(t => Y(t.gap[last]));
    const order = shown.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
    let prev = -Infinity;
    order.forEach(i => { ys[i] = Math.max(ys[i], prev + 17); prev = ys[i]; });
    endLabels = shown.map((t, i) => `
      <circle cx="${W - R + 14}" cy="${ys[i]}" r="4" fill="${colorOf(t)}"/>
      <text x="${W - R + 24}" y="${ys[i] + 4}" class="race-lb">${escapeHtml((teams.indexOf(t) + 1) + '. ' + (t.name.length > 21 ? t.name.slice(0, 20) + '…' : t.name))}</text>
      <text x="${W - 4}" y="${ys[i] + 4}" text-anchor="end" class="race-pt">${t.pts[last].toFixed(1)}</text>`).join('');
  }

  plot.innerHTML = `
    <svg width="${W}" height="${H}" style="display:block;">
      <style>.race-ax{fill:#A2AAAD;font:11px 'JetBrains Mono',monospace}.race-lb{fill:#e8edf1;font:600 13px 'Barlow Condensed',sans-serif}.race-pt{fill:#e8edf1;font:700 11px 'JetBrains Mono',monospace}</style>
      <defs><clipPath id="race-clip"><rect x="${L}" y="${T - 6}" width="${W - L - R + 6}" height="${H - T - B + 12}"/></clipPath></defs>
      ${grid}
      <g clip-path="url(#race-clip)">${field}${lines}</g>
      <line id="race-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#A2AAAD" stroke-dasharray="3 3" opacity="0.6" style="display:none;"/>
      ${endLabels}
      <rect id="race-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>`;

  // Legend below the chart: always on phones; on wide screens the names are at the line ends.
  document.getElementById('points-race-legend').innerHTML = wide ? '' : `
    <div style="display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px;">
      ${shown.map(t => `<span style="display:inline-flex; align-items:center; gap:6px; font-size:13px;"><span style="width:10px; height:10px; border-radius:50%; background:${colorOf(t)}; display:inline-block;"></span>${escapeHtml((teams.indexOf(t) + 1) + '. ' + t.name)} <span class="mono" style="color:var(--text-dim); font-size:11px;">${t.pts[last].toFixed(1)}</span></span>`).join('')}
    </div>`;

  // Hover / touch: a guide line and each shown team's gap on that night.
  const hit = document.getElementById('race-hit');
  const cross = document.getElementById('race-cross');
  const tip = document.getElementById('points-race-tip');
  const show = (clientX) => {
    const box = plot.getBoundingClientRect();
    const x = clientX - box.left;
    const d = Math.max(0, Math.min(last, Math.round((x - L) / ((W - L - R) / Math.max(1, last)))));
    cross.setAttribute('x1', X(d)); cross.setAttribute('x2', X(d)); cross.style.display = '';
    const rows = shown.filter(t => t.gap[d] != null).sort((a, b) => b.gap[d] - a.gap[d]).map(t => `
      <div style="display:flex; align-items:center; gap:6px; padding:1px 0;">
        <span style="width:8px; height:8px; border-radius:50%; background:${colorOf(t)}; display:inline-block;"></span>
        <span style="flex:1; color:var(--text);">${escapeHtml(t.name.length > 22 ? t.name.slice(0, 21) + '…' : t.name)}</span>
        <span style="color:var(--text); font-weight:700; margin-left:12px;">${t.gap[d] === 0 ? '1st' : t.gap[d].toFixed(1)}</span>
        <span style="color:var(--text-dim); margin-left:8px;">${t.pts[d].toFixed(1)}</span>
      </div>`).join('');
    tip.innerHTML = `<div style="color:var(--text-dim); text-transform:uppercase; margin-bottom:4px;">${escapeHtml(day(dates[d]))}</div>${rows}`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    const left = X(d) + 10 + tw + 14 > W - R ? X(d) + 10 - tw - 14 : X(d) + 24;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = (T + 16) + 'px';
  };
  const hide = () => { cross.style.display = 'none'; tip.style.display = 'none'; };
  hit.addEventListener('mousemove', (e) => show(e.clientX));
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('touchstart', (e) => show(e.touches[0].clientX), { passive: true });
  hit.addEventListener('touchmove', (e) => show(e.touches[0].clientX), { passive: true });

  document.getElementById('points-race-team').addEventListener('change', (e) => {
    try {
      if (e.target.value) localStorage.setItem('aahl_lastNightTeam', e.target.value);
      else localStorage.removeItem('aahl_lastNightTeam');
    } catch (err) { /* ignore */ }
    lastNightTeamId = e.target.value || null;
    drawPointsRace_();
  });
}

// ---------- Season Records page ----------
// Built in the browser from data already saved each night: the Points
// Race history (every team's points per night) and the 3 Stars history
// (the top three players each night).
// "Best Night by a Team" only counts nights from this date on. Earlier
// nights were rebuilt as estimates, not saved from the real standings.
const RECORDS_TEAM_NIGHT_START = '2026-10-06';

async function renderRecordsPage() {
  const el = document.getElementById('records-content');
  if (!el) return;
  el.innerHTML = skeletonLoader_();

  const [race, tally, powWeeks] = await Promise.all([fetchPointsRace().catch(() => null), fetchStarsTally_(), fetchPlayersOfWeekHistory().catch(() => [])]);
  const day = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const card = (title, note, rows) => `
    <div>
      <h3 class="mini-title">${title}</h3>
      <div class="panel">
        ${rows.length ? rows.join('') : `<p class="mono" style="color:var(--text-dim); font-size:13px;">Not enough games yet.</p>`}
        ${note ? `<p class="mono" style="color:var(--text-dim); font-size:11px; margin-top:8px;">${note}</p>` : ''}
      </div>
    </div>`;
  const row = (i, main, sub, value) => `
    <div class="division-leader-row">
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <span class="mono" style="color:var(--amber); font-weight:700; width:14px;">${i + 1}</span>
        <div class="division-leader-info" style="min-width:0;">
          <div class="division-leader-team">${main}</div>
          <div class="mono division-leader-record">${sub}</div>
        </div>
      </div>
      <div class="division-leader-earning"><span class="division-leader-count">${value}</span></div>
    </div>`;

  const teamNights = [], climbs = [], daysInFirst = {};
  const teamNames = {};
  if (race && race.dates && race.teams) {
    const ids = Object.keys(race.teams);
    // Rank of every team on each night (1 = most points; ties share a rank).
    const ranks = race.dates.map((_, d) => {
      const pts = ids.filter(id => race.teams[id].pts[d] != null).map(id => race.teams[id].pts[d]).sort((a, b) => b - a);
      const out = {};
      ids.forEach(id => { const v = race.teams[id].pts[d]; if (v != null) out[id] = pts.indexOf(v) + 1; });
      return out;
    });
    race.dates.forEach((date, d) => {
      ids.forEach(id => {
        const t = race.teams[id];
        const now = t.pts[d];
        if (now == null) return;
        if (ranks[d][id] === 1) daysInFirst[id] = (daysInFirst[id] || 0) + 1;
        // A team's first recorded night only counts if it's opening night
        // (otherwise a late entry's whole season would look like one night).
        const prev = d === 0 ? 0 : t.pts[d - 1];
        if (prev == null) return;
        if (date >= RECORDS_TEAM_NIGHT_START) teamNights.push({ name: t.name, date, gain: now - prev });
        // Skip the first two nights: early ranks jump around too much to mean anything.
        if (d > 1 && ranks[d - 1][id]) {
          climbs.push({ name: t.name, date, up: ranks[d - 1][id] - ranks[d][id], from: ranks[d - 1][id], to: ranks[d][id] });
        }
      });
    });
    ids.forEach(id => { teamNames[id] = race.teams[id].name; });
  }
  teamNights.sort((a, b) => b.gain - a.gain);
  climbs.sort((a, b) => (b.up - a.up) || (a.to - b.to));

  const playerNights = [];
  ((tally && tally.history) || []).forEach(n => (n.stars || []).forEach(p => playerNights.push({ name: p.fullName, team: p.team, date: n.date, pts: p.pts || 0 })));
  playerNights.sort((a, b) => b.pts - a.pts);

  const firsts = Object.keys(daysInFirst).map(id => ({ name: teamNames[id], days: daysInFirst[id] })).sort((a, b) => b.days - a.days);

  el.innerHTML = `
    <p style="color:var(--text-dim); font-size:13px; margin-bottom:12px;">The best of the season so far. Updated every morning.</p>
    <div class="home-grid" style="margin-top:0;">
      ${card('🔥 Best Night by a Team', `Counting from ${escapeHtml(day(RECORDS_TEAM_NIGHT_START))}.`, teamNights.slice(0, 5).map((r, i) => row(i, escapeHtml(r.name), escapeHtml(day(r.date)), '+' + r.gain.toFixed(2))))}
      ${card('⭐ Best Night by a Player', '', playerNights.slice(0, 5).map((r, i) => row(i, escapeHtml(r.name), `${escapeHtml(r.team || '')} · ${escapeHtml(day(r.date))}`, '+' + r.pts.toFixed(2))))}
      ${card('📈 Biggest One-Day Climb', '', climbs.filter(r => r.up > 0).slice(0, 5).map((r, i) => row(i, escapeHtml(r.name), `${escapeHtml(day(r.date))} · ${ordinal(r.from)} → ${ordinal(r.to)}`, '▲' + r.up)))}
      ${card('👑 Most Nights in 1st Place', '', firsts.slice(0, 5).map((r, i) => row(i, escapeHtml(r.name), `of ${race.dates.length} nights so far`, r.days)))}
    </div>
    ${playersOfWeekHistoryHtml_(powWeeks || [])}`;
}

/**
 * Records page: every week's Players of the Week (newest first), plus who
 * has won it most often.
 */
function playersOfWeekHistoryHtml_(weeks) {
  if (!weeks.length) return '';
  const day = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const wins = {};
  weeks.forEach(w => ['F', 'D', 'G'].forEach(g => {
    const p = w[g];
    if (p) { const k = p.playerId; wins[k] = wins[k] || { p, n: 0 }; wins[k].n++; }
  }));
  const repeat = Object.values(wins).filter(x => x.n > 1).sort((a, b) => b.n - a.n).slice(0, 5);
  const cell = (p) => p
    ? `<td data-v="${escapeHtml(p.fullName)}">${playerCellHtml_(p.fullName, p.headshotUrl, p.team, p.isGoalie ? 'G' : p.position, p.playerId)}</td><td class="pts">+${(p.pts || 0).toFixed(2)}</td>`
    : '<td>—</td><td></td>';
  return `
    <h3 class="mini-title" style="margin-top:24px;">🏆 Players of the Week</h3>
    <div class="panel">
      <div class="players-table-scroll" style="max-height:60vh;">
        <table class="data-table">
          <thead><tr><th>Week</th><th>Forward</th><th></th><th>Defense</th><th></th><th>Goalie</th><th></th></tr></thead>
          <tbody>
            ${weeks.map(w => `<tr><td class="mono" style="white-space:nowrap;">${escapeHtml(day(w.weekStart))} – ${escapeHtml(day(w.weekEnd))}</td>${cell(w.F)}${cell(w.D)}${cell(w.G)}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${repeat.length ? `<p class="mono" style="color:var(--text-dim); font-size:11px; margin-top:8px;">Most awards: ${repeat.map(x => `${escapeHtml(x.p.fullName)} ×${x.n}`).join(' · ')}</p>` : ''}
    </div>`;
}


// ---------- Season 3 Stars Tally ----------
/**
 * Reads the precomputed season tally (config/starsTallyCache), built
 * nightly by rebuildStarsTally() in Stats.gs.
 */
async function fetchStarsTally_() {
  try {
    let r = await supabaseDirectGet_('config', 'starsTallyCache');
    if (r && r.data && !r.items) r = r.data;
    return r || null;
  } catch (e) {
    return null;
  }
}

async function buildSeasonStarsTallyHtml_() {
  const tally = await fetchStarsTally_();
  const items = (tally && tally.items || []).filter(t => poolPlayerIds.size === 0 || poolPlayerIds.has(t.playerId));
  if (items.length === 0) return '';

  const nights = tally.nights || 0;

  return `
    <h3 class="group-title">Season 3 Stars Tally <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(${nights} night${nights === 1 ? '' : 's'} · 1st = 3, 2nd = 2, 3rd = 1)</span></h3>
    <div class="panel" style="margin-bottom:16px;">
      <div class="players-table-scroll" style="max-height:60vh;">
        <table class="data-table tally-table">
          <thead>
            <tr>
              <th>#</th><th data-sort="text">Player</th>
              <th data-sort="num" title="1st Star">1st</th><th data-sort="num" title="2nd Star">2nd</th><th data-sort="num" title="3rd Star">3rd</th>
              <th data-sort="num" title="Total star selections">Total</th><th data-sort="num" title="Weighted score">Score</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((t, i) => `
              <tr>
                <td class="${i === 0 ? 'rank-1' : ''}">${i + 1}</td>
                <td data-v="${escapeHtml(t.fullName)}">${playerCellHtml_(t.fullName, t.headshotUrl, t.team, t.position, t.playerId)}</td>
                <td>${t.first || 0}</td>
                <td>${t.second || 0}</td>
                <td>${t.third || 0}</td>
                <td>${t.total || 0}</td>
                <td class="pts">${t.score || 0}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
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
      ['Division winner (season end)', '+25', true]
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
      27-box pick'em (16 Forward, 5 Defense, 6 Goalie) + 4 division winner picks. 50% of the pot goes to the couple, 50% to the participant prize pool.
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


// ---------- Boxes Reference (public, read-only) ----------
async function renderBoxesReference() {
  const el = document.getElementById('boxes-reference');
  el.innerHTML = `${skeletonLoader_()}`;

  if (allBoxes.length === 0) {
    allBoxes = await fetchBoxes();
  }
  await ensureCurrentSeasonStandingsLoaded_();
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
              const gp = `${gamesPlayedOf_(s) || 0}GP · `;
              const statLine = box.boxType === 'G'
                ? `${gp}${s.wins || 0}W ${s.losses || 0}L ${s.otl || 0}OTL · ${s.shutouts || 0}SO · ${s.saves || 0}SV`
                : `${gp}${s.goals || 0}G ${s.assists || 0}A ${s.sog || 0}SOG${box.boxType === 'D' ? ` ${s.pim || 0}PIM` : ''}${s.hatTricks ? ` · ${s.hatTricks}HT` : ''}`;
              return `
              <div class="box-option box-option-readonly">
                <span class="box-option-photo-wrap">
                  ${headshot ? `<a class="player-nhl-link" href="${nhlProfileUrl(p.name, p.playerId)}" target="_blank" rel="noopener"><img class="box-option-photo" src="${headshot}" alt="" loading="lazy"></a>` : `<div class="box-option-photo box-option-photo-empty"></div>`}
                </span>
                <span class="box-option-name">${escapeHtml(p.name)}${fullPlayer && fullPlayer.injuryStatus ? ` <span class="ir-badge" title="Status: ${escapeHtml(fullPlayer.injuryStatus)}">🩹</span>` : ''}</span>
                <span class="mono box-option-stats">${statLine} · ${ptsNum.toFixed(2)}pts${pickedSuffix_(pickedCount_(p.playerId))}</span>
                <span class="mono box-option-meta">${escapeHtml(currentTeam)}</span>
              </div>
            `;}).join('')}
          </div>
        </div>
      `;}).join('')}
    </div>
  `).join('');

  // Division Winner reference: use LIVE current-season standings once a
  // team has actually played games this season; fall back to last
  // season's final numbers for any team current data doesn't have yet
  // (e.g. very first night or a temporary API hiccup) so the section
  // never looks empty.
  const divisionBoxesHtml = `
    <h3 class="group-title">Division Winner Boxes <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(+25 pts bonus each, awarded at season end)</span></h3>
    <div class="box-grid">
      ${DIVISIONS.map(division => {
        const teams = [...DIVISION_TEAMS[division]].sort((a, b) => {
          const recA = currentSeasonStandings[a[0]] || lastSeasonStandings[a[0]] || {};
          const recB = currentSeasonStandings[b[0]] || lastSeasonStandings[b[0]] || {};
          return (recA.rank ?? 99) - (recB.rank ?? 99);
        });
        return `
        <div class="box-picker">
          <div class="box-picker-label">${escapeHtml(division)}</div>
          <div class="box-picker-options">
            ${teams.map(([abbrev, fullName]) => {
              const live = currentSeasonStandings[abbrev];
              const prev = lastSeasonStandings[abbrev];
              const record = live || prev;
              const refLabel = live
                ? `${live.points}pts (${ordinal(live.rank)} · ${live.gamesPlayed || 0}GP)`
                : (prev ? `${prev.points}pts (${ordinal(prev.rank)}, 25-26)` : '');
              return `
              <div class="box-option box-option-readonly">
                <img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">
                <span class="box-option-name">${escapeHtml(fullName)}</span>
                <span class="mono box-option-stats">${escapeHtml(refLabel)}${pickedSuffix_((hasPickCounts_() && pickCounts.divisions && pickCounts.divisions[abbrev]) || 0)}</span>
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
