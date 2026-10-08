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
  records: 'Records', activity: 'Activity', rules: 'Rules', boxes: 'Boxes', ir: 'IR List',
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
    if (view === 'players') { await Promise.all([ensurePlayersLoaded(), ensurePickCountsLoaded_()]); renderPlayersTable(); }
    if (view === 'lastnight') { await ensurePlayersLoaded(); renderLastNightStats(); }
    if (view === 'records') renderRecordsPage();
    if (view === 'activity') renderActivityList_();
    if (view === 'rules') renderRulesPage();
    if (view === 'boxes') { await Promise.all([ensurePlayersLoaded(), ensurePickCountsLoaded_()]); renderBoxesReference(); }
    if (view === 'ir') renderIRPanel();
    if (view === 'signup') { await Promise.all([ensurePlayersLoaded(), ensureBoxesLoaded_(), ensureLastSeasonStandingsLoaded_()]); renderSignupForm(); }
    if (view === 'managemoves') { await ensurePlayersLoaded(); renderManageMoves(); }
    if (view === 'admin') renderAdminPanel();
  });
});

// ---------- Init ----------
async function init() {
  [allBoxes, allStandings, currentConfig, divisionProjection] = await Promise.all([
    fetchBoxes(), fetchStandings(), fetchConfig(), fetchDivisionProjection().catch(() => null)
  ]);
  await loadTonight_();
  allBoxes.forEach(box => (box.players || []).forEach(p => poolPlayerIds.add(p.playerId)));

  renderHeroMilestone_();
  renderSeasonCountdown_();
  renderTodaysGames();
  renderWeeklyTop();
  document.getElementById('hero-entries').textContent = currentConfig.totalEntries ?? 0;
  document.getElementById('hero-prizepool').textContent = '$' + (currentConfig.prizePool ?? 0).toFixed(0);
  renderHomeStandingsPreview();
  renderStarsOfNight();
  renderRecentActivity();
  renderStatTicker();
  renderDivisionLeadersPanel();
  applySignupCtaVisibility();
  fillUpdatedStamps_();
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
    const [players] = await Promise.all([fetchPlayers(), ensureInjuriesLoaded_()]);
    allPlayers = players;
    applyInjuriesToPlayers_();
  }
}

// ---------- Player status (injured / suspended / not playing) ----------
// One place that knows every status code, so every page shows the same
// marker. Order here is also the sort order on the IR List.
const INJURY_STATUS = {
  LTIR:    { label: 'Long-Term Injured Reserve', note: 'Out at least 10 games and 24 days.' },
  IR:      { label: 'Injured Reserve', note: 'Out at least 7 days.' },
  SOIR:    { label: 'Season-Opening Injured Reserve', note: 'Came into the season injured.' },
  OUT:     { label: 'Out', note: 'Injured and not playing; no official list yet.' },
  W2W:     { label: 'Week-to-Week', note: 'Moderate injury; likely headed to IR.' },
  SUSP:    { label: 'Suspended', note: 'League or team suspension.' },
  NR:      { label: 'Non-Roster', note: 'Off the active roster (injury or illness short of IR).' },
  NHI:     { label: 'Personal / Non-Hockey', note: 'Away for personal reasons or a non-hockey illness.' },
  PAP:     { label: 'Player Assistance Program', note: 'In the NHL/NHLPA assistance program.' },
  DNR:     { label: 'Unassigned', note: 'Waiting on a visa, clearance or contract.' },
  NP:      { label: 'Not Playing', note: "Has missed his team's last 3+ games; reason not confirmed." },
  DTD:     { label: 'Day-to-Day', note: 'Minor injury; expected back within days.' },
  GTD:     { label: 'Game-Time Decision', note: 'To be decided before the game.' },
  SCRATCH: { label: 'Healthy Scratch', note: "Fit, but left out of the lineup." }
};
const INJURY_ORDER = Object.keys(INJURY_STATUS);

let injuriesByPlayer = {};
let injuriesMeta = null;
let injuriesLoaded_ = false;
async function ensureInjuriesLoaded_(force) {
  if (injuriesLoaded_ && !force) return;
  try {
    const data = await fetchInjuries();
    injuriesByPlayer = (data && data.players) || {};
    injuriesMeta = data;
  } catch (e) {
    injuriesByPlayer = {};
  }
  injuriesLoaded_ = true;
}

/** Copies each player's status onto the player record (used by the tables). */
function applyInjuriesToPlayers_() {
  allPlayers.forEach(p => {
    const inj = injuriesByPlayer[p.id];
    p.injuryStatus = inj ? `${inj.code}${inj.detail ? ' · ' + inj.detail : ''}` : null;
  });
}

/** Plain-text description, e.g. "Injured Reserve - Knee - back around Oct 20". */
function injuryText_(inj) {
  const info = INJURY_STATUS[inj.code] || { label: inj.code };
  let out = info.label;
  if (inj.detail) out += ' - ' + inj.detail;
  if (inj.returnDate) out += ' - back around ' + new Date(inj.returnDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return out;
}

/**
 * The marker shown beside a player's name anywhere on the site:
 * " 🩹 IR" (hover for the details). Empty if the player is fine.
 */
function statusBadge_(playerId) {
  const inj = injuriesByPlayer[playerId];
  if (!inj) return '';
  return ` <span class="ir-badge" title="${escapeHtml(injuryText_(inj))}">🩹 ${escapeHtml(inj.code)}</span>`;
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

/**
 * Fills one ticker row and starts it scrolling. The chips are repeated
 * until one set is wider than any screen, then doubled, so the row loops
 * forever with no gap or jump. Speed is a steady ~45px per second.
 */
function fillTickerRow_(track, chips) {
  const GAP_PX = 32; // matches .stat-ticker-track gap in style.css
  track.style.animation = 'none';
  track.innerHTML = chips.join('');
  const setWidth = track.scrollWidth + GAP_PX;
  const copies = Math.max(1, Math.ceil(1600 / setWidth));
  let oneSet = '';
  for (let i = 0; i < copies; i++) oneSet += chips.join('');
  track.innerHTML = oneSet + oneSet;
  track.style.animation = '';
  track.style.animationDuration = Math.round(setWidth * copies / 45) + 's';
}

/**
 * Last night's pool performers, as a continuous two-row ticker the same
 * width as the Today's Games ticker. Top scorers are dealt alternately
 * into the two rows. With only a handful of performers it uses one row.
 */
async function renderStatTicker() {
  const wrap = document.getElementById('stat-ticker');
  if (!wrap) return;

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

    const rows = chips.length >= 8
      ? [chips.filter((_, i) => i % 2 === 0), chips.filter((_, i) => i % 2 === 1)]
      : [chips];

    const box = document.getElementById('stat-ticker-rows');
    box.innerHTML = rows.map(() => `<div class="stat-ticker-row"><div class="stat-ticker-track"></div></div>`).join('');
    wrap.style.display = 'block'; // must be visible before widths are measured
    box.querySelectorAll('.stat-ticker-track').forEach((track, i) => fillTickerRow_(track, rows[i]));
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

/**
 * The inside of one Today's Games card: status line (start time, LIVE +
 * period, or FINAL), then each team with logo, record and - once the
 * game is on - the score. The loser is dimmed on a final.
 */
function gameCardInner_(g) {
  const logo = (abbrev) => `<img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${escapeHtml(abbrev)}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">`;
  const hasScore = g.state === 'live' || g.state === 'final';

  let status;
  if (g.state === 'final') {
    status = `<span class="game-chip-final">FINAL${g.finalType ? '/' + escapeHtml(g.finalType) : ''}</span>`;
  } else if (g.state === 'live') {
    const where = g.period ? (g.intermission ? `${g.period} INT` : g.period) : '';
    status = `<span class="game-chip-live">● LIVE</span>${where ? ' ' + escapeHtml(where) : ''}`;
  } else {
    const start = new Date(g.startTimeUTC);
    status = isNaN(start.getTime()) ? '' : escapeHtml(start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
  }

  const teamRow = (abbrev, record, score, otherScore) => `
    <div class="game-chip-team${g.state === 'final' && score < otherScore ? ' game-chip-loser' : ''}">
      ${logo(abbrev)}
      <span class="game-chip-abbrev">${escapeHtml(abbrev)}</span>
      <span class="mono game-chip-record">${escapeHtml(record || '')}</span>
      ${hasScore ? `<span class="mono game-chip-score">${score == null ? 0 : score}</span>` : ''}
    </div>`;

  return `
    <div class="mono game-chip-time">${status}</div>
    ${teamRow(g.away, g.awayRecord, g.awayScore, g.homeScore)}
    ${teamRow(g.home, g.homeRecord, g.homeScore, g.awayScore)}`;
}

/** "● LIVE · scores updated 8:42 PM" while games are on; "Scores updated ..." after. */
function gamesStampHtml_(data) {
  const games = (data && data.games) || [];
  const live = games.some(g => g.state === 'live');
  const anyStarted = games.some(g => g.state === 'live' || g.state === 'final');
  if (!anyStarted) return '';
  const d = data.updatedAt ? new Date(data.updatedAt) : null;
  const time = d && !isNaN(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  return `${live ? '<span class="game-chip-live">● LIVE</span> · ' : ''}${time ? 'scores updated ' + time : ''}`;
}

/** The current "hockey day" (ET, rolling over at 5am) as YYYY-MM-DD. */
function hockeyDay_() {
  return new Date(Date.now() - 5 * 3600000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * "Today's Games" ticker under the hero: each NHL game on today's
 * schedule with both teams' records, the start time (in the visitor's
 * own time zone) and, once games begin, the live score and status.
 * Hidden if the saved schedule isn't today's.
 *
 * When called again with the same set of games (the periodic refresh),
 * it updates the cards in place so the ticker doesn't jump back to the
 * start.
 */
let todaysGamesKey_ = null;
async function renderTodaysGames() {
  const el = document.getElementById('todays-games');
  if (!el) return;

  try {
    const data = await fetchTodaysGames();
    if (!data || data.date !== hockeyDay_()) { el.style.display = 'none'; todaysGamesKey_ = null; return; }
    todaysGamesData_ = data;

    const games = data.games || [];
    const key = data.date + '|' + games.map(g => g.id).join(',');

    // Same games as last time: just refresh scores/status in place.
    if (key === todaysGamesKey_ && el.querySelector('.game-chip')) {
      const stamp = document.getElementById('todays-games-stamp');
      if (stamp) stamp.innerHTML = gamesStampHtml_(data);
      games.forEach(g => {
        el.querySelectorAll(`.game-chip[data-game-id="${g.id}"]`).forEach(card => { card.innerHTML = gameCardInner_(g); });
      });
      return;
    }
    todaysGamesKey_ = key;

    // Continuous ticker: repeat the games until one set is wider than any
    // screen, then double it so the scroll loops with no gap or jump.
    const CARD_PX = 150; // card width + gap, matches style.css
    const copies = games.length ? Math.max(1, Math.ceil(2400 / (games.length * CARD_PX))) : 0;
    const oneSet = [];
    for (let i = 0; i < copies; i++) oneSet.push(...games);
    const loop = oneSet.concat(oneSet);
    const tickerSeconds = Math.round(oneSet.length * CARD_PX / 45); // ~45px per second

    el.innerHTML = `
      <h3 class="mini-title">🏒 Today's Games <span class="mono" style="font-weight:400; font-size:12px; text-transform:none; letter-spacing:0;">${games.length ? `${games.length} game${games.length === 1 ? '' : 's'}` : ''}</span>
        <span class="mono updated-stamp" id="todays-games-stamp">${gamesStampHtml_(data)}</span></h3>
      ${games.length === 0
        ? `<div class="panel"><p class="mono" style="color:var(--text-dim); font-size:13px;">No NHL games today.</p></div>`
        : `<div class="games-ticker"><div class="games-ticker-track" style="animation-duration:${tickerSeconds}s;">
            ${loop.map(g => `<div class="game-chip" data-game-id="${g.id}">${gameCardInner_(g)}</div>`).join('')}
          </div></div>`}
    `;
    el.style.display = 'block';
  } catch (e) {
    el.style.display = 'none';
  }
}

// Keep scores current on an open tab: re-check every 3 minutes while the
// Home page is showing and the tab is visible.
setInterval(async () => {
  if (document.hidden) return;
  const home = document.getElementById('view-home');
  const standings = document.getElementById('view-standings');
  const onHome = home && home.classList.contains('active');
  const onStandings = standings && standings.classList.contains('active');
  if (!onHome && !onStandings) return;
  if (onHome) renderTodaysGames();
  // Live points: redraw the standings only if they changed, keeping the
  // table's scroll position.
  const before = livePoints && livePoints.updatedAt;
  await loadTonight_(true);
  if (!livePoints || livePoints.updatedAt === before) return;
  if (onHome) {
    const box = document.querySelector('#home-standings-preview .players-table-scroll');
    const top = box ? box.scrollTop : 0;
    renderHomeStandingsPreview();
    const again = document.querySelector('#home-standings-preview .players-table-scroll');
    if (again) again.scrollTop = top;
  }
  if (onStandings) renderStandingsTable();
}, 180000);

/**
 * "Top Performers Last Week" under Division Leaders: the three pool
 * players with the most pool points over the last completed Mon-Sun week.
 * Hidden until the weekly ranking exists.
 */
async function renderWeeklyTop() {
  const section = document.getElementById('weekly-top-section');
  const el = document.getElementById('weekly-top-panel');
  if (!section || !el) return;

  try {
    const data = await fetchWeeklyTop();
    // Players of the Week: best Forward, Defenseman and Goalie. (Older
    // saved data without them falls back to the overall top 3.)
    const pow = data && data.playersOfWeek;
    const top = pow
      ? [['Forward', pow.F], ['Defense', pow.D], ['Goalie', pow.G]].filter(([, p]) => p).map(([label, p]) => Object.assign({ award: label }, p))
      : ((data && data.top) || []).slice(0, 3);
    if (top.length === 0) { section.style.display = 'none'; return; }

    const day = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    document.getElementById('weekly-top-dates').textContent = `${day(data.weekStart)} – ${day(data.weekEnd)}`;

    el.innerHTML = top.map((p, i) => {
      const line = p.isGoalie
        ? `${p.wins || 0}W${p.shutouts ? ` · ${p.shutouts}SO` : ''} · ${p.saves || 0}SV`
        : `${p.goals || 0}G · ${p.assists || 0}A · ${p.sog || 0}SOG`;
      return `
      <div class="division-leader-row">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          ${p.award
            ? `<span class="mono pow-label">${escapeHtml(p.award)}</span>`
            : `<span class="mono" style="color:var(--amber); font-weight:700; width:14px;">${i + 1}</span>`}
          ${p.headshotUrl ? `<img class="star-photo" src="${p.headshotUrl}" alt="" loading="lazy">` : `<div class="star-photo star-photo-empty"></div>`}
          <div class="division-leader-info" style="min-width:0;">
            <div class="division-leader-team">${escapeHtml(p.fullName)}</div>
            <div class="mono division-leader-record">${escapeHtml(p.team || '')} · ${escapeHtml(p.isGoalie ? 'G' : (p.position || ''))} · ${p.games || 0}GP · ${line}</div>
          </div>
        </div>
        <div class="division-leader-earning">
          <span class="division-leader-count">+${(p.pts || 0).toFixed(2)}</span>
          <span class="mono division-leader-count-label">pts</span>
        </div>
      </div>`;
    }).join('');
    section.style.display = 'block';
  } catch (e) {
    section.style.display = 'none';
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
  [allStandings, currentConfig, divisionProjection] = await Promise.all([fetchStandings(), fetchConfig(), fetchDivisionProjection().catch(() => null)]);
  await loadTonight_();
  renderHeroMilestone_();
  renderSeasonCountdown_();
  renderTodaysGames();
  renderWeeklyTop();
  document.getElementById('hero-entries').textContent = currentConfig.totalEntries ?? 0;
  document.getElementById('hero-prizepool').textContent = '$' + (currentConfig.prizePool ?? 0).toFixed(0);
  renderHomeStandingsPreview();
  renderStarsOfNight();
  renderRecentActivity();
  renderDivisionLeadersPanel();
  applySignupCtaVisibility();
}

// Short team names for the Division Leaders cards (the logo says the rest).
const TEAM_NICKNAMES = {
  ANA: 'Ducks', BOS: 'Bruins', BUF: 'Sabres', CGY: 'Flames', CAR: 'Hurricanes', CHI: 'Blackhawks',
  COL: 'Avalanche', CBJ: 'Blue Jackets', DAL: 'Stars', DET: 'Red Wings', EDM: 'Oilers', FLA: 'Panthers',
  LAK: 'Kings', MIN: 'Wild', MTL: 'Canadiens', NSH: 'Predators', NJD: 'Devils', NYI: 'Islanders',
  NYR: 'Rangers', OTT: 'Senators', PHI: 'Flyers', PIT: 'Penguins', SJS: 'Sharks', SEA: 'Kraken',
  STL: 'Blues', TBL: 'Lightning', TOR: 'Maple Leafs', UTA: 'Mammoth', VAN: 'Canucks', VGK: 'Golden Knights',
  WSH: 'Capitals', WPG: 'Jets'
};

async function renderDivisionLeadersPanel(preloadedLeaders) {
  const el = document.getElementById('division-leaders-panel');
  el.innerHTML = `<div class="panel" style="grid-column:1 / -1;">${skeletonLoader_()}</div>`;

  try {
    const leaders = preloadedLeaders !== undefined ? preloadedLeaders : await fetchDivisionLeadersDisplay();
    if (!leaders || leaders.length === 0) {
      el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Not available yet — check back once the season is underway.</p>`;
      return;
    }

    // One card per division: big logo, the team's short name, its record,
    // and how many pool teams picked it.
    el.innerHTML = leaders.map(d => `
      <div class="division-card" title="${escapeHtml(d.teamName || '')}">
        ${d.teamAbbrev ? `<img class="division-card-logo" src="https://assets.nhle.com/logos/nhl/svg/${escapeHtml(d.teamAbbrev)}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="division-card-info">
          <div class="mono division-leader-name-label">${escapeHtml(d.division)}</div>
          <div class="division-card-team">${escapeHtml(TEAM_NICKNAMES[d.teamAbbrev] || d.teamName || '')}</div>
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

// ---------- Where the points come from (players vs division bonus) ----------
// divisionProjection says how many of each team's four division winner
// picks are leading right now (DivisionProjection.gs). Until the season
// ends that's a projection only; once it ends, the bonus is in the real
// points and these helpers split it back out.
let divisionProjection = null;

/** { leading, bonus, players, total, final } for one standings row. */
function pointsBreakdown_(e) {
  const info = (divisionProjection && divisionProjection.byEntry && divisionProjection.byEntry[e.entryId]) || null;
  const each = (divisionProjection && divisionProjection.bonusEach) || 25;
  const leading = info ? info.leading : null;
  const bonus = (leading || 0) * each;
  const final = currentConfig.seasonComplete === true;
  return {
    leading,
    divisions: (info && info.divisions) || [],
    bonus,
    players: final ? e.pts - bonus : e.pts,   // points earned by players
    total: final ? e.pts : e.pts + bonus,     // with the division bonus
    final
  };
}

/** Four dots, one per division pick; filled = that pick is leading now. */
function divisionDotsHtml_(e) {
  const b = pointsBreakdown_(e);
  if (b.leading == null) return '<span class="mono" style="color:var(--text-dim)">—</span>';
  const tip = b.leading === 0
    ? 'No division picks leading right now'
    : `${b.leading} of 4 division picks leading (${b.divisions.join(', ')}) - +${b.bonus} ${b.final ? 'awarded' : 'if the season ended today'}`;
  let dots = '';
  for (let i = 0; i < 4; i++) dots += `<span class="div-dot${i < b.leading ? ' div-dot-on' : ''}"></span>`;
  return `<span class="div-dots" title="${escapeHtml(tip)}">${dots}</span>`;
}

function sortedStandings_() {
  return [...allStandings].sort((a, b) => {
    if (a.rank == null && b.rank == null) return 0;
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return a.rank - b.rank;
  });
}

/**
 * The standings table, shared by the Home page and the Standings page:
 * Rank, Team, points from Players, the Division bonus (dots + amount),
 * the Projected total with that bonus, ±Pts, Move and Payout.
 * Ranking and payouts always use the real points; until the season ends
 * the division bonus is a projection only.
 */
// Which column the standings are sorted by (shared by Home and Standings).
// 'rank' is the normal order; Players / Div / Projected sort high to low
// first, and clicking the same heading again flips it.
let standingsSort = { key: 'rank', dir: 'asc' };

function applyStandingsSort_(rows) {
  if (standingsSort.key === 'rank') return rows;
  const val = {
    players: e => pointsBreakdown_(e).players,
    div: e => (pointsBreakdown_(e).leading || 0) * 1000 + pointsBreakdown_(e).players, // ties broken by players
    projected: e => pointsBreakdown_(e).total,
    tonight: e => { const lp = liveActive_(); return (lp && lp.entries && lp.entries[e.entryId] && lp.entries[e.entryId].pts) || 0; }
  }[standingsSort.key];
  const out = [...rows].sort((a, b) => val(b) - val(a));
  return standingsSort.dir === 'desc' ? out : out.reverse();
}

/** Makes the sortable headings clickable; redraw() re-renders the table. */
function wireStandingsSort_(el, redraw) {
  el.querySelectorAll('[data-st-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.stSort;
      if (key === 'rank') standingsSort = { key: 'rank', dir: 'asc' };
      else standingsSort = standingsSort.key === key
        ? { key, dir: standingsSort.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' };
      redraw();
    });
  });
}

function standingsTableHtml_(sorted, deltaLabel) {
  const hasDiv = !!(divisionProjection && divisionProjection.byEntry);
  const final = currentConfig.seasonComplete === true;
  const approvedRanks = sorted.filter(e => e.approved && e.rank != null).map(e => e.rank);
  const lastRank = approvedRanks.length > 0 ? Math.max(...approvedRanks) : null;
  const live = liveActive_();
  if (!live && standingsSort.key === 'tonight') standingsSort = { key: 'rank', dir: 'asc' };
  if (!hasDiv && standingsSort.key !== 'rank' && standingsSort.key !== 'tonight') standingsSort = { key: 'rank', dir: 'asc' };
  sorted = applyStandingsSort_(sorted);
  const sortHead = (key, label, cls, title) => {
    const on = standingsSort.key === key;
    const arrow = on && key !== 'rank' ? (standingsSort.dir === 'desc' ? ' ▼' : ' ▲') : '';
    return `<th class="sortable-col ${on ? 'sorted-col' : ''} ${cls || ''}" data-st-sort="${key}" title="${escapeHtml(title || 'Sort')}">${label}${arrow}</th>`;
  };

  return `
    <table class="standings-full data-table">
      <thead><tr>
        ${hasDiv || live ? sortHead('rank', 'Rank', '', 'Back to the normal ranking') : '<th>Rank</th>'}<th>Team</th>
        ${live ? sortHead('tonight', '<span class="game-chip-live">●</span> Tonight', 'num', 'Live points from tonight\'s games (estimate until the 4am update) - click to sort') : ''}
        ${hasDiv
          ? `${sortHead('players', 'Players', 'num', 'Points earned by players - click to sort')}
             ${sortHead('div', 'Div' + (final ? '' : '*'), '', 'Division winner picks leading now, +25 each - click to sort')}
             ${sortHead('projected', final ? 'Total' : 'Projected*', 'num col-hide-sm', 'Players plus the division bonus - click to sort')}`
          : '<th class="num">Points</th>'}
        <th class="num col-hide-sm">${escapeHtml(deltaLabel)}</th><th class="col-hide-sm">Move</th><th class="col-hide-sm">Payout</th>
      </tr></thead>
      <tbody>
        ${sorted.map(e => {
          const b = pointsBreakdown_(e);
          return `
          <tr>
            <td class="${e.rank === 1 ? 'rank-1' : ''}">${e.rank ?? '—'}</td>
            <td class="team-cell"><span class="team-link" data-entry-id="${e.entryId}">${escapeHtml(e.teamName)}</span></td>
            ${live ? (() => { const t = live.entries && live.entries[e.entryId]; return `<td class="num mono" style="color:${t && t.pts ? '#3ecf6a' : 'var(--text-dim)'}; white-space:nowrap;">${t ? '+' + t.pts.toFixed(2) : '—'}${t && t.players ? ` <span style="color:var(--text-dim); font-size:10px;">(${t.players})</span>` : ''}</td>`; })() : ''}
            ${hasDiv
              ? `<td class="pts num">${b.players.toFixed(2)}</td>
                 <td style="white-space:nowrap;">${divisionDotsHtml_(e)}<span class="mono" style="color:${b.bonus ? 'var(--amber)' : 'var(--text-dim)'}; margin-left:8px;">${b.bonus ? '+' + b.bonus : '—'}</span></td>
                 <td class="mono num col-hide-sm" style="color:${final ? 'var(--ice)' : 'var(--text-dim)'}; font-weight:${final ? 700 : 400};">${b.total.toFixed(2)}</td>`
              : `<td class="pts num">${e.pts.toFixed(2)}</td>`}
            <td class="num col-hide-sm">${ptsDeltaHtml(e)}</td>
            <td class="col-hide-sm">${rankMovementHtml(e)}</td>
            <td class="col-hide-sm">${payoutHtml(e.rank, lastRank != null && e.rank === lastRank)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${live ? `<p class="mono" style="color:var(--text-dim); font-size:11px; margin-top:10px;"><span class="game-chip-live">●</span> Tonight = live points from tonight's games so far (number of players who've played in brackets). An estimate, updated every 10 minutes; the official points come in the 4am update.</p>` : ''}
    ${hasDiv && !final ? `<p class="mono" style="color:var(--text-dim); font-size:11px; margin-top:10px;">* <span class="div-dot div-dot-on"></span> = a division pick that is leading now. Projected = players + 25 for each one, if the season ended today. Not counted in the ranking until the season ends.</p>` : ''}`;
}

// Home page: full-width standings, scrolling inside its box.
function renderHomeStandingsPreview() {
  const sorted = sortedStandings_();
  const el = document.getElementById('home-standings-preview');
  if (sorted.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No entries yet.</p>`;
    return;
  }
  el.innerHTML = `<div class="players-table-scroll" style="max-height:470px;">${standingsTableHtml_(sorted, '±Pts')}</div>`;
  attachTeamLinkListeners(el);
  wireStandingsSort_(el, renderHomeStandingsPreview);
}

// ---------- Standings ----------
async function refreshAndRenderStandings() {
  [allStandings, divisionProjection] = await Promise.all([fetchStandings(), fetchDivisionProjection().catch(() => null)]);
  await loadTonight_();
  renderStandingsTable();
  renderPointsRace();
}

function renderStandingsTable() {
  const el = document.getElementById('standings-table');
  const sorted = sortedStandings_();
  if (sorted.length === 0) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim)">No entries yet.</p>`;
    return;
  }
  el.innerHTML = standingsTableHtml_(sorted, '±Pts (24h)');
  attachTeamLinkListeners(el);
  wireStandingsSort_(el, renderStandingsTable);
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
    ${dataVersionValue_ ? `<p class="mono updated-stamp" style="margin:-2px 0 8px;">Points ${escapeHtml(updatedText_(dataVersionValue_).toLowerCase())} · updates every morning around 4 AM ET</p>` : ''}
    ${tonightSummaryHtml_(data)}
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
              <span class="modal-pick-name">${escapeHtml(p.playerName)}${statusBadge_(p.playerId)}${tonightTagHtml_(p.playerId, p.team)}</span>
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
  await Promise.all([ensurePlayersLoaded(), loadTonight_()]);
  data.entryId = data.entryId || entryId;

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
// Compact, sortable table. Default order: soonest expected return first
// (players with no return date at the end). Click a heading to sort by
// it; click again to reverse.
let irSort = { key: 'back', dir: 'asc' };
let irRows_ = [];

async function renderIRPanel() {
  const el = document.getElementById('ir-panel');
  el.innerHTML = `<div class="panel">${skeletonLoader_()}</div>`;
  await Promise.all([ensurePlayersLoaded(), ensureInjuriesLoaded_(true), ensurePickCountsLoaded_()]);
  applyInjuriesToPlayers_();

  irRows_ = Object.keys(injuriesByPlayer).map(id => {
    const inj = injuriesByPlayer[id];
    const p = allPlayers.find(ap => ap.id === id) || {};
    return { id, inj, name: p.fullName || inj.name || id, team: p.team || inj.team || '', pos: p.position || '', headshot: p.headshotUrl || '' };
  });
  drawIRTable_();
}

function drawIRTable_() {
  const el = document.getElementById('ir-panel');
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) + 'T12:00:00');
  const day = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
  const daysUntil = (s) => (s ? Math.round((new Date(s + 'T12:00:00') - today) / 86400000) : null);
  const showPicked = hasPickCounts_();

  const sortValue = {
    player: r => r.name.toLowerCase(),
    status: r => { const o = INJURY_ORDER.indexOf(r.inj.code); return o === -1 ? 99 : o; },
    back: r => r.inj.returnDate || null,
    picked: r => pickedCount_(r.id),
    since: r => r.inj.since || null
  };
  const rows = [...irRows_].sort((a, b) => {
    const va = sortValue[irSort.key](a), vb = sortValue[irSort.key](b);
    // Blank values (no date) always go to the bottom, whichever direction.
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    const diff = va < vb ? -1 : (va > vb ? 1 : 0);
    return (irSort.dir === 'asc' ? diff : -diff) || a.name.localeCompare(b.name);
  });

  const head = (key, label, cls) => `<th class="sortable-col ${irSort.key === key ? 'sorted-col' : ''} ${cls || ''}" data-ir-sort="${key}">${label}${irSort.key === key ? (irSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  const updated = injuriesMeta && injuriesMeta.updatedAt
    ? new Date(injuriesMeta.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const usedCodes = INJURY_ORDER.filter(code => irRows_.some(r => r.inj.code === code));

  el.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      ${rows.length === 0
        ? `<p class="mono" style="color:var(--text-dim)">No pool players are currently injured or unavailable.</p>`
        : `<table class="ir-table data-table">
            <thead><tr>
              ${head('player', 'Player')}
              ${head('status', 'Status')}
              <th class="ir-hide-sm">Details</th>
              ${head('back', 'Expected Back')}
              ${showPicked ? head('picked', 'Picked', 'ir-hide-sm') : ''}
              ${head('since', 'Since', 'ir-hide-sm')}
            </tr></thead>
            <tbody>
              ${rows.map(r => {
                const n = daysUntil(r.inj.returnDate);
                const soon = n == null ? '' : (n <= 0 ? 'any day' : (n === 1 ? 'tomorrow' : `in ${n} days`));
                return `
                <tr>
                  <td>
                    <div class="ir-player">
                      ${r.headshot ? `<img src="${r.headshot}" alt="" loading="lazy">` : '<span class="ir-player-nophoto"></span>'}
                      <div><div class="ir-player-name">${escapeHtml(r.name)}</div><div class="ir-player-meta">${escapeHtml(r.team)} · ${escapeHtml(r.pos)}</div></div>
                    </div>
                  </td>
                  <td><span class="ir-badge" title="${escapeHtml((INJURY_STATUS[r.inj.code] || {}).label || r.inj.code)}">${escapeHtml(r.inj.code)}</span></td>
                  <td class="ir-hide-sm">${escapeHtml(r.inj.detail || '—')}</td>
                  <td>${escapeHtml(day(r.inj.returnDate))}${soon ? ` <span class="ir-soon">${soon}</span>` : ''}</td>
                  ${showPicked ? `<td class="ir-hide-sm">${pickedCount_(r.id)}<span style="color:var(--text-dim);">/${pickCounts.total}</span></td>` : ''}
                  <td class="ir-hide-sm">${escapeHtml(day(r.inj.since))}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`}
      <p class="mono" style="color:var(--text-dim); font-size:11px; margin-top:8px;">${rows.length} player${rows.length === 1 ? '' : 's'}${updated ? ` · updated ${escapeHtml(updated)}` : ''} · click a heading to sort · return dates are estimates</p>
    </div>
    ${usedCodes.length ? `
      <div class="ir-legend mono">
        ${usedCodes.map(code => `<span><span class="ir-badge">${escapeHtml(code)}</span> ${escapeHtml(INJURY_STATUS[code].label)}</span>`).join('')}
      </div>` : ''}
  `;

  el.querySelectorAll('[data-ir-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.irSort;
      irSort = irSort.key === key
        ? { key, dir: irSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'picked' ? 'desc' : 'asc' };
      drawIRTable_();
    });
  });
}


// ---------- Tonight: who's playing, and live points ----------
let livePoints = null;
let todaysGamesData_ = null;
let dataVersionValue_ = null;

/** Loads tonight's games and live points (once, or again when forced). */
async function loadTonight_(force) {
  const jobs = [];
  if (force || !livePoints) jobs.push(fetchLivePoints().then(v => { livePoints = v; }).catch(() => {}));
  if (!todaysGamesData_) jobs.push(fetchTodaysGames().then(d => { if (d && d.date === hockeyDay_()) todaysGamesData_ = d; }).catch(() => {}));
  if (!dataVersionValue_) jobs.push(getDataVersion_().then(v => { dataVersionValue_ = v; }).catch(() => {}));
  await Promise.all(jobs);
}

/**
 * The live points, but only while they're for tonight and newer than the
 * official standings (after the 4am run the real points take over).
 */
function liveActive_() {
  const lp = livePoints;
  if (!lp || lp.date !== hockeyDay_() || !lp.players || Object.keys(lp.players).length === 0) return null;
  if (dataVersionValue_ && lp.updatedAt && new Date(lp.updatedAt) <= new Date(dataVersionValue_)) return null;
  return lp;
}

/** Tonight's game for an NHL team (abbrev), or null. */
function tonightGameFor_(team) {
  const games = (todaysGamesData_ && todaysGamesData_.games) || [];
  return games.find(g => g.away === team || g.home === team) || null;
}

/**
 * Tag beside a player in the team popup:
 *   before his game: "🏒 7:00 PM"; during: "● +2.30"; after: "+2.30 final".
 */
function tonightTagHtml_(playerId, team) {
  const g = tonightGameFor_(team);
  if (!g) return '';
  const lp = liveActive_();
  const mine = lp && lp.players[playerId];
  if (g.state === 'pre' || (!mine && g.state !== 'live' && g.state !== 'final')) {
    const t = new Date(g.startTimeUTC);
    return `<span class="tonight-tag">🏒 ${isNaN(t.getTime()) ? 'tonight' : escapeHtml(t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</span>`;
  }
  const pts = mine ? mine.pts : 0;
  if (g.state === 'final') return `<span class="tonight-tag tonight-final">+${pts.toFixed(2)} final</span>`;
  return `<span class="tonight-tag tonight-live">● +${pts.toFixed(2)}</span>`;
}

/** "🏒 9 of 27 play tonight · ● +12.40 live" for the top of the team popup. */
function tonightSummaryHtml_(data) {
  const picks = data.picks || [];
  const playing = picks.filter(p => tonightGameFor_(p.team)).length;
  if (!playing) return '';
  const lp = liveActive_();
  const live = lp && lp.entries && data.entryId && lp.entries[data.entryId];
  let livePts = live ? live.pts : null;
  if (livePts == null && lp) livePts = picks.reduce((s, p) => s + ((lp.players[p.playerId] || {}).pts || 0), 0);
  return `<p class="mono" style="font-size:12px; margin-bottom:10px; color:var(--text-dim);">🏒 ${playing} of ${picks.length} play tonight${lp ? ` · <span class="game-chip-live">● +${livePts.toFixed(2)} live</span>` : ''}</p>`;
}

// ---------- Shared table helpers ----------
/**
 * Player cell used by every table: small photo, name (with any injury
 * marker), and "TEAM · POS" underneath.
 */
function playerCellHtml_(name, headshot, team, pos, playerId) {
  return `<div class="dt-player">
    ${headshot ? `<img src="${headshot}" alt="" loading="lazy">` : '<span class="dt-player-nophoto"></span>'}
    <div><div class="dt-player-name">${escapeHtml(name)}${playerId ? statusBadge_(playerId) : ''}</div>
    <div class="dt-player-meta">${escapeHtml(team || '')}${pos ? ' · ' + escapeHtml(pos) : ''}</div></div>
  </div>`;
}

/**
 * Click-to-sort for simple tables: any <th data-sort="num|text"> sorts the
 * rows by that column (cells can carry data-v with the value to sort on).
 * Numbers sort high to low first; click again to reverse.
 */
function makeTableSortable_(table) {
  if (!table) return;
  const heads = [...table.querySelectorAll('thead th')];
  heads.forEach((th, col) => {
    const type = th.dataset.sort;
    if (!type) return;
    th.classList.add('sortable-col');
    th.addEventListener('click', () => {
      const dir = th.dataset.dir === 'desc' ? 'asc' : (th.dataset.dir === 'asc' ? 'desc' : (type === 'num' ? 'desc' : 'asc'));
      heads.forEach(h => { delete h.dataset.dir; h.classList.remove('sorted-col'); h.textContent = h.textContent.replace(/ [▲▼]$/, ''); });
      th.dataset.dir = dir;
      th.classList.add('sorted-col');
      th.textContent += dir === 'desc' ? ' ▼' : ' ▲';
      const body = table.tBodies[0];
      const val = (row) => {
        const cell = row.children[col];
        const raw = cell && cell.dataset.v != null ? cell.dataset.v : (cell ? cell.textContent.trim() : '');
        if (type !== 'num') return raw.toLowerCase();
        const n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? -Infinity : n;
      };
      [...body.rows]
        .sort((a, b) => { const va = val(a), vb = val(b); const d = va < vb ? -1 : (va > vb ? 1 : 0); return dir === 'asc' ? d : -d; })
        .forEach(row => body.appendChild(row));
    });
  });
}

// ---------- "Updated" stamps ----------
/** "Updated Oct 8, 4:12 AM" from an ISO time, or '' if there isn't one. */
function updatedText_(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  return 'Updated ' + d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Fills every [data-stamp="stats"] with when the stats and standings were
 * last refreshed (the nightly run's standings timestamp).
 */
async function fillUpdatedStamps_() {
  let text = '';
  try { text = updatedText_(await getDataVersion_()); } catch (e) { /* leave blank */ }
  document.querySelectorAll('[data-stamp="stats"]').forEach(el => { el.textContent = text; });
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
