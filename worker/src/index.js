/**
 * AAHL member-saves API (Cloudflare Worker).
 *
 * Handles the member-facing saves that used to go to the Apps Script web
 * app, so they answer in a fraction of a second:
 *   POST createEntry            - public sign-up
 *   POST createLateEntry        - sign-up through a one-time late invite link
 *   POST submitBatchTeamChanges - My Team "Submit all changes" (box moves +
 *                                 division picks), also used by Admin trades
 *   GET  findEntryForMoves      - My Team look-up (entry ID + email)
 *   GET  checkLateInvite        - is a late invite link still good?
 *   POST adminGetEntries        - Admin: all entries (password checked)
 *   POST adminGetPendingMoves   - Admin: pending move requests (password checked)
 *   GET  /health                - quick "is it up" check
 *   CRON (every minute, evenings) - live pool points + Today's Games scores
 *                                 during games (see "live points" below)
 *
 * Every rule mirrors the Apps Script versions (Entries.gs, RosterMoves.gs,
 * LateInvite.gs) so behaviour and messages are identical. It saves straight
 * to Supabase, answers the member, then asks Apps Script in the background
 * (WorkerBridge.gs) to do the slow parts: standings recompute, entry count,
 * confirmation / change emails, commissioner alert, pending-moves signal.
 *
 * Retries are safe: the site sends an idempotencyKey with every save, and
 * the Worker derives entry/move IDs from it, so a resent request finds its
 * own earlier write instead of creating a second one.
 *
 * No libraries - plain Worker code, nothing to install.
 *
 * Settings (Cloudflare dashboard -> Worker -> Settings -> Variables):
 *   SUPABASE_URL           plain text, e.g. https://xxxx.supabase.co
 *   APPS_SCRIPT_URL        plain text, the Apps Script web app /exec URL
 *   SUPABASE_SERVICE_KEY   SECRET - same value as the Apps Script property
 *   WORKER_SHARED_SECRET   SECRET - from setupWorkerBridge() in Apps Script
 *   LATE_INVITE_SECRET     SECRET - from setupWorkerBridge() in Apps Script
 *   ADMIN_PASSWORD         SECRET - the commissioner password (optional: without
 *                          it, Admin reads just keep using Apps Script)
 */

const VERSION = '1.2.0';
const DIVISIONS = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
const REQUIRED_BOX_IDS = Array.from({ length: 27 }, (_, i) => String(i + 1));
const MAX_MOVES_PER_ENTRY = 2;
const TRADE_DEADLINE_CUTOFF = '2027-03-01T23:59:59-05:00';
const ALLOWED_ORIGINS = ['https://theaahl.ca', 'https://www.theaahl.ca'];
const TABLES = { rosterMoves: 'roster_moves' };

// ---------------------------------------------------------------- HTTP

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)
    ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(request, obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(request))
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json(request, { ok: true, version: VERSION, configured: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY && env.APPS_SCRIPT_URL), admin: !!env.ADMIN_PASSWORD, live: env.LIVE_POINTS !== 'off' });
    }

    let result;
    try {
      if (request.method === 'GET') {
        const p = url.searchParams;
        switch (p.get('action')) {
          case 'findEntryForMoves': result = await findEntryForMoves(env, p.get('entryId'), p.get('email')); break;
          case 'checkLateInvite': result = await checkLateInvite(env, p.get('token')); break;
          default: result = { success: false, error: 'Unknown action: ' + p.get('action') };
        }
      } else if (request.method === 'POST') {
        let body;
        try { body = JSON.parse(await request.text()); } catch (e) { return json(request, { success: false, error: 'Invalid JSON body' }); }
        switch (body.action) {
          case 'createEntry': result = await createEntry(env, ctx, body, false); break;
          case 'createLateEntry': result = await createEntry(env, ctx, body, true); break;
          case 'submitBatchTeamChanges': result = await submitBatchTeamChanges(env, ctx, body); break;
          case 'adminGetEntries': result = await adminGetEntries(env, body); break;
          case 'adminGetPendingMoves': result = await adminGetPendingMoves(env, body); break;
          default: result = { success: false, error: 'Unknown action: ' + body.action };
        }
      } else {
        result = { success: false, error: 'Method not allowed' };
      }
    } catch (err) {
      console.log('Worker error: ' + (err && err.stack || err));
      result = { success: false, error: (err && err.message) || 'Server error' };
    }
    return json(request, result);
  },

  // Cron trigger (wrangler.toml [triggers]) - live points during games.
  async scheduled(event, env, ctx) {
    if (env.LIVE_POINTS === 'off') return;
    ctx.waitUntil(runLivePoints(env).catch(err => console.log('Live points failed: ' + (err && err.stack || err))));
  }
};

// ------------------------------------------------------------- Supabase

async function sb(env, path, init) {
  init = init || {};
  const key = env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${String(env.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/${path}`, {
    method: init.method || 'GET',
    body: init.body,
    headers: Object.assign({
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'User-Agent': 'AAHL-Worker/1.0' // secret keys reject browser-like user agents
    }, init.headers || {})
  });
  if (!res.ok) throw new Error(`Database error (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const table = c => TABLES[c] || c;
const inList = ids => ids.map(id => encodeURIComponent('"' + String(id).replace(/"/g, '') + '"')).join(',');

async function getDoc(env, coll, id) {
  const rows = await sb(env, `${table(coll)}?id=eq.${encodeURIComponent(id)}&select=data`);
  return rows && rows.length ? rows[0].data : null;
}

async function getDocs(env, coll, ids) {
  const out = {};
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  for (let i = 0; i < uniq.length; i += 40) {
    const rows = await sb(env, `${table(coll)}?id=in.(${inList(uniq.slice(i, i + 40))})&select=id,data`);
    (rows || []).forEach(r => { out[r.id] = Object.assign({ id: r.id }, r.data); });
  }
  return out;
}

async function listWhere(env, coll, field, value) {
  const rows = await sb(env, `${table(coll)}?data->>${field}=eq.${encodeURIComponent(value)}&select=id,data`);
  return (rows || []).map(r => Object.assign({ id: r.id }, r.data));
}

async function setDoc(env, coll, id, data) {
  await sb(env, table(coll), {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id: id, data: data }])
  });
}

async function getConfig(env) {
  return (await getDoc(env, 'config', 'season')) || {};
}

// --------------------------------------------------------------- helpers

function isSeasonStarted(config) {
  if (config.picksLocked) return true;
  const start = config.seasonStartDate || config.deadline;
  return !!(start && new Date() >= new Date(start));
}

function cleanDisplayText(str) {
  if (!str) return str;
  let cleaned = String(str).trim().replace(/\s+/g, ' ');
  if (cleaned === cleaned.toUpperCase() || cleaned === cleaned.toLowerCase()) {
    cleaned = cleaned.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return cleaned;
}

function emailMatches(entry, email) {
  return !!email && String(entry.email || '').toLowerCase() === String(email).toLowerCase();
}

// Same scoring as Standings.gs computePlayerPoints_ (and data.js).
function computePlayerPoints(player, cfg) {
  if (!player || !player.stats) return 0;
  const s = player.stats;
  cfg = cfg || {};
  const pos = player.position === 'D' ? 'D' : (player.position === 'G' ? 'G' : 'F');
  if (pos === 'G') {
    return (s.wins || 0) * (cfg.winPtsG ?? 3) + (s.losses || 0) * (cfg.lossPtsG ?? 1)
      + (s.otl || 0) * (cfg.otlPtsG ?? 1.5) + (s.shutouts || 0) * (cfg.shutoutPtsG ?? 2)
      + (s.saves || 0) * (cfg.savePtsG ?? 0.02);
  }
  let pts;
  if (pos === 'D') {
    pts = (s.goals || 0) * (cfg.goalPtsD ?? 1) + (s.assists || 0) * (cfg.assistPtsD ?? 1)
      + (s.sog || 0) * (cfg.sogPtsD ?? 0.11) + (s.pim || 0) * (cfg.pimPtsD ?? 0.25);
  } else {
    pts = (s.goals || 0) * (cfg.goalPtsF ?? 1) + (s.assists || 0) * (cfg.assistPtsF ?? 1)
      + (s.sog || 0) * (cfg.sogPtsF ?? 0.11);
  }
  return pts + (s.hatTricks || 0) * (cfg.hatTrickBonus ?? 3);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable ID from the request's idempotencyKey, so a retried save reuses it.
async function stableId(seed) {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const h = [...buf.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Background hand-off to Apps Script (WorkerBridge.gs). Never blocks or
// fails the member's save.
function followUp(env, ctx, payload) {
  if (!env.APPS_SCRIPT_URL) return;
  const task = fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: 'workerFollowup', secret: env.WORKER_SHARED_SECRET }, payload)),
    redirect: 'follow'
  }).then(r => r.text()).then(t => console.log('Follow-up: ' + t.slice(0, 200)))
    .catch(err => console.log('Follow-up failed: ' + err.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(task);
}

// ----------------------------------------------------------- late invite

async function signLateInvite(env, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LATE_INVITE_SECRET || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  let bin = '';
  sig.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function validateLateInvite(env, token) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'Missing invite link.' };
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, error: 'This invite link is not valid.' };
  const [nonce, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!env.LATE_INVITE_SECRET || !nonce || !exp || (await signLateInvite(env, nonce + '.' + expRaw)) !== sig) {
    return { valid: false, error: 'This invite link is not valid.' };
  }
  if (Date.now() > exp) return { valid: false, error: 'This invite link has expired.' };
  const used = await listWhere(env, 'entries', 'lateInviteNonce', nonce);
  if (used.length) return { valid: false, error: 'This invite link has already been used.' };
  return { valid: true, nonce: nonce, expiresAt: new Date(exp).toISOString() };
}

async function checkLateInvite(env, token) {
  const v = await validateLateInvite(env, token);
  return v.valid ? { success: true, data: { expiresAt: v.expiresAt } } : { success: false, error: v.error };
}

// ---------------------------------------------------------------- entries

function validateEntry(e) {
  if (!e.teamName) return 'Missing teamName';
  if (!e.ownerName) return 'Missing ownerName';
  if (!e.email) return 'Missing email';
  if (!e.picks) return 'Missing picks';
  if (!e.divisionPicks) return 'Missing division picks';
  for (const boxId of REQUIRED_BOX_IDS) if (!e.picks[boxId]) return `Missing pick for box ${boxId}`;
  for (const d of DIVISIONS) if (!e.divisionPicks[d]) return `Missing division pick for ${d}`;
  return null;
}

async function createEntry(env, ctx, body, late) {
  const data = body.entry || {};
  const config = await getConfig(env);

  let invite = null;
  if (late) {
    invite = await validateLateInvite(env, body.token);
    if (!invite.valid) return { success: false, error: invite.error };
  } else {
    const deadlinePassed = config.deadline && new Date() >= new Date(config.deadline);
    if (config.picksLocked || deadlinePassed) {
      return { success: false, error: 'Picks are locked - the season has started and new entries are no longer accepted.' };
    }
  }

  const invalid = validateEntry(data);
  if (invalid) return { success: false, error: invalid };

  // Retry of a save that already went through: return the same entry.
  const entryId = UUID_RE.test(body.idempotencyKey || '') ? body.idempotencyKey : crypto.randomUUID();
  if (await getDoc(env, 'entries', entryId)) return { success: true, entryId: entryId };

  const cleanEmail = String(data.email).trim().toLowerCase();
  const existing = await listWhere(env, 'entries', 'email', cleanEmail);

  const doc = {
    teamName: cleanDisplayText(data.teamName),
    ownerName: cleanDisplayText(data.ownerName),
    email: cleanEmail,
    boxLabel: data.boxLabel || '',
    entryNum: existing.length + 1,
    approved: false,
    createdAt: new Date().toISOString(),
    picks: data.picks,
    emailPref: data.emailPref || 'Weekly',
    divisionPicks: data.divisionPicks,
    movesUsed: 0,
    paymentReceived: false,
    paymentReceivedAt: null
  };
  if (invite) { doc.lateInviteNonce = invite.nonce; doc.lateEntry = true; }

  await setDoc(env, 'entries', entryId, doc);
  followUp(env, ctx, { kind: 'entryCreated', entryId: entryId });
  return { success: true, entryId: entryId };
}

async function findEntryForMoves(env, entryId, email) {
  const entry = entryId ? await getDoc(env, 'entries', entryId) : null;
  if (!entry) return { success: false, error: 'Entry not found. Check your Entry ID from your confirmation email.' };
  if (!emailMatches(entry, email)) return { success: false, error: 'Email does not match this entry.' };

  const moves = await listWhere(env, 'rosterMoves', 'entryId', entryId);
  const used = moves.filter(m => m.status !== 'rejected' && !m.preSeason).length;
  const config = await getConfig(env);

  return {
    success: true,
    data: {
      entryId: entryId,
      teamName: entry.teamName,
      picks: entry.picks,
      divisionPicks: entry.divisionPicks || {},
      seasonStarted: isSeasonStarted(config),
      movesRemaining: Math.max(0, MAX_MOVES_PER_ENTRY - used),
      moveHistory: moves.map(m => ({
        boxId: m.boxId, outPlayerId: m.outPlayerId, inPlayerId: m.inPlayerId,
        status: m.status, requestedAt: m.requestedAt
      }))
    }
  };
}

// ----------------------------------------------------------- team changes

async function submitBatchTeamChanges(env, ctx, body) {
  const entryId = body.entryId;
  const boxChanges = body.boxChanges || [];
  const divisionChanges = body.divisionChanges || [];

  const entry = entryId ? await getDoc(env, 'entries', entryId) : null;
  if (!entry) return { success: false, error: 'Entry not found' };
  if (!emailMatches(entry, body.email)) return { success: false, error: 'Email does not match this entry' };
  entry.picks = entry.picks || {};
  const before = JSON.stringify([entry.picks, entry.divisionPicks || {}]);

  const config = await getConfig(env);
  const seasonStarted = isSeasonStarted(config);
  if (boxChanges.length > 0 && seasonStarted && new Date() > new Date(TRADE_DEADLINE_CUTOFF)) {
    return { success: false, error: 'The NHL trade deadline has passed - no more roster moves are accepted.' };
  }

  // Move IDs come from the request key, so a retry finds its own moves.
  const idem = body.idempotencyKey || '';
  const moveIdFor = async boxKey => (idem ? stableId(idem + ':' + boxKey) : crypto.randomUUID());
  const plannedIds = {};
  for (const c of boxChanges) plannedIds[String(c.boxId)] = await moveIdFor(String(c.boxId));

  const [boxesById, playersById, existingMoves, alreadySaved] = await Promise.all([
    getDocs(env, 'boxes', boxChanges.map(c => String(c.boxId))),
    getDocs(env, 'players', boxChanges.flatMap(c => [c.newPlayerId, entry.picks[String(c.boxId)]])),
    seasonStarted && boxChanges.length ? listWhere(env, 'rosterMoves', 'entryId', entryId) : Promise.resolve([]),
    idem && boxChanges.length ? getDocs(env, 'rosterMoves', Object.values(plannedIds)) : Promise.resolve({})
  ]);

  const errors = [];
  const appliedBoxChanges = [];
  const appliedDivisionChanges = [];
  let wroteMove = false;
  let usedMoves = existingMoves.filter(m => m.status !== 'rejected' && !m.preSeason && !alreadySaved[m.id]).length;

  for (const change of boxChanges) {
    const boxKey = String(change.boxId);
    const newPlayerId = change.newPlayerId;
    const moveId = plannedIds[boxKey];
    const saved = alreadySaved[moveId];

    if (REQUIRED_BOX_IDS.indexOf(boxKey) === -1) { errors.push(`Box ${boxKey}: invalid box`); continue; }

    if (saved) {
      // Already recorded by an earlier attempt of this same request.
      if (saved.preSeason) entry.picks[boxKey] = saved.inPlayerId;
      else usedMoves++;
      appliedBoxChanges.push({ boxId: boxKey, outPlayerId: saved.outPlayerId, inPlayerId: saved.inPlayerId,
        preSeason: !!saved.preSeason, moveId: moveId, ...(saved.preSeason ? {} : { pending: true }) });
      continue;
    }

    const currentPlayerId = entry.picks[boxKey];
    if (!currentPlayerId) { errors.push(`Box ${boxKey}: no current pick`); continue; }
    if (currentPlayerId === newPlayerId) continue; // no-op, skip silently

    const box = boxesById[boxKey];
    if (!box) { errors.push(`Box ${boxKey}: not found`); continue; }
    if (!(box.players || []).some(p => p.playerId === newPlayerId)) { errors.push(`Box ${boxKey}: player not in this box's options`); continue; }
    const newPlayer = playersById[newPlayerId];
    if (!newPlayer) { errors.push(`Box ${boxKey}: new player not found`); continue; }

    const now = new Date().toISOString();
    if (!seasonStarted) {
      entry.picks[boxKey] = newPlayerId;
      await setDoc(env, 'rosterMoves', moveId, {
        entryId, boxId: boxKey, outPlayerId: currentPlayerId, inPlayerId: newPlayerId,
        newPlayerBaselineAtRequest: 0, outPlayerValueAtRequest: 0, bankedAmount: 0,
        preSeason: true, status: 'approved', requestedAt: now, resolvedAt: now
      });
      wroteMove = true;
      appliedBoxChanges.push({ boxId: boxKey, outPlayerId: currentPlayerId, inPlayerId: newPlayerId, preSeason: true, moveId });
    } else {
      if (usedMoves >= MAX_MOVES_PER_ENTRY) { errors.push(`Box ${boxKey}: move limit (${MAX_MOVES_PER_ENTRY}) reached`); continue; }
      const outPlayer = playersById[currentPlayerId];
      await setDoc(env, 'rosterMoves', moveId, {
        entryId, boxId: boxKey, outPlayerId: currentPlayerId, inPlayerId: newPlayerId,
        newPlayerBaselineAtRequest: computePlayerPoints(newPlayer, config),
        outPlayerValueAtRequest: outPlayer ? computePlayerPoints(outPlayer, config) : 0,
        status: 'pending', requestedAt: now
      });
      wroteMove = true;
      usedMoves++;
      appliedBoxChanges.push({ boxId: boxKey, outPlayerId: currentPlayerId, inPlayerId: newPlayerId, preSeason: false, moveId, pending: true });
    }
  }

  if (divisionChanges.length > 0) {
    if (seasonStarted) {
      divisionChanges.forEach(c => errors.push(`${c.division}: division picks lock once the season starts`));
    } else {
      entry.divisionPicks = entry.divisionPicks || {};
      divisionChanges.forEach(change => {
        if (DIVISIONS.indexOf(change.division) === -1) { errors.push(`${change.division}: invalid division`); return; }
        const oldTeam = entry.divisionPicks[change.division];
        entry.divisionPicks[change.division] = change.newTeamAbbrev;
        appliedDivisionChanges.push({ division: change.division, oldTeam, newTeam: change.newTeamAbbrev });
      });
    }
  }

  const entryChanged = JSON.stringify([entry.picks, entry.divisionPicks || {}]) !== before;
  if (entryChanged) await setDoc(env, 'entries', entryId, entry);

  if (wroteMove || entryChanged) {
    followUp(env, ctx, {
      kind: 'teamChanges',
      entryId,
      preSeasonMoveIds: appliedBoxChanges.filter(c => c.preSeason).map(c => c.moveId),
      divisionChanges: appliedDivisionChanges,
      pendingChanges: appliedBoxChanges.filter(c => c.pending).map(c => ({ boxId: c.boxId, outPlayerId: c.outPlayerId, inPlayerId: c.inPlayerId }))
    });
  }

  return { success: errors.length === 0, appliedBoxChanges, appliedDivisionChanges, errors };
}

export const _test = { computePlayerPoints, cleanDisplayText, signLateInvite, stableId };

// ---------------------------------------------------------- admin reads
// Read-only. Approve / reject / edit stay in Apps Script. If ADMIN_PASSWORD
// isn't set here, or the password doesn't match, the answer carries
// fallback:true and the site asks Apps Script instead (Apps Script stays
// the final word on the password).

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function adminDenied(env, body) {
  if (!env.ADMIN_PASSWORD) return { success: false, fallback: true, error: 'Admin not set up on the Worker' };
  if (!body.password || !safeEqual(body.password, env.ADMIN_PASSWORD)) return { success: false, fallback: true, error: 'Invalid password' };
  return null;
}

async function adminGetEntries(env, body) {
  const denied = adminDenied(env, body);
  if (denied) return denied;
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await sb(env, `entries?select=id,data&order=id&limit=1000&offset=${from}`);
    (rows || []).forEach(r => out.push(Object.assign({ id: r.id }, r.data)));
    if (!rows || rows.length < 1000) break;
  }
  return { success: true, data: out };
}

async function adminGetPendingMoves(env, body) {
  const denied = adminDenied(env, body);
  if (denied) return denied;
  const moves = await listWhere(env, 'rosterMoves', 'status', 'pending');
  if (!moves.length) return { success: true, data: [] };
  const [entries, boxes, players] = await Promise.all([
    getDocs(env, 'entries', moves.map(m => m.entryId)),
    getDocs(env, 'boxes', moves.map(m => m.boxId)),
    getDocs(env, 'players', moves.flatMap(m => [m.outPlayerId, m.inPlayerId]))
  ]);
  return {
    success: true,
    data: moves.map(m => {
      const entry = entries[m.entryId], box = boxes[m.boxId];
      const outP = players[m.outPlayerId], inP = players[m.inPlayerId];
      return {
        moveId: m.id,
        entryId: m.entryId,
        teamName: entry ? entry.teamName : 'Unknown',
        boxLabel: box ? box.boxLabel : `Box ${m.boxId}`,
        outPlayerName: outP ? outP.fullName : m.outPlayerId,
        inPlayerName: inP ? inP.fullName : m.inPlayerId,
        requestedAt: m.requestedAt
      };
    })
  };
}

// ---------------------------------------------------------- live points
// Every minute during games: same work as LivePoints.gs refreshLivePoints_
// (and the score part of TodaysGames.gs), so standings move within a
// minute or two of a goal. Apps Script keeps running every 10 minutes as
// the backup and skips its live points while this is working (it checks
// livePointsWork.workerAt). The 4am run stays the official count.
//
// Kept light for the free plan's CPU limit:
//  - nothing on (no game started, or all final) -> one small read, stop
//  - a game's box score is only re-read when its score/shots/period
//    changed, or every 3 minutes at most (catches penalty minutes)
//  - final games already scored are reused, never re-read
//  - pool lists (players, boxes, picks, scoring) are kept in memory 5 min
//  - livePointsCache / todaysGamesCache are only saved when they changed
// One log line per run: "Live: {...}" (Cloudflare -> aahl-2526 -> Logs).

const NHL_API = 'https://api-web.nhle.com/v1';
const LIVE_REFETCH_MS = 3 * 60000;
const LOOKUP_TTL_MS = 5 * 60000;
let liveLookups_ = null;

function hockeyDay() {
  // ET date, rolling over at 5am (same as TodaysGames.gs getHockeyDay_).
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - 5 * 3600000));
}

async function nhl(path) {
  const res = await fetch(NHL_API + path, { headers: { 'User-Agent': 'AAHL-Worker/1.0' } });
  if (!res.ok) throw new Error('NHL ' + path + ' returned ' + res.status);
  return res.json();
}

async function getConfigDoc(env, id, select) {
  const rows = await sb(env, `config?id=eq.${encodeURIComponent(id)}&select=${select || 'data'}`);
  return rows && rows.length ? rows[0].data : null;
}

async function putConfigDoc(env, id, data) {
  await setDoc(env, 'config', id, data);
}

// Same shape as TodaysGames.gs buildTickerGame_.
function tickerGame(g, records) {
  const raw = g.gameState || '';
  const state = (raw === 'LIVE' || raw === 'CRIT') ? 'live' : (raw === 'FINAL' || raw === 'OFF') ? 'final' : 'pre';
  const pd = g.periodDescriptor || {};
  const num = pd.number || g.period || 0;
  const type = pd.periodType || 'REG';
  const period = type === 'SO' ? 'SO' : type === 'OT' ? 'OT' : num === 1 ? '1st' : num === 2 ? '2nd' : num === 3 ? '3rd' : '';
  const lastType = (g.gameOutcome && g.gameOutcome.lastPeriodType) || type;
  const away = g.awayTeam || {}, home = g.homeTeam || {};
  return {
    id: g.id,
    startTimeUTC: g.startTimeUTC,
    away: away.abbrev,
    home: home.abbrev,
    awayRecord: records[away.abbrev] || '',
    homeRecord: records[home.abbrev] || '',
    state: state,
    awayScore: state === 'pre' ? null : (away.score || 0),
    homeScore: state === 'pre' ? null : (home.score || 0),
    period: state === 'live' ? period : '',
    intermission: !!(g.clock && g.clock.inIntermission),
    clock: state === 'live' && g.clock && g.clock.timeRemaining ? String(g.clock.timeRemaining) : '',
    awaySog: state === 'pre' ? null : (away.sog != null ? away.sog : null),
    homeSog: state === 'pre' ? null : (home.sog != null ? home.sog : null),
    finalType: state === 'final' && (lastType === 'OT' || lastType === 'SO') ? lastType : ''
  };
}

function toiSeconds(toi) {
  if (!toi || typeof toi !== 'string') return 0;
  const p = toi.split(':');
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
}

// Same as Stats.gs fetchBoxScoreStats_.
async function boxScoreStats(gameId) {
  const json = await nhl(`/gamecenter/${gameId}/boxscore`);
  const out = [];
  ['awayTeam', 'homeTeam'].forEach(k => {
    const t = json.playerByGameStats && json.playerByGameStats[k];
    if (!t) return;
    ['forwards', 'defense'].forEach(grp => (t[grp] || []).forEach(p => out.push({
      playerId: String(p.playerId), goals: p.goals || 0, assists: p.assists || 0,
      sog: p.sog || 0, pim: p.pim || 0, isGoalie: false, played: toiSeconds(p.toi) > 0
    })));
    const goalies = t.goalies || [];
    const playedCount = goalies.filter(g => toiSeconds(g.toi) > 0).length;
    goalies.forEach(p => {
      const played = toiSeconds(p.toi) > 0;
      out.push({
        playerId: String(p.playerId), goals: 0, assists: 0, sog: 0, pim: 0, isGoalie: true,
        decision: p.decision || null,
        shutout: played && playedCount === 1 && (p.goalsAgainst || 0) === 0,
        saves: p.saves || 0, played: played
      });
    });
  });
  return out;
}

// Pool players (with positions), team picks and scoring - kept 5 min.
async function liveLookups(env) {
  if (liveLookups_ && Date.now() - liveLookups_.at < LOOKUP_TTL_MS) return liveLookups_;
  const [config, boxes, entries] = await Promise.all([
    getConfig(env),
    sb(env, 'boxes?select=data'),
    sb(env, 'entries?select=id,picks:data->picks&limit=1000')
  ]);
  const poolIds = new Set();
  (boxes || []).forEach(b => ((b.data && b.data.players) || []).forEach(p => poolIds.add(String(p.playerId))));
  const ids = [...poolIds];
  const players = {};
  for (let i = 0; i < ids.length; i += 150) {
    const rows = await sb(env, `players?id=in.(${inList(ids.slice(i, i + 150))})&select=id,position:data->>position`);
    (rows || []).forEach(r => { players[r.id] = r.position; });
  }
  liveLookups_ = {
    at: Date.now(), config: config, players: players,
    entries: (entries || []).map(e => ({ id: e.id, picks: e.picks || {} }))
  };
  return liveLookups_;
}

// Same as Stats.gs computeNightPerformers_ (only the fields LivePoints saves).
function scoreNight(byPlayer, stateOf, lk) {
  const players = {};
  for (const id in byPlayer) {
    const pos = lk.players[id];
    if (!pos) continue; // not a pool player
    const d = byPlayer[id];
    const stats = d.isGoalie
      ? { wins: d.decision === 'W' ? 1 : 0, losses: d.decision === 'L' ? 1 : 0, otl: d.decision === 'O' ? 1 : 0, shutouts: d.shutout ? 1 : 0, saves: d.saves || 0 }
      : { goals: d.goals || 0, assists: d.assists || 0, sog: d.sog || 0, pim: d.pim || 0, hatTricks: (d.goals || 0) >= 3 ? 1 : 0 };
    players[id] = {
      pts: Math.round(computePlayerPoints({ position: pos, stats: stats }, lk.config) * 100) / 100,
      goals: d.goals || 0, assists: d.assists || 0, sog: d.sog || 0, pim: d.pim || 0,
      isGoalie: d.isGoalie || false, decision: d.decision || null, shutout: !!d.shutout, saves: d.saves || 0,
      state: stateOf[id] || 'live'
    };
  }
  return players;
}

async function sha256(text) {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function runLivePoints(env) {
  const t0 = Date.now();
  const day = hockeyDay();
  const log = { day: day };

  // 1. Is anything on? (Apps Script builds the day's schedule + records.)
  const cache = await getConfigDoc(env, 'todaysGamesCache');
  if (!cache || cache.date !== day || !(cache.games || []).length) return;
  const now = Date.now();
  const anyOn = cache.games.some(g => g.state !== 'final' && new Date(g.startTimeUTC).getTime() <= now + 60000);
  if (!anyOn) return;

  // 2. Fresh scores for the whole day (one request).
  const feed = await nhl('/score/' + day);
  const games = (feed.games || []).filter(g => g.gameType === 2)
    .map(g => tickerGame(g, cache.records || {}))
    .sort((a, b) => String(a.startTimeUTC).localeCompare(String(b.startTimeUTC)));
  const started = games.filter(g => g.state === 'live' || g.state === 'final');
  log.games = games.length; log.started = started.length;

  // 3. Box scores - only what changed.
  const work = await getConfigDoc(env, 'livePointsWork');
  const same = work && work.date === day;
  const prevStats = (same && work.gameStats) || {};
  const prevStates = (same && work.gameStates) || {};
  const prevSig = (same && work.gameSig) || {};
  const prevAt = (same && work.fetchedAt) || {};
  const gameStats = {}, gameStates = {}, gameSig = {}, fetchedAt = {};
  let fetched = 0, reused = 0, failed = 0;

  await Promise.all(started.map(async g => {
    const id = String(g.id);
    const sig = [g.state, g.awayScore, g.homeScore, g.awaySog, g.homeSog, g.period, g.intermission].join('|');
    gameStates[id] = g.state; gameSig[id] = sig;
    const have = prevStats[id];
    const finalDone = g.state === 'final' && prevStates[id] === 'final' && have;
    const unchanged = have && prevSig[id] === sig && now - (prevAt[id] || 0) < LIVE_REFETCH_MS;
    if (finalDone || unchanged) { gameStats[id] = have; fetchedAt[id] = prevAt[id] || now; reused++; return; }
    try {
      gameStats[id] = await boxScoreStats(g.id);
      fetchedAt[id] = now; fetched++;
    } catch (err) {
      console.log('Live: box score ' + id + ' failed - ' + err.message);
      gameStats[id] = have || []; fetchedAt[id] = prevAt[id] || 0; failed++;
    }
  }));
  log.fetched = fetched; log.reused = reused; if (failed) log.failed = failed;

  // 4. Score pool players and total each team.
  const byPlayer = {}, stateOf = {};
  Object.keys(gameStats).forEach(id => (gameStats[id] || []).forEach(s => {
    if (!s.played) return;
    byPlayer[s.playerId] = s; stateOf[s.playerId] = gameStates[id];
  }));
  const lk = await liveLookups(env);
  const players = scoreNight(byPlayer, stateOf, lk);
  const entries = {};
  lk.entries.forEach(e => {
    let total = 0, count = 0;
    Object.keys(e.picks).forEach(box => { const lp = players[e.picks[box]]; if (lp) { total += lp.pts; count++; } });
    entries[e.id] = { pts: Math.round(total * 100) / 100, players: count };
  });
  log.poolPlayers = Object.keys(players).length;

  // 5. Save only what changed.
  const liveSig = await sha256(JSON.stringify([players, entries]));
  const tickerSig = JSON.stringify(games);
  const writes = [];
  if (!same || work.liveSig !== liveSig) {
    writes.push(putConfigDoc(env, 'livePointsCache', { date: day, players: players, entries: entries, updatedAt: new Date().toISOString(), source: 'worker' }));
    log.pointsSaved = true;
  }
  if (JSON.stringify(cache.games) !== tickerSig) {
    writes.push(putConfigDoc(env, 'todaysGamesCache', Object.assign({}, cache, { games: games, updatedAt: new Date().toISOString() })));
    log.scoresSaved = true;
  }
  writes.push(putConfigDoc(env, 'livePointsWork', {
    date: day, gameStats: gameStats, gameStates: gameStates, gameSig: gameSig, fetchedAt: fetchedAt,
    liveSig: liveSig, workerAt: new Date().toISOString()
  }));
  await Promise.all(writes);

  log.ms = Date.now() - t0;
  console.log('Live: ' + JSON.stringify(log));
}
