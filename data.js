/**
 * data.js
 * All fetch calls to the AAHL 2526 Apps Script Web App.
 * CRITICAL: POST requests must use Content-Type: text/plain;charset=utf-8
 * to avoid CORS preflight (Apps Script can't handle OPTIONS requests).
 */

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzJA2dDY7N2IY9xrwMpr-XYybw2Z8ZWybXTH8Sm7eYn1tR1qBaEAzc8N9Vp2jmM_bYVdA/exec';

const TOTAL_BOXES = 24;

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

async function fetchBoxes() {
  const result = await apiGet('boxes');
  return result.success ? result.data : [];
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

async function submitRosterMove(entryId, boxId, newPlayerId) {
  return apiPost('requestRosterMove', { entryId, boxId, newPlayerId });
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
