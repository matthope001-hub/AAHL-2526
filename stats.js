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
        <p class="mono" style="color:var(--text-dim); font-size:12px; line-height:1.7; margin-top:6px;">${idle.map(p => escapeHtml(p.playerName)).join(' · ')}</p>
      </details>` : ''}
  `;
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
        <table>
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>NHL</th><th>Pos</th>
              <th title="1st Star">1st</th><th title="2nd Star">2nd</th><th title="3rd Star">3rd</th>
              <th title="Total star selections">Total</th><th title="Weighted score">Score</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((t, i) => `
              <tr>
                <td class="${i === 0 ? 'rank-1' : ''}">${i + 1}</td>
                <td>${escapeHtml(t.fullName)}</td>
                <td>${escapeHtml(t.team || '')}</td>
                <td>${escapeHtml(t.position || '')}</td>
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
