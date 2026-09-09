/**
 * data.js
 * All fetch calls to the AAHL 2526 Apps Script Web App.
 * CRITICAL: POST requests must use Content-Type: text/plain;charset=utf-8
 * to avoid CORS preflight (Apps Script can't handle OPTIONS requests).
 */

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzJA2dDY7N2IY9xrwMpr-XYybw2Z8ZWybXTH8Sm7eYn1tR1qBaEAzc8N9Vp2jmM_bYVdA/exec';

const TOTAL_BOXES = 27;
const TOTAL_PICKS = 31; // 27 player boxes + 4 division winner picks
const REQUIRED_BOX_IDS = Array.from({length: 27}, (_, i) => String(i + 1));
const DIVISIONS = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];

async function apiGet(action, params) {
  let url = `${WEBAPP_URL}?action=${action}`;
  if (params) {
    for (const key in params) {
      url += `&${key}=${encodeURIComponent(params[key])}`;
    }
  }
  const res = await fetch(url);
  return res.json();
}

async function apiPost(action, payload) {
  const res = await fetch(WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, payload))
  });
  return res.json();
}

/**
 * Fetches everything the Home page needs in ONE Apps Script call instead of
 * five. Each Apps Script call pays a flat ~1-1.3s dispatch overhead
 * regardless of payload size, so five separate calls cost roughly 5x what
 * one combined call costs. Not day-cached - this is all live data that can
 * change anytime (new entries, admin actions), unlike players/boxes.
 * Returns already-unwrapped shapes matching the individual fetch* functions.
 */
async function fetchHomeBundle_() {
  const result = await apiGet('homeBundle');
  const data = (result.success && result.data) || {};
  return {
    standings: (data.standings && data.standings.entries) || [],
    config: data.config || {},
    starsOfNight: data.starsOfNight || null,
    recentActivity: data.recentActivity || [],
    divisionLeaders: data.divisionLeaders || []
  };
}

/**
 * Fetches everything the Sign Up page needs in ONE Apps Script call instead
 * of three. Day-cached as a single unit, same rationale as fetchPlayers/
 * fetchBoxes/fetchLastSeasonStandings below.
 */
async function fetchSignupBundle_() {
  return cachedForToday_('aahl_cache_signupBundle', async () => {
    const result = await apiGet('signupBundle');
    const data = (result.success && result.data) || {};
    return {
      players: data.players || [],
      boxes: data.boxes || [],
      lastSeasonStandings: (data.lastSeasonStandings && data.lastSeasonStandings.teams) || {}
    };
  });
}

async function fetchStarsOfNight() {
  const result = await apiGet('starsOfNight');
  return result.success ? result.data : null;
}

async function fetchRecentActivity() {
  const result = await apiGet('recentActivity');
  return result.success ? result.data : [];
}

async function fetchEntryPicks(entryId) {
  const result = await apiGet('entryPicks', { entryId });
  return result.success ? result.data : { error: result.error || "Couldn't load picks." };
}

async function fetchDivisionLeadersDisplay() {
  const result = await apiGet('divisionLeadersDisplay');
  return (result.success && result.data) || [];
}

/**
 * Caches data that only changes via the nightly pipeline (player stats,
 * boxes, last-season standings) for the rest of the calendar day. Avoids
 * re-hitting Firestore on every browser reload when nothing's actually
 * changed since last night's run - cuts read volume across every visitor,
 * not just within one session. Falls back to a normal fetch if
 * localStorage is unavailable or the entry is stale/missing.
 */
async function cachedForToday_(key, fetchFn) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.date === today) return cached.data;
    }
  } catch (e) { /* localStorage unavailable - just fetch fresh */ }

  const data = await fetchFn();
  try {
    localStorage.setItem(key, JSON.stringify({ date: today, data }));
  } catch (e) { /* storage full/unavailable - fine, just won't cache */ }
  return data;
}

async function fetchLastSeasonStandings() {
  return cachedForToday_('aahl_cache_lastSeasonStandings', async () => {
    const result = await apiGet('lastSeasonStandings');
    return (result.success && result.data && result.data.teams) || {};
  });
}

async function fetchBoxes() {
  return cachedForToday_('aahl_cache_boxes', async () => {
    const result = await apiGet('boxes');
    return result.success ? result.data : [];
  });
}

async function fetchPlayers() {
  return cachedForToday_('aahl_cache_players', async () => {
    const result = await apiGet('players');
    return result.success ? result.data : [];
  });
}

async function fetchStandings() {
  const result = await apiGet('standings');
  return (result.success && result.data && result.data.entries) || [];
}

async function fetchConfig() {
  const result = await apiGet('config');
  return result.success ? result.data : {};
}

async function fetchIRList() {
  const result = await apiGet('irList');
  return result.success ? result.data : [];
}

async function submitEntry(entry) {
  return apiPost('createEntry', { entry });
}

async function submitRosterMove(entryId, boxId, newPlayerId) {
  return apiPost('requestRosterMove', { entryId, boxId, newPlayerId });
}

async function adminResendEmail(password, entryId) {
  return apiPost('adminResendEmail', { password, entryId });
}

async function findEntryForMoves(entryId, email) {
  return apiGet('findEntryForMoves', { entryId, email });
}

async function sendCombinedChangeEmail(entryId, email, moveIds, divisionChanges) {
  return apiPost('sendCombinedChangeEmail', { entryId, email, moveIds, divisionChanges });
}

async function sendBatchMoveEmail(entryId, email, moveIds) {
  return apiPost('sendBatchMoveEmail', { entryId, email, moveIds });
}

async function sendBatchDivisionEmail(entryId, email, changes) {
  return apiPost('sendBatchDivisionEmail', { entryId, email, changes });
}

async function submitDivisionPickChange(entryId, email, division, newTeamAbbrev) {
  return apiPost('updateDivisionPick', { entryId, email, division, newTeamAbbrev });
}

async function submitBatchTeamChanges(entryId, email, boxChanges, divisionChanges) {
  return apiPost('submitBatchTeamChanges', { entryId, email, boxChanges, divisionChanges });
}

async function submitRosterMoveRequest(entryId, email, boxId, newPlayerId) {
  return apiPost('requestRosterMove', { entryId, email, boxId, newPlayerId });
}

async function adminGetEntryPicks(password, entryId) {
  return apiPost('adminGetEntryPicks', { password, entryId });
}

async function adminGetPendingMoves(password) {
  return apiPost('adminGetPendingMoves', { password });
}

async function adminApproveMove(password, moveId) {
  return apiPost('adminApproveMove', { password, moveId });
}

async function adminRejectMove(password, moveId) {
  return apiPost('adminRejectMove', { password, moveId });
}

async function adminUpdateConfig(password, updates) {
  return apiPost('adminUpdateConfig', { password, updates });
}

async function adminGetEntries(password) {
  return apiPost('adminGetEntries', { password });
}

async function adminApproveEntry(password, entryId) {
  return apiPost('adminApproveEntry', { password, entryId });
}

async function adminRejectEntry(password, entryId) {
  return apiPost('adminRejectEntry', { password, entryId });
}

async function adminSetPayment(password, entryId, received) {
  return apiPost('adminSetPayment', { password, entryId, received });
}

async function adminUpdateEntry(password, entryId, updates) {
  return apiPost('adminUpdateEntry', { password, entryId, updates });
}

async function submitFlagIR(playerId, note) {
  return apiPost('flagPlayerIR', { playerId, note });
}

async function submitClearIR(playerId) {
  return apiPost('clearPlayerIR', { playerId });
}

function computePlayerPoints(player, config) {
  if (!player || !player.stats) return 0;
  const s = player.stats;
  const cfg = config || {};
  const posGroup = (player.position === 'D') ? 'D' : (player.position === 'G' ? 'G' : 'F');

  if (posGroup === 'G') {
    return (s.wins || 0) * (cfg.winPtsG ?? 3)
      + (s.losses || 0) * (cfg.lossPtsG ?? 1)
      + (s.otl || 0) * (cfg.otlPtsG ?? 1.5)
      + (s.shutouts || 0) * (cfg.shutoutPtsG ?? 2)
      + (s.saves || 0) * (cfg.savePtsG ?? 0.02);
  }

  let pts;
  if (posGroup === 'D') {
    pts = (s.goals || 0) * (cfg.goalPtsD ?? 1)
      + (s.assists || 0) * (cfg.assistPtsD ?? 1)
      + (s.sog || 0) * (cfg.sogPtsD ?? 0.11)
      + (s.pim || 0) * (cfg.pimPtsD ?? 0.25);
  } else {
    pts = (s.goals || 0) * (cfg.goalPtsF ?? 1)
      + (s.assists || 0) * (cfg.assistPtsF ?? 1)
      + (s.sog || 0) * (cfg.sogPtsF ?? 0.11);
  }
  pts += (s.hatTricks || 0) * (cfg.hatTrickBonus ?? 3);
  return pts;
}

function formatDeadline(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
}
