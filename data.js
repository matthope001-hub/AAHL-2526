/**
 * data.js
 * All fetch calls to the AAHL 2526 Apps Script Web App.
 * CRITICAL: POST requests must use Content-Type: text/plain;charset=utf-8
 * to avoid CORS preflight (Apps Script can't handle OPTIONS requests).
 */

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzJA2dDY7N2IY9xrwMpr-XYybw2Z8ZWybXTH8Sm7eYn1tR1qBaEAzc8N9Vp2jmM_bYVdA/exec';

const SCORING = {
  goal: 3,
  assist: 2,
  win: 3,
  shutout: 2,
  hatTrick: 5
};

const BOX_LIMITS = { F: 6, D: 4, G: 2 };

async function apiGet(action) {
  const res = await fetch(`${WEBAPP_URL}?action=${action}`);
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

async function fetchPlayers() {
  const result = await apiGet('players');
  return result.success ? result.data : [];
}

async function fetchStandings() {
  const result = await apiGet('standings');
  return result.success && result.data ? result.data.entries : [];
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

async function submitRosterMove(entryId, box, outPlayerId, inPlayerId) {
  return apiPost('requestRosterMove', { entryId, box, outPlayerId, inPlayerId });
}

async function submitApproveEntry(entryId) {
  return apiPost('approveEntry', { entryId });
}

async function submitRejectEntry(entryId) {
  return apiPost('rejectEntry', { entryId });
}

async function submitFlagIR(playerId, note) {
  return apiPost('flagPlayerIR', { playerId, note });
}

async function submitClearIR(playerId) {
  return apiPost('clearPlayerIR', { playerId });
}

function computePlayerPoints(stats) {
  if (!stats) return 0;
  let pts = 0;
  pts += (stats.goals || 0) * SCORING.goal;
  pts += (stats.assists || 0) * SCORING.assist;
  pts += (stats.wins || 0) * SCORING.win;
  pts += (stats.shutouts || 0) * SCORING.shutout;
  pts += (stats.hatTricks || 0) * SCORING.hatTrick;
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
