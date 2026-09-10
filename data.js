/**
 * data.js
 * All fetch calls to the AAHL 2526 Apps Script Web App.
 * CRITICAL: POST requests must use Content-Type: text/plain;charset=utf-8
 * to avoid CORS preflight (Apps Script can't handle OPTIONS requests).
 */

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzJA2dDY7N2IY9xrwMpr-XYybw2Z8ZWybXTH8Sm7eYn1tR1qBaEAzc8N9Vp2jmM_bYVdA/exec';

// Direct Supabase read access for public, computation-free data only
// (players, boxes, config, ir, cached stars-of-night/last-season docs).
// The publishable key is SAFE to expose here by design - it can only do
// what Row Level Security explicitly allows, which for these tables is
// read-only (see setup_rls.sql). Anything involving real server-side
// computation (standings ranking, activity feed, division leaders) still
// goes through Apps Script below, since moving those would mean
// duplicating business logic, not just changing which URL gets called.
const SUPABASE_DIRECT_URL = 'https://tetgrmgurobacdohhiby.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGdybWd1cm9iYWNkb2hoaWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5Njc4MTYsImV4cCI6MjEwNDU0MzgxNn0.Jn0MdAdYslGv7znS0DFiSUjlZ6rpw0qsvQwiNq63vWk';

const TOTAL_BOXES = 27;
const TOTAL_PICKS = 31; // 27 player boxes + 4 division winner picks
const REQUIRED_BOX_IDS = Array.from({length: 27}, (_, i) => String(i + 1));
const DIVISIONS = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];

/**
 * Fetches a URL and parses JSON, retrying once after a short delay if the
 * first attempt fails or returns non-JSON. Apps Script Web Apps redirect
 * through a googleusercontent.com/macros/echo?... URL, and that redirect
 * target occasionally 404s on the very first hit from a script-driven
 * fetch() (a timing race on Google's end) even though the same URL works
 * fine on direct browser navigation a moment later. A single retry clears
 * this almost every time.
 */
async function fetchJsonWithRetry_(url, options) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) { /* network error - fall through to retry/throw below */ }

    if (attempt === 1) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  throw new Error('Request failed after retry: ' + url);
}

/**
 * Reads an entire table directly from Supabase, bypassing Apps Script
 * entirely. Only used for tables with public SELECT-only RLS policies -
 * see setup_rls.sql. Falls back to null on any failure so callers can
 * fall back to the Apps Script path.
 */
async function supabaseDirectList_(table) {
  try {
    const url = `${SUPABASE_DIRECT_URL}/rest/v1/${table}?select=id,data`;
    const rows = await fetchJsonWithRetry_(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    return (rows || []).map(r => Object.assign({ id: r.id }, r.data));
  } catch (e) {
    return null;
  }
}

/**
 * Reads a single row's data directly from Supabase by id. Same rationale
 * and fallback behavior as supabaseDirectList_.
 */
async function supabaseDirectGet_(table, id) {
  try {
    const url = `${SUPABASE_DIRECT_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=data`;
    const rows = await fetchJsonWithRetry_(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    return (rows && rows.length > 0) ? rows[0].data : null;
  } catch (e) {
    return null;
  }
}

async function apiGet(action, params) {
  let url = `${WEBAPP_URL}?action=${action}`;
  if (params) {
    for (const key in params) {
      url += `&${key}=${encodeURIComponent(params[key])}`;
    }
  }
  try {
    return await fetchJsonWithRetry_(url);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function apiPost(action, payload) {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, payload))
  };
  try {
    return await fetchJsonWithRetry_(WEBAPP_URL, options);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function fetchStarsOfNight() {
  const direct = await supabaseDirectGet_('config', 'starsOfNightCache');
  if (direct !== null) return direct;
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
    const direct = await supabaseDirectGet_('config', 'lastSeasonStandings');
    if (direct !== null) return direct.teams || {};
    const result = await apiGet('lastSeasonStandings');
    return (result.success && result.data && result.data.teams) || {};
  });
}

async function fetchBoxes() {
  return cachedForToday_('aahl_cache_boxes', async () => {
    const direct = await supabaseDirectList_('boxes');
    if (direct !== null) return direct;
    const result = await apiGet('boxes');
    return result.success ? result.data : [];
  });
}

async function fetchPlayers() {
  return cachedForToday_('aahl_cache_players', async () => {
    const direct = await supabaseDirectList_('players');
    if (direct !== null) return direct;
    const result = await apiGet('players');
    return result.success ? result.data : [];
  });
}

async function fetchStandings() {
  const result = await apiGet('standings');
  return (result.success && result.data && result.data.entries) || [];
}

async function fetchConfig() {
  const direct = await supabaseDirectGet_('config', 'season');
  if (direct !== null) return direct;
  const result = await apiGet('config');
  return result.success ? result.data : {};
}

async function fetchIRList() {
  const direct = await supabaseDirectList_('ir');
  if (direct !== null) return direct;
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
