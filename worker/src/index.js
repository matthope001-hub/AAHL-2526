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
 *   POST myEntries              - My Team for signed-in members (Supabase Auth)
 *   POST adminSignins           - Admin: who has signed in, how, and which teams (password checked)
 *   GET  checkLateInvite        - is a late invite link still good?
 *   GET  schedule               - NHL weekly schedule grid (Mon-Sun, read-only)
 *   POST adminGetEntries        - Admin: all entries (password checked)
 *   POST adminGetPendingMoves   - Admin: pending move requests (password checked)
 *   GET  /health                - quick "is it up" check
 *   POST /weekly-image          - PNG screenshot of theaahl.ca/weekly.html for the
 *                                 Monday email (WeeklyImage.gs; shared secret)
 *   POST adminRecap             - Admin: rewrite / hide / show the nightly recap
 *   POST adminBoxProjection     - Admin: rebuild next season's box projection now
 *   CRON (mornings)               - "Last Night in the AAHL" recap (Workers AI)
 *                                 + builds the new day's Today's Games schedule
 *   CRON (Mondays)                - next season's box projection (all NHL players)
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

const VERSION = '1.13.0';
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
      return json(request, { ok: true, version: VERSION, configured: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY && env.APPS_SCRIPT_URL), admin: !!env.ADMIN_PASSWORD, live: env.LIVE_POINTS !== 'off', browser: !!env.BROWSER, ai: !!env.AI && env.RECAP !== 'off' });
    }

    if (url.pathname === '/weekly-image') return weeklyImage(request, env);
    // Only "/" carries API calls. Anything else (bot scans for /.aws, .php,
    // .yml...) gets a bare 404 - no CORS, no JSON, no Supabase work.
    if (url.pathname !== '/') return new Response('Not found', { status: 404 });

    let result;
    try {
      if (request.method === 'GET') {
        const p = url.searchParams;
        switch (p.get('action')) {
          case 'findEntryForMoves': result = await findEntryForMoves(env, p.get('entryId'), p.get('email')); break;
          case 'checkLateInvite': result = await checkLateInvite(env, p.get('token')); break;
          case 'schedule': result = await getWeekSchedule(p.get('date')); break;
          case 'highlights': result = await getHighlights(env, p.get('date')); break;
          case 'trades': result = await getTrades(env, p.get('since')); break;
          default: result = { success: false, error: 'Unknown action: ' + p.get('action') };
        }
      } else if (request.method === 'POST') {
        let body;
        try { body = JSON.parse(await request.text()); } catch (e) { return json(request, { success: false, error: 'Invalid JSON body' }); }
        switch (body.action) {
          case 'createEntry': result = await createEntry(env, ctx, body, false); break;
          case 'createLateEntry': result = await createEntry(env, ctx, body, true); break;
          case 'submitBatchTeamChanges': result = await submitBatchTeamChanges(env, ctx, body); break;
          case 'myEntries': result = await myEntries(env, body); break;
          case 'adminSignins': result = await adminSignins(env, body); break;
          case 'adminGetEntries': result = await adminGetEntries(env, body); break;
          case 'adminGetPendingMoves': result = await adminGetPendingMoves(env, body); break;
          case 'adminRecap': result = await adminRecap(env, body); break;
          case 'adminTrades': result = await adminTrades(env, body); break;
          case 'adminBoxProjection': {
            const denied = adminDenied(env, body);
            result = denied ? Object.assign(denied, { fallback: false }) : await buildBoxProjection(env);
            break;
          }
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
    if (event.cron === BOX_PROJECTION_CRON) {
      ctx.waitUntil(buildBoxProjection(env).catch(err => console.log('Box projection failed: ' + (err && err.stack || err))));
      return;
    }
    if (RECAP_CRONS.includes(event.cron)) {
      // New hockey day starts at 5am ET: build today's schedule + records.
      ctx.waitUntil(ensureTodaysGames(env).catch(err => console.log('Today build failed: ' + (err && err.stack || err))));
      if (env.RECAP === 'off') { ctx.waitUntil(saveLiveHealth(env).catch(() => {})); return; }
      ctx.waitUntil(runNightlyRecap(env, false).catch(err => console.log('Recap failed: ' + (err && err.stack || err))));
      return;
    }
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

// ----------------------------------------------------------- signed-in teams

/**
 * Optional sign-in (auth.js). Checks the member's Supabase Auth token with
 * Supabase itself, collects their VERIFIED emails (a confirmed email-link
 * address plus any Google / Microsoft / Facebook accounts they linked), and
 * returns every entry on those emails. The site then opens a team with the
 * normal entry ID + email look-up, so saves are unchanged.
 */
async function myEntries(env, body) {
  const token = body && body.accessToken;
  if (!token) return { success: false, error: 'Not signed in.' };
  const base = String(env.SUPABASE_URL).replace(/\/+$/, '');
  const res = await fetch(base + '/auth/v1/user', {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + token,
      'User-Agent': 'AAHL-Worker/1.0'
    }
  });
  if (!res.ok) return { success: false, error: 'Your sign-in expired. Sign out and sign in again.' };
  const user = await res.json();

  const emails = new Set();
  const identities = [];
  const clean = e => String(e || '').trim().toLowerCase();
  (user.identities || []).forEach(i => {
    const data = i.identity_data || {};
    const email = clean(data.email || (i.provider === 'email' ? user.email : ''));
    if (!email) return;
    // Email-link accounts only count once the link was clicked (confirmed).
    if (i.provider === 'email' && !user.email_confirmed_at) return;
    if (data.email_verified === false) return;
    emails.add(email);
    identities.push({ provider: i.provider, email });
  });
  if (user.email && user.email_confirmed_at) emails.add(clean(user.email));

  const entries = [];
  for (const email of emails) {
    const rows = await listWhere(env, 'entries', 'email', email);
    rows.forEach(e => entries.push({ entryId: e.id, teamName: e.teamName || '', email: clean(e.email) }));
  }
  entries.sort((a, b) => String(a.teamName).localeCompare(String(b.teamName)));
  return { success: true, data: { entries, identities } };
}

/** Admin: every signed-in member - emails, how they sign in, first/last sign-in, teams matched. */
async function adminSignins(env, body) {
  const denied = adminDenied(env, body);
  if (denied) return Object.assign(denied, { fallback: false });
  const base = String(env.SUPABASE_URL).replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_KEY;
  const users = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'User-Agent': 'AAHL-Worker/1.0' }
    });
    if (!res.ok) return { success: false, fallback: false, error: 'Could not read sign-ins (' + res.status + ')' };
    const j = await res.json();
    const list = j.users || [];
    users.push(...list);
    if (list.length < 200) break;
  }

  const byEmail = {};
  let totalTeams = 0;
  for (let from = 0; ; from += 1000) {
    const rows = await sb(env, `entries?select=id,data&order=id&limit=1000&offset=${from}`);
    (rows || []).forEach(r => {
      totalTeams++;
      const e = String((r.data && r.data.email) || '').trim().toLowerCase();
      if (e) (byEmail[e] = byEmail[e] || []).push({ entryId: r.id, teamName: (r.data && r.data.teamName) || r.id });
    });
    if (!rows || rows.length < 1000) break;
  }

  const clean = e => String(e || '').trim().toLowerCase();
  const claimed = new Set();
  const out = users.map(u => {
    const emails = new Set();
    const providers = new Set();
    (u.identities || []).forEach(i => {
      const data = i.identity_data || {};
      providers.add(i.provider);
      const email = clean(data.email || (i.provider === 'email' ? u.email : ''));
      if (!email) return;
      if (i.provider === 'email' && !u.email_confirmed_at) return;
      if (data.email_verified === false) return;
      emails.add(email);
    });
    if (u.email && u.email_confirmed_at) emails.add(clean(u.email));
    const teams = [];
    emails.forEach(e => (byEmail[e] || []).forEach(t => { teams.push(t); claimed.add(t.entryId); }));
    const meta = u.user_metadata || {};
    return {
      email: u.email || [...emails][0] || '',
      name: meta.full_name || meta.name || '',
      emails: [...emails],
      providers: [...providers],
      createdAt: u.created_at || null,
      lastSignIn: u.last_sign_in_at || null,
      teams
    };
  });
  out.sort((a, b) => String(b.lastSignIn || '').localeCompare(String(a.lastSignIn || '')));
  return { success: true, data: { users: out, totals: { users: out.length, teamsClaimed: claimed.size, totalTeams } } };
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
const LIVE_REFETCH_MS = 2 * 60000;   // a live game's box score is re-read at least this often
const LIVE_MAX_FETCH = 4;               // at most this many box scores read per run (keeps CPU low)
let liveWorkMem_ = null;                // last run's work row, kept in memory between runs
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

// Today's Games: builds config/todaysGamesCache for a new hockey day
// (same as TodaysGames.gs refreshTodaysGames). Runs from the morning recap
// crons (5:30/6:30am ET) and from live points if the day is still missing.
// Apps Script keeps its 10-minute trigger as the backup.
async function teamRecords() {
  const records = {};
  const s = await nhl('/standings/now');
  (s.standings || []).forEach(t => {
    const abbrev = t.teamAbbrev && t.teamAbbrev.default;
    if (abbrev) records[abbrev] = (t.wins || 0) + '-' + (t.losses || 0) + '-' + (t.otLosses || 0);
  });
  return records;
}

async function ensureTodaysGames(env, day) {
  day = day || hockeyDay();
  const cache = await getConfigDoc(env, 'todaysGamesCache');
  if (cache && cache.date === day) return cache;
  let records = {};
  try { records = await teamRecords(); }
  catch (err) { console.log('Today: team records failed (games saved without them) - ' + err.message); }
  const feed = await nhl('/score/' + day);
  const games = (feed.games || []).filter(g => g.gameType === 2)
    .map(g => tickerGame(g, records))
    .sort((a, b) => String(a.startTimeUTC).localeCompare(String(b.startTimeUTC)));
  const doc = { date: day, games: games, records: records, updatedAt: new Date().toISOString() };
  await putConfigDoc(env, 'todaysGamesCache', doc);
  console.log('Today: built ' + day + ' - ' + games.length + ' game(s)');
  return doc;
}

async function runLivePoints(env) {
  const t0 = Date.now();
  const day = hockeyDay();
  const log = { day: day };

  // 1. Is anything on? (builds the day's schedule + records if missing)
  const cache = await ensureTodaysGames(env, day);
  if (!cache || !(cache.games || []).length) return;
  const now = Date.now();
  const anyOn = cache.games.some(g => g.state !== 'final' && new Date(g.startTimeUTC).getTime() <= now + 60000);
  if (!anyOn) { await chaseLateClips(env, day, now).catch(err => console.log('Highlights: late clips failed - ' + err.message)); return; }

  // 2. Fresh scores for the whole day (one request).
  const feed = await nhl('/score/' + day);
  const games = (feed.games || []).filter(g => g.gameType === 2)
    .map(g => tickerGame(g, cache.records || {}))
    .sort((a, b) => String(a.startTimeUTC).localeCompare(String(b.startTimeUTC)));
  const started = games.filter(g => g.state === 'live' || g.state === 'final');
  log.games = games.length; log.started = started.length;

  // 3. Box scores - only what changed, and at most LIVE_MAX_FETCH per run
  //    (goal/period changes first, then the longest-waiting). Only pool
  //    players who've played are kept, so the work row stays small.
  const memOk = liveWorkMem_ && liveWorkMem_.date === day && now - (liveWorkMem_.at || 0) < 3 * 60000;
  const work = memOk ? liveWorkMem_.doc : await getConfigDoc(env, 'livePointsWork');
  if (memOk) log.mem = true;
  const same = work && work.date === day;
  const prevStats = (same && work.gameStats) || {};
  const prevStates = (same && work.gameStates) || {};
  const prevSig = (same && work.gameSig) || {};
  const prevAt = (same && work.fetchedAt) || {};
  const lk = await liveLookups(env);
  try { log.highlights = await updateHighlights(env, day, feed.games || [], lk.players); }
  catch (err) { console.log('Highlights: update failed - ' + err.message); }
  const gameStats = {}, gameStates = {}, gameSig = {}, fetchedAt = {};
  let fetched = 0, reused = 0, failed = 0;

  const todo = [];
  started.forEach(g => {
    const id = String(g.id);
    const sig = [g.state, g.awayScore, g.homeScore, g.period, g.intermission].join('|');
    gameStates[id] = g.state; gameSig[id] = sig;
    const have = prevStats[id];
    gameStats[id] = have || [];
    fetchedAt[id] = prevAt[id] || 0;
    const finalDone = g.state === 'final' && prevStates[id] === 'final' && have;
    if (finalDone) { reused++; return; }
    const changed = !have || prevSig[id] !== sig;
    const stale = now - (prevAt[id] || 0) >= LIVE_REFETCH_MS;
    if (changed || stale) todo.push({ g, id, priority: changed ? 0 : 1, age: prevAt[id] || 0 });
    else reused++;
  });
  todo.sort((a, b) => (a.priority - b.priority) || (a.age - b.age));
  const now_ = todo.slice(0, LIVE_MAX_FETCH), later = todo.slice(LIVE_MAX_FETCH);
  later.forEach(t => { if (prevSig[t.id] != null) gameSig[t.id] = prevSig[t.id]; reused++; }); // keep old sig so it's picked up next run
  await Promise.all(now_.map(async ({ g, id }) => {
    try {
      gameStats[id] = (await boxScoreStats(g.id)).filter(x => x.played && lk.players[x.playerId]);
      fetchedAt[id] = now; fetched++;
    } catch (err) {
      console.log('Live: box score ' + id + ' failed - ' + err.message);
      gameSig[id] = prevSig[id]; failed++;
    }
  }));
  log.fetched = fetched; log.reused = reused; if (later.length) log.queued = later.length; if (failed) log.failed = failed;

  // 4. Score pool players and total each team.
  const byPlayer = {}, stateOf = {};
  Object.keys(gameStats).forEach(id => (gameStats[id] || []).forEach(s => {
    if (!s.played) return;
    byPlayer[s.playerId] = s; stateOf[s.playerId] = gameStates[id];
  }));
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
  // Night's running totals (copied to liveHealthHistory by the morning job).
  const h = Object.assign({ runs: 0, fetched: 0, queued: 0, failed: 0, pointsSaves: 0, maxMs: 0, totalMs: 0, maxGames: 0, firstAt: new Date().toISOString() },
    (same && work.health) || {});
  const runMs = Date.now() - t0;
  h.runs++; h.fetched += fetched; h.queued += later.length; h.failed += failed;
  if (log.pointsSaved) h.pointsSaves++;
  h.totalMs += runMs; h.maxMs = Math.max(h.maxMs, runMs);
  h.maxGames = Math.max(h.maxGames, started.filter(g => g.state === 'live').length);
  h.lastAt = new Date().toISOString();
  const workDoc = {
    date: day, gameStats: gameStats, gameStates: gameStates, gameSig: gameSig, fetchedAt: fetchedAt,
    liveSig: liveSig, workerAt: new Date().toISOString(), health: h
  };
  liveWorkMem_ = { date: day, at: now, doc: workDoc };
  writes.push(putConfigDoc(env, 'livePointsWork', workDoc));
  await Promise.all(writes);

  log.ms = Date.now() - t0;
  console.log('Live: ' + JSON.stringify(log));
}

// ----------------------------------------------------------- highlights
// Goal, assist and fight cards for pool players, saved per hockey day in
// config/highlights_YYYY-MM-DD (written only when something changes).
// Goals/assists: the /score feed live points already reads carries every
// goal with its NHL clip ids - no extra NHL requests.
// Fights: the NHL posts no fight video; fighting majors come from each
// game's play-by-play, read every 10 min while live and once at the final
// (at most HL_FIGHT_MAX_FETCH games per run).
// After the last game ends, the feed is re-read every few minutes (up to
// 3 hours) until every clip has been posted.
const BRIGHTCOVE_EMBED = 'https://players.brightcove.net/6415718365001/EXtG1xJ7H_default/index.html?videoId=';
const LATE_CLIP_EVERY_MS = 3 * 60000;
const LATE_CLIP_FOR_MS = 3 * 3600000;
const HL_FIGHT_EVERY_MS = 10 * 60000;
const HL_FIGHT_MAX_FETCH = 2;
let highlightsMem_ = null; // { day, doc, pending, at }

// HockeyFights.com links for fight cards. HockeyFights has no feed, so its
// public fight log is read (pages 1-3, at most every 20 min) and each pool
// fight is matched by date + last name. Only the link is kept; the video
// stays on HockeyFights. Searched for up to 12 hours after the fight.
const HF_BASE = 'https://www.hockeyfights.com';
const HF_EVERY_MS = 20 * 60000;
const HF_FOR_MS = 12 * 3600000;
let hfLog_ = null; // { at, fights: [{ url, date, players: [{ last, team }] }] }

const hfLast_ = name => String(name || '').replace(/^[A-Z]\.\s*/, '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

async function hfFightLog_() {
  if (hfLog_ && Date.now() - hfLog_.at < HF_EVERY_MS) return hfLog_.fights;
  const fights = [];
  for (const page of ['/fightlog', '/fightlog/2', '/fightlog/3']) {
    let html;
    try {
      const res = await fetch(HF_BASE + page, { headers: { 'User-Agent': 'AAHL-Worker/1.0 (+https://theaahl.ca)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      html = await res.text();
    } catch (err) { console.log('Highlights: HockeyFights ' + page + ' failed - ' + err.message); break; }
    const re = /<a[^>]+href="(?:https?:\/\/www\.hockeyfights\.com)?(\/fights\/n?\d+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,400}?)(\d{1,2})\/(\d{1,2})\/(\d{2})/g;
    let m;
    while ((m = re.exec(html))) {
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      const sides = text.split(/\s+vs\.?\s+/i);
      if (sides.length !== 2) continue;
      const players = sides.map(x => {
        const t = x.match(/\(([A-Z]{2,3})\)\s*$/);
        return { last: hfLast_(x.replace(/\([^)]*\)\s*$/, '')), team: t ? t[1] : '' };
      });
      const date = '20' + m[6] + '-' + m[4].padStart(2, '0') + '-' + m[5].padStart(2, '0');
      fights.push({ url: HF_BASE + m[1], date: date, players: players });
    }
  }
  hfLog_ = { at: Date.now(), fights: fights };
  return fights;
}

function hfMatch_(log, day, f) {
  const me = hfLast_(f.name), opp = hfLast_(f.opponent);
  const hit = log.find(x => x.date === day && x.players.some(p => p.last === me) && (!opp || x.players.some(p => p.last === opp)));
  return hit ? hit.url : '';
}

function periodLabel_(pd) {
  pd = pd || {};
  if (pd.periodType === 'OT') return 'OT';
  if (pd.periodType === 'SO') return 'SO';
  return ['', '1st', '2nd', '3rd'][pd.number] || (pd.number ? 'P' + pd.number : '');
}

const gameMatchup_ = g => ((g.awayTeam && g.awayTeam.abbrev) || '') + ' @ ' + ((g.homeTeam && g.homeTeam.abbrev) || '');
const gameStarted_ = g => ['LIVE', 'CRIT', 'FINAL', 'OFF'].includes(g.gameState);
const gameFinal_ = g => g.gameState === 'FINAL' || g.gameState === 'OFF';

function buildGoalItems_(games, poolPlayers) {
  const items = [];
  games.forEach(g => {
    const away = (g.awayTeam && g.awayTeam.abbrev) || '', home = (g.homeTeam && g.homeTeam.abbrev) || '';
    (g.goals || []).forEach(goal => {
      if (goal.periodDescriptor && goal.periodDescriptor.periodType === 'SO') return; // shootout attempts aren't goals
      const scorerId = String(goal.playerId || '');
      const scorer = (goal.name && goal.name.default) || '';
      const base = {
        gameId: g.id, matchup: gameMatchup_(g), team: (goal.teamAbbrev && (goal.teamAbbrev.default || goal.teamAbbrev)) || '',
        period: periodLabel_(goal.periodDescriptor), time: goal.timeInPeriod || '',
        strength: goal.strength || 'ev', modifier: goal.goalModifier && goal.goalModifier !== 'none' ? goal.goalModifier : '',
        score: away + ' ' + (goal.awayScore || 0) + ', ' + home + ' ' + (goal.homeScore || 0),
        clip: goal.highlightClip ? String(goal.highlightClip) : '',
        clipUrl: goal.highlightClipSharingUrl || ''
      };
      const key = g.id + '-' + (goal.periodDescriptor ? goal.periodDescriptor.number : goal.period) + '-' + base.time;
      if (poolPlayers[scorerId]) {
        items.push(Object.assign({ id: key + '-G-' + scorerId, type: 'goal', playerId: scorerId, name: scorer, toDate: goal.goalsToDate || 0 }, base));
      }
      (goal.assists || []).forEach((a, i) => {
        const aid = String(a.playerId || '');
        if (!poolPlayers[aid]) return;
        items.push(Object.assign({
          id: key + '-A-' + aid, type: 'assist', playerId: aid, name: (a.name && a.name.default) || '',
          primary: i === 0, scorer: scorer, toDate: a.assistsToDate || 0
        }, base));
      });
    });
  });
  return items;
}

// Every fighting major in one game (all players - pool filter comes later).
async function gameFights_(gameId) {
  const pbp = await nhl(`/gamecenter/${gameId}/play-by-play`);
  const teams = {};
  [pbp.awayTeam, pbp.homeTeam].forEach(t => { if (t) teams[t.id] = t.abbrev; });
  const who = {};
  (pbp.rosterSpots || []).forEach(r => {
    who[String(r.playerId)] = {
      name: ((r.firstName && r.firstName.default) || '').charAt(0) + '. ' + ((r.lastName && r.lastName.default) || ''),
      team: teams[r.teamId] || ''
    };
  });
  const out = [];
  (pbp.plays || []).forEach(e => {
    const d = e.details || {};
    if (e.typeDescKey !== 'penalty' || d.descKey !== 'fighting' || !d.committedByPlayerId) return;
    const pid = String(d.committedByPlayerId), opp = d.drawnByPlayerId ? String(d.drawnByPlayerId) : '';
    out.push({
      playerId: pid, name: (who[pid] || {}).name || '', team: (who[pid] || {}).team || '',
      opponent: opp ? (who[opp] || {}).name || '' : '', opponentTeam: opp ? (who[opp] || {}).team || '' : '',
      period: periodLabel_(e.periodDescriptor), time: e.timeInPeriod || ''
    });
  });
  return out;
}

async function highlightsDoc_(env, day) {
  if (highlightsMem_ && highlightsMem_.day === day) return highlightsMem_.doc;
  return (await getConfigDoc(env, 'highlights_' + day)) || null;
}

// all = true (past-day backfill): read every started game's play-by-play.
async function updateHighlights(env, day, games, poolPlayers, saveEmpty, all) {
  games = games.filter(g => g.gameType === 2);
  const prev = await highlightsDoc_(env, day);
  const fights = Object.assign({}, (prev && prev.fights) || {});
  const fightAt = Object.assign({}, (prev && prev.fightAt) || {});
  const fightFinal = Object.assign({}, (prev && prev.fightFinal) || {});
  const now = Date.now();

  const todo = games.filter(gameStarted_).filter(g => {
    const id = String(g.id);
    if (fightFinal[id]) return false;
    return all || gameFinal_(g) || now - (fightAt[id] || 0) >= HL_FIGHT_EVERY_MS;
  }).sort((x, y) => (fightAt[String(x.id)] || 0) - (fightAt[String(y.id)] || 0));
  const batch = all ? todo : todo.slice(0, HL_FIGHT_MAX_FETCH);
  await Promise.all(batch.map(async g => {
    const id = String(g.id);
    try {
      fights[id] = await gameFights_(g.id);
      fightAt[id] = now;
      if (gameFinal_(g)) fightFinal[id] = true;
    } catch (err) { console.log('Highlights: play-by-play ' + id + ' failed - ' + err.message); }
  }));

  const items = buildGoalItems_(games, poolPlayers);
  games.forEach(g => (fights[String(g.id)] || []).forEach(f => {
    if (!poolPlayers[f.playerId]) return;
    items.push(Object.assign({
      id: g.id + '-' + f.period + '-' + f.time + '-F-' + f.playerId, type: 'fight', gameId: g.id, matchup: gameMatchup_(g),
      clip: '', clipUrl: ''
    }, f));
  }));
  // HockeyFights links (kept per fight in doc.hf).
  const hf = Object.assign({}, (prev && prev.hf) || {});
  let hfAt = (prev && prev.hfAt) || 0;
  const needHf = items.filter(i => i.type === 'fight' && !hf[i.id]);
  if (needHf.length && (all || now - hfAt >= HF_EVERY_MS)) {
    const log = await hfFightLog_().catch(() => []);
    hfAt = now;
    needHf.forEach(i => { const url = hfMatch_(log, day, i); if (url) hf[i.id] = url; });
  }
  items.forEach(i => { if (i.type === 'fight' && hf[i.id]) i.hfUrl = hf[i.id]; });
  const order = { '1st': 1, '2nd': 2, '3rd': 3, OT: 4 };
  items.sort((x, y) => String(x.gameId).localeCompare(String(y.gameId)) || ((order[x.period] || 9) - (order[y.period] || 9)) || String(x.time).localeCompare(String(y.time)));

  // Each game's score and state, for the game headers on the page.
  const gameInfo = {};
  games.filter(gameStarted_).forEach(g => {
    const pd = g.periodDescriptor || {};
    gameInfo[String(g.id)] = {
      away: (g.awayTeam && g.awayTeam.abbrev) || '', home: (g.homeTeam && g.homeTeam.abbrev) || '',
      awayScore: (g.awayTeam && g.awayTeam.score) || 0, homeScore: (g.homeTeam && g.homeTeam.score) || 0,
      state: gameFinal_(g) ? 'final' : 'live',
      finalType: gameFinal_(g) && g.gameOutcome && g.gameOutcome.lastPeriodType !== 'REG' ? g.gameOutcome.lastPeriodType : '',
      period: gameFinal_(g) ? '' : periodLabel_(pd)
    };
  });
  const pending = items.filter(i => i.type !== 'fight' && !i.clip).length;
  const sig = await sha256(JSON.stringify([items, gameInfo]));
  const prevSig = prev ? prev.sig : '';
  let doc = prev;
  const fightsChanged = JSON.stringify([fightAt, fightFinal, hfAt]) !== JSON.stringify([(prev && prev.fightAt) || {}, (prev && prev.fightFinal) || {}, (prev && prev.hfAt) || 0]);
  if ((sig !== prevSig && (items.length || prevSig || saveEmpty)) || (fightsChanged && (items.length || prev || saveEmpty))) {
    doc = { date: day, sig: sig, items: items, games: gameInfo, fights: fights, fightAt: fightAt, fightFinal: fightFinal, hf: hf, hfAt: hfAt,
      updatedAt: sig !== prevSig || !prev ? new Date().toISOString() : prev.updatedAt };
    await putConfigDoc(env, 'highlights_' + day, doc);
  }
  highlightsMem_ = { day: day, doc: doc, pending: pending, at: now };
  return { items: items.length, pending: pending, pbp: batch.length, hfMissing: items.filter(i => i.type === 'fight' && !i.hfUrl).length };
}

// No games on: keep re-reading the feed while clips are still missing.
async function chaseLateClips(env, day, now) {
  const doc = await highlightsDoc_(env, day);
  const pending = highlightsMem_ && highlightsMem_.day === day ? highlightsMem_.pending
    : ((doc && doc.items) || []).filter(i => i.type !== 'fight' && !i.clip).length;
  const at = highlightsMem_ && highlightsMem_.day === day ? highlightsMem_.at : 0;
  if (!highlightsMem_ || highlightsMem_.day !== day) highlightsMem_ = { day: day, doc: doc, pending: pending, at: at };
  const needFinal = !!doc && Object.keys(doc.fightAt || {}).some(id => !(doc.fightFinal || {})[id]); // last fight check at the final
  const needHf = !!doc && (doc.items || []).some(i => i.type === 'fight' && !i.hfUrl) && now - new Date(doc.updatedAt).getTime() < HF_FOR_MS
    && now - (doc.hfAt || 0) >= HF_EVERY_MS;
  if (needHf && !pending && !needFinal) {
    const feed = await nhl('/score/' + day);
    const lk = await liveLookups(env);
    console.log('Highlights: HockeyFights check ' + JSON.stringify(await updateHighlights(env, day, feed.games || [], lk.players)));
    return;
  }
  if ((!pending && !needFinal) || now - at < LATE_CLIP_EVERY_MS) return;
  if (!needFinal && doc && now - new Date(doc.updatedAt).getTime() > LATE_CLIP_FOR_MS) { highlightsMem_.pending = 0; return; }
  const feed = await nhl('/score/' + day);
  const lk = await liveLookups(env);
  const r = await updateHighlights(env, day, feed.games || [], lk.players);
  console.log('Highlights: late clip check ' + JSON.stringify(r));
}

// A past day with no saved highlights (or still missing clips) is built
// from that day's NHL feeds the first time someone opens it.
const BACKFILL_DAYS = 14;
const BACKFILL_RETRY_MS = 10 * 60000;
async function getHighlights(env, date) {
  const today = hockeyDay();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : today;
  let doc = await getConfigDoc(env, 'highlights_' + day);
  const ageDays = (new Date(today + 'T12:00:00Z') - new Date(day + 'T12:00:00Z')) / 86400000;
  const pending = doc && (doc.items || []).some(i => i.type !== 'fight' && !i.clip);
  const noFights = doc && (!doc.fightAt || !doc.games || (!doc.hfAt && (doc.items || []).some(i => i.type === 'fight'))); // saved before fight cards / HockeyFights links existed
  const stale = !doc || noFights || (pending && Date.now() - new Date(doc.checkedAt || doc.updatedAt).getTime() > BACKFILL_RETRY_MS);
  if (ageDays >= 1 && ageDays <= BACKFILL_DAYS && stale) {
    try {
      const [feed, lk] = await Promise.all([nhl('/score/' + day), liveLookups(env)]);
      if (highlightsMem_ && highlightsMem_.day === day) highlightsMem_ = null;
      await updateHighlights(env, day, feed.games || [], lk.players, true, true);
      doc = await getConfigDoc(env, 'highlights_' + day);
      if (doc && pending) await putConfigDoc(env, 'highlights_' + day, Object.assign({}, doc, { checkedAt: new Date().toISOString() }));
    } catch (err) { console.log('Highlights: backfill ' + day + ' failed - ' + err.message); }
  }
  const items = ((doc && doc.items) || []).map(i => Object.assign({}, i, { embed: i.clip ? BRIGHTCOVE_EMBED + i.clip : '' }));
  return { success: true, date: day, items: items, games: (doc && doc.games) || {}, updatedAt: doc ? doc.updatedAt : null };
}

// --------------------------------------------------------------- trades
// Trade Tracker page. Sources, joined here:
//  0. NHL.com's official season trade tracker story (every trade since
//     July 1, one markdown entry each) - the main source of trade details.
//  1. ESPN's free public transactions feed - a second source of details
//     (often late or missing some trades). Each trade shows up once per
//     team ("Acquired X from Y for Z"); the two halves are joined into one.
//  2. NHL rosters - every 30 min, each pool player's NHL team is compared
//     with the last check; a change becomes a "team change" card until the
//     full trade is posted, and confirms trades ("NHL" badge).
//  3. Trades the commissioner adds in Admin (shown until ESPN posts them).
//  4. News headlines - NHL.com stories (tagged with NHL player ids), ESPN
//     news and Sportsnet's RSS feed. A trade headline naming a pool player
//     is a "report"; each source that has one adds a badge on the page.
// Roster check state + manual trades live in config/tradeWatch.
const ESPN_TX = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/transactions';
const TRADES_TTL_MS = 30 * 60000;
const ESPN_TO_NHL = { NJ: 'NJD', TB: 'TBL', LA: 'LAK', SJ: 'SJS', UTAH: 'UTA', UTH: 'UTA', VEG: 'VGK' };
let tradesMem_ = null;
let rosterCheckBusy_ = false;

function tradeNorm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function nhlLogo_(abbr) {
  return abbr ? `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg` : '';
}

// One ESPN row can hold several moves ("Placed X on IR. Acquired Y from
// Z for W.") - each sentence starts with a past-tense verb.
function parseTradeRows_(r) {
  return String(r.description || '').split(/\.\s+(?=[A-Z][a-z]+ed\b)/)
    .map(sentence => parseTradeRow_(Object.assign({}, r, { description: sentence })))
    .filter(Boolean);
}

function parseTradeRow_(r) {
  const text = String(r.description || '').trim().replace(/\.$/, '');
  const t = r.team || {};
  let m = text.match(/^Acquired (.+?) from (.+?) (?:in exchange for|for) (.+)$/i);
  let got, gave, other;
  if (m) { got = m[1]; other = m[2]; gave = m[3]; }
  else {
    m = text.match(/^Traded (.+?) to (.+?) (?:in exchange for|for) (.+)$/i);
    if (!m) return null;
    gave = m[1]; other = m[2]; got = m[3];
  }
  const ab = String(t.abbreviation || '').toUpperCase();
  const logo = (t.logos && t.logos[0] && t.logos[0].href) || '';
  return {
    date: String(r.date || '').slice(0, 10), text: text + '.',
    team: ESPN_TO_NHL[ab] || ab, teamName: t.displayName || other, location: t.location || '', nick: t.name || '',
    logo, got: got.trim(), gave: gave.trim(), other: other.trim()
  };
}

// "N.Y. Rangers" / "Toronto" / "Carolina Hurricanes" -> is it this team?
function tradeOtherIs_(otherText, row) {
  const o = tradeNorm_(otherText);
  return !!((row.nick && o.includes(tradeNorm_(row.nick))) || (row.location && o.includes(tradeNorm_(row.location))));
}

async function espnTrades_(from, to) {
  const dates = from.replace(/-/g, '') + '-' + to.replace(/-/g, '');
  const raw = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`${ESPN_TX}?limit=1000&page=${page}&dates=${dates}`, {
      headers: { 'User-Agent': 'AAHL-Worker/1.0' }, cf: { cacheTtl: 1800, cacheEverything: true }
    });
    if (!res.ok) throw new Error('Transactions feed returned ' + res.status);
    const j = await res.json();
    const tx = j.transactions || [];
    raw.push(...tx);
    if (tx.length < 1000 || page >= (j.pageCount || 1)) break;
  }
  const rows = [].concat(...raw.map(parseTradeRows_));
  const used = new Set();
  const trades = [];
  rows.forEach((a, i) => {
    if (used.has(i)) return;
    used.add(i);
    const j = rows.findIndex((b, k) => !used.has(k) && k !== i && b.team !== a.team &&
      Math.abs(new Date(a.date) - new Date(b.date)) <= 86400000 &&
      ((tradeNorm_(a.got) === tradeNorm_(b.gave) && tradeNorm_(a.gave) === tradeNorm_(b.got)) ||
       (tradeOtherIs_(a.other, b) && tradeOtherIs_(b.other, a))));
    const sides = [{ team: a.team, name: a.teamName, logo: a.logo, gets: a.got }];
    if (j >= 0) {
      used.add(j);
      const b = rows[j];
      sides.push({ team: b.team, name: b.teamName, logo: b.logo, gets: b.got });
    } else {
      sides.push({ team: '', name: a.other, logo: '', gets: a.gave });
    }
    trades.push({ source: 'espn', date: a.date, sides, text: a.text });
  });
  return trades;
}

// ------- NHL.com season trade tracker story (1 outgoing request)
const NHL_TEAM_NAMES = {
  'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF', 'Carolina Hurricanes': 'CAR', 'Columbus Blue Jackets': 'CBJ',
  'Calgary Flames': 'CGY', 'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET',
  'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL',
  'Montréal Canadiens': 'MTL', 'New Jersey Devils': 'NJD', 'Nashville Predators': 'NSH', 'New York Islanders': 'NYI', 'New York Rangers': 'NYR',
  'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'Seattle Kraken': 'SEA', 'San Jose Sharks': 'SJS',
  'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR', 'Utah Mammoth': 'UTA', 'Utah Hockey Club': 'UTA',
  'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Winnipeg Jets': 'WPG', 'Washington Capitals': 'WSH'
};
const MONTHS = { JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12 };

function nhlTeamAbbr_(name) {
  const n = tradeNorm_(name);
  const hit = Object.keys(NHL_TEAM_NAMES).find(k => tradeNorm_(k) === n);
  if (hit) return NHL_TEAM_NAMES[hit];
  const part = Object.keys(NHL_TEAM_NAMES).find(k => n && (tradeNorm_(k).endsWith(' ' + n) || tradeNorm_(k).startsWith(n + ' ')));
  return part ? NHL_TEAM_NAMES[part] : '';
}

async function nhlTrackerTrades_(from) {
  const y = Number(from.slice(0, 4)) - (Number(from.slice(5, 7)) >= 7 ? 0 : 1);
  const slug = `${y}-${String(y + 1).slice(2)}-nhl-trades`;
  const res = await fetch('https://forge-dapi.d3.nhle.com/v2/content/en-us/stories/' + slug, {
    headers: { 'User-Agent': 'AAHL-Worker/1.0 (+https://theaahl.ca)' }, cf: { cacheTtl: 600, cacheEverything: true }
  });
  if (!res.ok) throw new Error('NHL trade tracker returned ' + res.status);
  const j = await res.json();
  const out = [];
  (j.parts || []).forEach(part => {
    if (!part || part.type !== 'markdown') return;
    const text = String(part.content || '').split('|')[0].replace(/\s+/g, ' ').trim();
    const m = text.match(/^\*\*([A-Za-z]+)\.?\s+(\d{1,2}):?\*\*:?\s*(.+?)\s+acquired?\s+(.+?)\s+from\s+(?:the\s+)?(.+?)\s+(?:in exchange for|for)\s+(.+?)\.?$/i);
    if (!m) return;
    const mon = MONTHS[m[1].toUpperCase()];
    if (!mon) return;
    const date = `${mon >= 7 ? y : y + 1}-${String(mon).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    const a = nhlTeamAbbr_(m[3]), b = nhlTeamAbbr_(m[5]);
    out.push({ source: 'tracker', date, text: text.replace(/\*\*/g, ''), sides: [
      { team: a, name: m[3].trim(), logo: nhlLogo_(a), gets: m[4].trim() },
      { team: b, name: m[5].trim(), logo: nhlLogo_(b), gets: m[6].trim() }
    ] });
  });
  return out;
}

// Compares every pool player's NHL team with the last check. Players not on
// any NHL roster (AHL, unsigned) keep their last team. ~41 outgoing requests
// (32 rosters + 6 database + 3 news feeds) - under the free plan's 50 per run.
async function rosterCheck_(env, doc) {
  const [config, boxes] = await Promise.all([getConfig(env), sb(env, 'boxes?select=data')]);
  const season = String(config.currentSeason || '20262027');
  const poolIds = new Set();
  (boxes || []).forEach(b => ((b.data && b.data.players) || []).forEach(p => poolIds.add(String(p.playerId))));
  const ids = [...poolIds];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const [rosters, ...playerRows] = await Promise.all([
    Promise.all(NHL_TEAMS.map(t => nhl('/roster/' + t + '/' + season).then(r => ({ t, r })).catch(() => ({ t, r: null })))),
    ...chunks.map(c => sb(env, `players?id=in.(${inList(c)})&select=id,name:data->>fullName,team:data->>team`))
  ]);
  const info = {};
  playerRows.forEach(rows => (rows || []).forEach(p => { info[String(p.id)] = p; }));
  const now = {};
  rosters.forEach(({ t, r }) => {
    if (!r) return;
    ['forwards', 'defensemen', 'goalies'].forEach(grp => (r[grp] || []).forEach(p => {
      if (poolIds.has(String(p.id))) now[String(p.id)] = t;
    }));
  });
  const base = doc.baseline || {};
  const changes = doc.changes || [];
  const day = hockeyDay();
  poolIds.forEach(id => {
    const was = base[id] || (info[id] && info[id].team) || '';
    const is = now[id];
    if (!is) { if (!base[id] && was) base[id] = was; return; }
    if (was && was !== is && !changes.some(c => c.id === id && c.to === is && c.from === was)) {
      changes.unshift({ id, name: (info[id] && info[id].name) || '', from: was, to: is, date: day, at: new Date().toISOString() });
      console.log(`Trades: ${(info[id] && info[id].name) || id} ${was} -> ${is}`);
    }
    base[id] = is;
  });
  doc.baseline = base;
  doc.changes = changes.slice(0, 200);
  doc.checkedAt = new Date().toISOString();
  doc.rosterTeams = rosters.filter(x => x.r).length;
  await newsCheck_(doc, poolIds, info);
  return doc;
}

// ------- trade reports from news headlines (3 outgoing requests)
const NEWS_TRADE_RE = /\b(traded|trades|trade|acquires?|acquired|acquisition|deal(?:t|s)?\s+to)\b|\b(sends?|ships?)\b.*\bto\b/i;
const NEWS_SKIP_RE = /\b(request|requests|rumou?rs?|tracker|grades?|buzz|board|could|would|should|might|potential|possible|target|targets|interest|interested|candidates?|deadline|needs|ideas|fits?|mock|ranking|rankings|what|why|how|explained|talks|block|blocked|untouchable|linked|eyeing|available|watch)\b|\?/i;
const NEWS_MAX_AGE_MS = 7 * 86400000;

function newsIsTrade_(text) {
  const t = String(text || '');
  return NEWS_TRADE_RE.test(t) && !NEWS_SKIP_RE.test(t);
}

function xmlTag_(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function newsCheck_(doc, poolIds, info) {
  const names = [...poolIds].filter(id => info[id] && info[id].name)
    .map(id => ({ id, name: info[id].name, key: ' ' + tradeNorm_(info[id].name) + ' ' }));
  const found = []; // { id, src, title, at }
  const recent = at => at && Date.now() - new Date(at).getTime() <= NEWS_MAX_AGE_MS;
  const byName = text => { const t = ' ' + tradeNorm_(text) + ' '; return names.filter(n => t.includes(n.key)).map(n => n.id); };
  const sources = doc.sources || {};
  const run = async (src, fn) => {
    try { const n = await fn(); sources[src] = { ok: true, at: new Date().toISOString(), items: n }; }
    catch (err) { sources[src] = { ok: false, at: new Date().toISOString(), error: String(err.message || err).slice(0, 120) }; console.log('Trades: ' + src + ' failed - ' + err.message); }
  };
  const get = async (url, type) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'AAHL-Worker/1.0 (+https://theaahl.ca)', 'Accept': type } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return type.includes('json') ? res.json() : res.text();
  };
  await Promise.all([
    // NHL.com - stories carry player tags with NHL ids, so no name guessing.
    run('nhl.com', async () => {
      const j = await get('https://forge-dapi.d3.nhle.com/v2/content/en-us/stories?$limit=60', 'application/json');
      const items = j.items || [];
      items.forEach(it => {
        const title = it.headline || it.title || '';
        const at = it.contentDate || it.lastUpdatedDate;
        if (!recent(at) || !newsIsTrade_(title)) return;
        (it.tags || []).forEach(tg => {
          const pid = tg && tg.extraData && tg.extraData.playerId;
          if (tg.externalSourceName === 'player' && pid && poolIds.has(String(pid))) found.push({ id: String(pid), src: 'nhl.com', title, at });
        });
      });
      return items.length;
    }),
    run('espn', async () => {
      const j = await get('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=50', 'application/json');
      const items = j.articles || [];
      items.forEach(a => {
        const title = a.headline || '';
        if (!recent(a.published) || !newsIsTrade_(title)) return;
        const cats = (a.categories || []).filter(c => c.type === 'athlete').map(c => c.description || '').join(' ');
        [...new Set(byName(title + ' ' + (a.description || '') + ' ' + cats))].forEach(id => found.push({ id, src: 'espn', title, at: a.published }));
      });
      return items.length;
    }),
    run('sportsnet', async () => {
      const xml = await get('https://www.sportsnet.ca/hockey/nhl/feed/', 'application/rss+xml, application/xml, text/xml');
      const items = xml.split(/<item[\s>]/i).slice(1);
      items.forEach(block => {
        const title = xmlTag_(block, 'title');
        const at = xmlTag_(block, 'pubDate');
        if (!recent(at) || !newsIsTrade_(title)) return;
        [...new Set(byName(title + ' ' + xmlTag_(block, 'description')))].forEach(id => found.push({ id, src: 'sportsnet', title, at: new Date(at).toISOString() }));
      });
      return items.length;
    })
  ]);
  const reports = doc.reports || [];
  found.forEach(f => {
    let r = reports.find(x => x.id === f.id && Date.now() - new Date(x.firstAt).getTime() <= NEWS_MAX_AGE_MS);
    if (!r) {
      r = { id: f.id, name: (info[f.id] && info[f.id].name) || '', date: hockeyDay(), firstAt: new Date().toISOString(), sources: {} };
      reports.unshift(r);
      console.log(`Trades: report for ${r.name || f.id} from ${f.src}`);
    }
    if (!r.sources[f.src]) r.sources[f.src] = { title: f.title.slice(0, 160), at: f.at };
  });
  doc.reports = reports.slice(0, 100);
  doc.sources = sources;
}

async function getTrades(env, since) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(since || '')) ? since : '2026-09-01';
  const to = hockeyDay();
  const key = from + '|' + to;
  if (tradesMem_ && tradesMem_.key === key && Date.now() - tradesMem_.at < TRADES_TTL_MS) return tradesMem_.data;

  let doc = (await getConfigDoc(env, 'tradeWatch')) || {};
  const due = !doc.checkedAt || Date.now() - new Date(doc.checkedAt).getTime() >= TRADES_TTL_MS;
  const [espn, tracker] = await Promise.all([
    espnTrades_(from, to).catch(err => { console.log('Trades: ESPN failed - ' + err.message); return null; }),
    nhlTrackerTrades_(from).catch(err => { console.log('Trades: NHL tracker failed - ' + err.message); return null; }),
    (async () => {
      if (!due || rosterCheckBusy_) return;
      rosterCheckBusy_ = true;
      try {
        doc = await rosterCheck_(env, doc);
        await putConfigDoc(env, 'tradeWatch', doc);
      } catch (err) { console.log('Trades: roster check failed - ' + err.message); }
      finally { rosterCheckBusy_ = false; }
    })()
  ]);

  const pairKey = t => t.sides.map(s => s.team).filter(Boolean).sort().join('-');
  const within = (a, b) => a.sides.some(s => s.team) && a.sides.filter(s => s.team).every(s => b.sides.some(x => x.team === s.team));
  const sameTrade = (a, b) => Math.abs(new Date(a.date) - new Date(b.date)) <= 3 * 86400000 &&
    (pairKey(a) === pairKey(b) || within(a, b) || within(b, a));
  // NHL.com's tracker first; an ESPN trade it already has just adds a
  // confirmation ("also"), otherwise it's listed on its own.
  const trackerList = (tracker || []).filter(t => t.date >= from).map(t => Object.assign(t, { also: [] }));
  const espnOnly = [];
  (espn || []).forEach(e => {
    const t = trackerList.find(x => sameTrade(x, e));
    if (t) { if (!t.also.includes('feed')) t.also.push('feed'); } else espnOnly.push(Object.assign(e, { also: [] }));
  });
  const posted = trackerList.concat(espnOnly);
  // A trade added in Admin is dropped once NHL.com or ESPN posts it.
  const manual = (doc.manual || []).filter(m => m.date >= from && !posted.some(e => sameTrade(e, m)))
    .map(m => Object.assign({}, m, { source: 'manual', also: [], sides: m.sides.map(s => Object.assign({ name: s.team, logo: nhlLogo_(s.team) }, s)) }));
  const trades = posted.concat(manual).sort((x, y) => y.date.localeCompare(x.date));
  const changes = (doc.changes || []).filter(c => c.date >= from);
  const reports = (doc.reports || []).filter(r => r.date >= from);

  const data = { success: true, since: from, trades, changes, reports, nhlTeams: doc.baseline || {},
    espnOk: !!espn, trackerOk: !!tracker, checkedAt: doc.checkedAt || null, updatedAt: new Date().toISOString() };
  tradesMem_ = { key, at: Date.now(), data };
  return data;
}

// Admin -> Trade Tracker: op 'list' | 'add' (date, sides) | 'remove' (id).
async function adminTrades(env, body) {
  const denied = adminDenied(env, body);
  if (denied) return Object.assign(denied, { fallback: false });
  const doc = (await getConfigDoc(env, 'tradeWatch')) || {};
  doc.manual = doc.manual || [];
  if (body.op === 'add') {
    const date = String(body.date || '');
    const sides = (Array.isArray(body.sides) ? body.sides : []).map(s => ({
      team: String(s && s.team || '').toUpperCase(), gets: cleanDisplayText(String(s && s.gets || '')).slice(0, 300)
    }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: 'Pick a date.' };
    if (sides.length !== 2 || sides.some(s => !NHL_TEAMS.includes(s.team) || !s.gets)) return { success: false, error: 'Pick both teams and fill in what each team gets.' };
    if (sides[0].team === sides[1].team) return { success: false, error: 'Pick two different teams.' };
    doc.manual.unshift({ id: 'm' + Date.now().toString(36), date, sides, addedAt: new Date().toISOString() });
    await putConfigDoc(env, 'tradeWatch', doc);
    tradesMem_ = null;
  } else if (body.op === 'remove') {
    const before = doc.manual.length;
    doc.manual = doc.manual.filter(m => m.id !== body.id);
    if (doc.manual.length === before) return { success: false, error: 'Trade not found.' };
    await putConfigDoc(env, 'tradeWatch', doc);
    tradesMem_ = null;
  }
  return { success: true, data: { manual: doc.manual, changes: (doc.changes || []).slice(0, 20), reports: (doc.reports || []).slice(0, 20), sources: doc.sources || {}, checkedAt: doc.checkedAt || null } };
}

// --------------------------------------------------------- weekly image
// Screenshot of theaahl.ca/weekly.html (1200 x 675 PNG) for the Monday
// summary email. Only Apps Script can ask (WORKER_SHARED_SECRET).
// Uses Cloudflare Browser Rendering (the [browser] binding) - the free
// plan's daily browser time is plenty for one picture a week.
const WEEKLY_PAGE = 'https://theaahl.ca/weekly.html';

async function weeklyImage(request, env) {
  const fail = (status, error) => new Response(JSON.stringify({ success: false, error }), { status, headers: { 'Content-Type': 'application/json' } });
  if (request.method !== 'POST') return fail(405, 'Method not allowed');
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return fail(400, 'Invalid JSON body'); }
  if (!env.WORKER_SHARED_SECRET || !safeEqual(body.secret, env.WORKER_SHARED_SECRET)) return fail(401, 'Unauthorized');
  if (!env.BROWSER || typeof env.BROWSER.quickAction !== 'function') return fail(503, 'Browser Rendering not set up');

  const week = /^\d{4}-\d{2}-\d{2}$/.test(body.start || '') && /^\d{4}-\d{2}-\d{2}$/.test(body.end || '')
    ? `?start=${body.start}&end=${body.end}` : '';
  try {
    const shot = await env.BROWSER.quickAction('screenshot', {
      url: WEEKLY_PAGE + week + (week ? '&' : '?') + 'v=' + Date.now(), // skip any cached copy
      viewport: { width: 1200, height: 675, deviceScaleFactor: 1 },
      gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
      screenshotOptions: { type: 'png' }
    });
    const res = shot instanceof Response ? shot : new Response(shot);
    if (!res.ok) return fail(502, 'Screenshot failed (' + res.status + '): ' + (await res.text()).slice(0, 200));
    const png = await res.arrayBuffer();
    console.log('Weekly image: ' + png.byteLength + ' bytes' + (week ? ' for ' + body.start + '..' + body.end : ''));
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.log('Weekly image failed: ' + (err && err.stack || err));
    return fail(502, (err && err.message) || 'Screenshot failed');
  }
}

// --------------------------------------------------------- nightly recap
// "Last Night in the AAHL": 2-3 fun sentences written by Workers AI from
// facts the 4am run already saved (Stars of the Night + Points Race).
// Runs a few times each morning (wrangler.toml); the first run after both
// are saved for the same night writes it, later runs skip. The AI only
// gets the facts and every number it writes is checked against them -
// if anything's off, a plain template is used instead.
// Saved to config/nightlyRecap (public; Home shows it). Admin can rewrite
// or hide it (adminRecap). Off switch: Worker variable RECAP = off.

const RECAP_CRONS = ['30 9,10,11 * * *'];
// Tried in order (the first is better at sticking to the facts; the second
// is a smaller backup). Old llama-3.1-8b-instruct was retired May 2026.
const RECAP_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const f1 = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
const ordinal = (n) => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th')); };
const shortDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

function playerLine(p) {
  if (p.isGoalie) {
    const dec = p.decision === 'W' ? 'win' : p.decision === 'L' ? 'loss' : p.decision === 'O' ? 'OT loss' : 'no decision';
    return `${p.saves || 0} saves, ${dec}${p.shutout ? ', shutout' : ''}`;
  }
  const g = p.goals || 0, a = p.assists || 0;
  return `${g + a} point${g + a === 1 ? '' : 's'} (${g}G ${a}A)${g >= 3 ? ', hat trick' : ''}`;
}

// The facts for one night, or null if the 4am data isn't in yet.
async function recapFacts(env) {
  const [stars, race] = await Promise.all([getConfigDoc(env, 'starsOfNightCache'), getConfigDoc(env, 'pointsRaceHistory')]);
  if (!stars || !stars.date || !race || !race.dates || race.dates.length < 2 || !race.teams) return null;
  const i = race.dates.indexOf(stars.date);
  if (i < 1) return null; // Points Race not saved for that night yet
  const ids = Object.keys(race.teams);
  const rankAt = (idx) => {
    const out = {};
    ids.filter(id => race.teams[id].pts[idx] != null).sort((a, b) => race.teams[b].pts[idx] - race.teams[a].pts[idx]).forEach((id, k) => { out[id] = k + 1; });
    return out;
  };
  const before = rankAt(i - 1), after = rankAt(i);
  const teams = ids.map(id => {
    const t = race.teams[id];
    const now = t.pts[i], prev = t.pts[i - 1];
    return { id, name: t.name, gain: now != null && prev != null ? r2(now - prev) : null, rank: after[id], was: before[id], pts: now };
  }).filter(t => t.gain != null);
  if (!teams.length) return null;
  const byGain = [...teams].sort((a, b) => b.gain - a.gain);
  const leader = teams.find(t => t.rank === 1);
  const climber = [...teams].filter(t => t.was && t.rank && t.was - t.rank >= 2).sort((a, b) => (b.was - b.rank) - (a.was - a.rank))[0];
  const all = stars.allPerformers || stars.topPerformers || [];
  return {
    date: stars.date,
    night: shortDate(stars.date),
    topPlayers: (stars.topPerformers || all.slice(0, 3)).slice(0, 3).map(p => ({ name: p.fullName, team: p.team, line: playerLine(p), pts: f1(p.pts),
      saves: p.isGoalie ? (p.saves || 0) : null, decision: p.decision || null, shutout: !!p.shutout })),
    hatTricks: all.filter(p => !p.isGoalie && (p.goals || 0) >= 3).map(p => p.fullName),
    shutouts: all.filter(p => p.isGoalie && p.shutout).map(p => `${p.fullName} (${p.saves || 0} saves)`),
    bestTeam: { name: byGain[0].name, gain: f1(byGain[0].gain), rank: byGain[0].rank },
    worstTeam: byGain.length > 1 ? { name: byGain[byGain.length - 1].name, gain: f1(byGain[byGain.length - 1].gain) } : null,
    leader: leader ? { name: leader.name, pts: f1(leader.pts), isNew: leader.was !== 1 } : null,
    climber: climber ? { name: climber.name, from: climber.was, to: climber.rank } : null,
    teamCount: teams.length
  };
}

function recapFactLines(f) {
  const L = [`Night: ${f.night}`];
  f.topPlayers.forEach((p, k) => L.push(`Star ${k + 1}: ${p.name} (${p.team}) - ${p.line}, ${p.pts} pool points`));
  if (f.hatTricks.length) L.push('Hat tricks: ' + f.hatTricks.join(', '));
  if (f.shutouts.length) L.push('Shutouts: ' + f.shutouts.join(', '));
  L.push(`Best pool team of the night: ${f.bestTeam.name}, +${f.bestTeam.gain} points (now ${ordinal(f.bestTeam.rank)} place)`);
  if (f.worstTeam) L.push(`Quietest pool team: ${f.worstTeam.name}, +${f.worstTeam.gain} points`);
  if (f.leader) L.push(`Pool leader: ${f.leader.name} with ${f.leader.pts} points${f.leader.isNew ? ' (NEW leader - took over 1st place last night)' : ' (still in 1st)'}`);
  if (f.climber) L.push(`Biggest climber: ${f.climber.name}, from ${ordinal(f.climber.from)} to ${ordinal(f.climber.to)} place`);
  return L.join('\n');
}

// Plain version if the AI is off, fails, or doesn't pass the check.
function recapTemplate(f) {
  const s = [];
  const p = f.topPlayers[0];
  const day = f.night.split(',')[0];
  if (p && p.saves != null) {
    s.push(`${p.name} led the way ${day}, turning aside ${p.saves} shots${p.decision === 'W' ? ' in a win' : ''}${p.shutout ? ' for a shutout' : ''} for ${p.pts} pool points.`);
  } else if (p) {
    s.push(`${p.name} led the way ${day} with ${p.line.replace(/ \(.*\)/, '')} for ${p.pts} pool points.`);
  }
  s.push(`${f.bestTeam.name} had the best night in the pool at +${f.bestTeam.gain}.`);
  if (f.leader && f.leader.isNew) s.push(`${f.leader.name} moved into 1st place.`);
  else if (f.leader) s.push(`${f.leader.name} stays on top with ${f.leader.pts} points.`);
  return s.join(' ');
}

// Every number in the AI's text must be one we gave it (ordinals and
// small counting words aside), and it must name at least one real player.
function recapCheck(text, f, facts) {
  if (!text || text.length < 60 || text.length > 700) return 'length ' + (text ? text.length : 0);
  const allowed = new Set((facts.match(/\d+(?:\.\d+)?/g) || []).map(Number));
  [1, 2, 3].forEach(n => allowed.add(n));
  const bad = (text.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => !allowed.has(n));
  if (bad.length) return 'number not in the stats: ' + bad.join(', ');
  if (!f.topPlayers.some(p => text.includes(p.name.split(' ').slice(-1)[0]))) return "didn't name the top star";
  return '';
}

async function writeRecap(env, f) {
  const facts = recapFactLines(f);
  if (!env.AI || typeof env.AI.run !== 'function') return { text: recapTemplate(f), source: 'template', note: 'AI not set up' };
  let note = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const model = RECAP_MODELS[attempt - 1];
    try {
      const out = await env.AI.run(model, {
        messages: [
          { role: 'system', content: 'You write the "Last Night in the AAHL" blurb for a friendly fantasy hockey pool website. Write 2 or 3 short, fun sentences in the voice of an upbeat hockey broadcaster. Use ONLY the facts given - never invent stats, scores, players, teams or numbers, and copy numbers exactly as written. Mention the top star and the best pool team; mention the pool leader if they are new. Light teasing of the quietest team is fine, never mean. Plain text only: no hashtags, no emojis, no quotes, no title.' },
          { role: 'user', content: facts }
        ],
        max_tokens: 220,
        temperature: 0.7
      });
      const text = String((out && (out.response || out.result && out.result.response)) || '').replace(/^["\s]+|["\s]+$/g, '').replace(/\s+/g, ' ');
      const problem = recapCheck(text, f, facts);
      if (!problem) return { text, source: 'ai' };
      note = model.split('/').pop() + ': AI text failed the check (' + problem + '): ' + text.slice(0, 200);
      console.log('Recap: ' + note);
    } catch (err) {
      note = model.split('/').pop() + ': AI error: ' + err.message;
      console.log('Recap: ' + note);
    }
  }
  return { text: recapTemplate(f), source: 'template', note };
}

// Keeps the last 21 nights of live-points health in config/liveHealthHistory
// (Admin -> Live Points Health). Runs with the morning recap job.
async function saveLiveHealth(env) {
  const work = await getConfigDoc(env, 'livePointsWork');
  if (!work || !work.health || !work.date) return;
  const hist = (await getConfigDoc(env, 'liveHealthHistory')) || { nights: [] };
  if (hist.nights.some(n => n.date === work.date)) return;
  const h = work.health;
  hist.nights.unshift({ date: work.date, runs: h.runs, fetched: h.fetched, queued: h.queued, failed: h.failed,
    pointsSaves: h.pointsSaves, maxMs: h.maxMs, avgMs: h.runs ? Math.round(h.totalMs / h.runs) : 0,
    maxGames: h.maxGames, firstAt: h.firstAt, lastAt: h.lastAt, games: Object.keys(work.gameStates || {}).length });
  hist.nights = hist.nights.slice(0, 21);
  hist.updatedAt = new Date().toISOString();
  await putConfigDoc(env, 'liveHealthHistory', hist);
}

async function runNightlyRecap(env, force) {
  if (!force) { try { await saveLiveHealth(env); } catch (e) { console.log('Live health save failed: ' + e.message); } }
  const f = await recapFacts(env);
  if (!f) { console.log('Recap: 4am data not in yet - will try again.'); return { success: false, error: "Last night's stats aren't in yet." }; }
  const prev = await getConfigDoc(env, 'nightlyRecap');
  if (!force && prev && prev.date === f.date) return { success: true, skipped: true };
  const r = await writeRecap(env, f);
  const doc = { date: f.date, night: f.night, text: r.text, source: r.source, note: r.note || '', hidden: !!(force && prev && prev.date === f.date && prev.hidden), createdAt: new Date().toISOString() };
  await putConfigDoc(env, 'nightlyRecap', doc);
  console.log('Recap (' + r.source + '): ' + r.text);
  return { success: true, data: doc };
}

async function adminRecap(env, body) {
  const denied = adminDenied(env, body);
  if (denied) return Object.assign(denied, { fallback: false });
  if (body.op === 'regenerate') return runNightlyRecap(env, true);
  if (body.op === 'hide' || body.op === 'show') {
    const doc = await getConfigDoc(env, 'nightlyRecap');
    if (!doc) return { success: false, error: 'No recap yet.' };
    doc.hidden = body.op === 'hide';
    await putConfigDoc(env, 'nightlyRecap', doc);
    return { success: true, data: doc };
  }
  if (body.op === 'get') return { success: true, data: await getConfigDoc(env, 'nightlyRecap') };
  return { success: false, error: 'Unknown recap action' };
}

// ------------------------------------------------- box projection (weekly)
// Next season's boxes are built from this season's pool points. Every NHL
// player who has dressed is included: season totals come from our own
// nightly box-score snapshots (Postgres function season_player_totals - so
// hat tricks count too), names/positions from the 32 NHL team rosters.
// Keeps the top candidates per position (more than the boxes need, so
// there's room to swap) in config/boxProjection, which box-builder.html
// reads. Weekly (Mondays) + Admin "refresh now". Read-only for the pool.

const BOX_PROJECTION_CRON = '0 10 * * 1';
const NHL_TEAMS = ['ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD',
  'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH'];
const PROJECTION_KEEP = { F: 200, D: 70, G: 50 };

async function buildBoxProjection(env) {
  const t0 = Date.now();
  const config = await getConfig(env);
  const seasonStart = String(config.seasonStartDate || '2026-09-01').slice(0, 10);
  // Exact season URL: '/current' redirects, and every redirect counts toward
  // the free plan's 50 outgoing requests per run (32 rosters + 4 database).
  const season = String(config.currentSeason || '20262027');

  const [totals, poolRows, rosters] = await Promise.all([
    sb(env, 'rpc/season_player_totals', { method: 'POST', body: JSON.stringify({ season_start: seasonStart }) }),
    sb(env, 'players?select=id,name:data->>fullName,team:data->>team,position:data->>position,headshot:data->>headshotUrl'),
    Promise.all(NHL_TEAMS.map(t => nhl('/roster/' + t + '/' + season).then(r => ({ t, r })).catch(() => ({ t, r: null }))))
  ]);

  // Who's who: current rosters first, then our own player list as backup.
  const info = {};
  (poolRows || []).forEach(p => { info[p.id] = { name: p.name, team: p.team, position: p.position, headshot: p.headshot }; });
  let rosterTeams = 0;
  rosters.forEach(({ t, r }) => {
    if (!r) return;
    rosterTeams++;
    ['forwards', 'defensemen', 'goalies'].forEach(grp => (r[grp] || []).forEach(p => {
      const name = [(p.firstName && p.firstName.default) || '', (p.lastName && p.lastName.default) || ''].join(' ').trim();
      info[String(p.id)] = { name: name, team: t, position: p.positionCode || (grp === 'goalies' ? 'G' : grp === 'defensemen' ? 'D' : 'C'), headshot: p.headshot || '' };
    }));
  });

  const groupOf = (pos, goalie) => goalie || pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F';
  const ranked = { F: [], D: [], G: [] };
  (totals || []).forEach(t => {
    const who = info[t.player_id];
    if (!who || !who.name) return; // not on an NHL roster now (e.g. sent down) and not in the pool
    const g = groupOf(who.position, t.is_goalie);
    const stats = g === 'G'
      ? { wins: t.wins, losses: t.losses, otl: t.otl, shutouts: t.shutouts, saves: t.saves }
      : { goals: t.goals, assists: t.assists, sog: t.sog, pim: t.pim, hatTricks: t.hat_tricks };
    const pts = computePlayerPoints({ position: g === 'G' ? 'G' : who.position, stats: stats }, config);
    ranked[g].push({
      id: t.player_id, fullName: who.name, team: who.team, position: g === 'G' ? 'G' : who.position, headshotUrl: who.headshot,
      stats: Object.assign({ gamesPlayed: t.gp }, stats), pts: Math.round(pts * 100) / 100
    });
  });
  const players = [];
  Object.keys(ranked).forEach(g => {
    ranked[g].sort((a, b) => b.pts - a.pts);
    players.push(...ranked[g].slice(0, PROJECTION_KEEP[g]));
  });

  // Extra stats for the Box Builder's what-if scoring (not used by the pool):
  // NHL stats reports, only for the players kept (a few requests in total).
  const extrasOk = await addProjectionExtras(players, season).catch(err => { console.log('Box projection extras failed: ' + err.message); return false; });

  const doc = {
    updatedAt: new Date().toISOString(), seasonStart: seasonStart,
    counted: (totals || []).length, rosterTeams: rosterTeams, extras: !!extrasOk,
    maxGames: players.reduce((m, p) => Math.max(m, p.stats.gamesPlayed || 0), 0),
    players: players
  };
  await putConfigDoc(env, 'boxProjection', doc);
  console.log(`Box projection: ${doc.counted} players counted, ${players.length} kept, ${rosterTeams}/32 rosters, ${Date.now() - t0} ms`);
  return { success: true, data: { updatedAt: doc.updatedAt, counted: doc.counted, kept: players.length, rosterTeams: rosterTeams } };
}

const NHL_STATS = 'https://api.nhle.com/stats/rest/en';
async function nhlStatsReport(report, season, ids) {
  const exp = `seasonId=${season} and gameTypeId=2 and playerId in (${ids.join(',')})`;
  const res = await fetch(`${NHL_STATS}/${report}?limit=-1&cayenneExp=${encodeURIComponent(exp)}`, { headers: { 'User-Agent': 'AAHL-Worker/1.0' } });
  if (!res.ok) throw new Error(report + ' returned ' + res.status);
  const j = await res.json();
  return j.data || [];
}

// Adds hits, blocks, PPP, SHP, GWG, +/-, takeaways, giveaways (skaters) and
// goals against (goalies) to each kept player's stats.
async function addProjectionExtras(players, season) {
  const skaters = players.filter(p => p.position !== 'G'), goalies = players.filter(p => p.position === 'G');
  const byId = Object.fromEntries(players.map(p => [String(p.id), p]));
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const skChunks = chunks(skaters.map(p => p.id), 140);
  const jobs = [];
  skChunks.forEach(ids => {
    jobs.push(nhlStatsReport('skater/summary', season, ids).then(rows => rows.forEach(r => {
      const p = byId[String(r.playerId)]; if (!p) return;
      Object.assign(p.stats, { ppp: r.ppPoints || 0, shp: r.shPoints || 0, gwg: r.gameWinningGoals || 0, plusMinus: r.plusMinus || 0 });
    })));
    jobs.push(nhlStatsReport('skater/realtime', season, ids).then(rows => rows.forEach(r => {
      const p = byId[String(r.playerId)]; if (!p) return;
      Object.assign(p.stats, { hits: r.hits || 0, blocks: r.blockedShots || 0, takeaways: r.takeaways || 0, giveaways: r.giveaways || 0 });
    })));
  });
  if (goalies.length) jobs.push(nhlStatsReport('goalie/summary', season, goalies.map(p => p.id)).then(rows => rows.forEach(r => {
    const p = byId[String(r.playerId)]; if (!p) return;
    Object.assign(p.stats, { goalsAgainst: r.goalsAgainst || 0 });
  })));
  await Promise.all(jobs);
  return true;
}

// ---------- Weekly schedule grid (read-only, no Supabase) ----------
// Mon-Sun regular season games from the public NHL API, cached 6h at
// Cloudflare's edge. Shape: { start, end, days: [{ date, games: [{ away, home }] }] }
const SCHEDULE_TZ = 'America/Toronto';

function scheduleYmd_(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHEDULE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function scheduleAddDays_(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function scheduleMondayOf_(dateStr) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : scheduleYmd_(new Date());
  const dow = new Date(ymd + 'T12:00:00Z').getUTCDay() || 7; // 1=Mon ... 7=Sun
  return scheduleAddDays_(ymd, 1 - dow);
}
async function scheduleFetchWeek_(ymd) {
  const res = await fetch('https://api-web.nhle.com/v1/schedule/' + ymd, { cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!res.ok) throw new Error('NHL schedule fetch failed (' + res.status + ')');
  return (await res.json()).gameWeek || [];
}
async function getWeekSchedule(dateStr) {
  const start = scheduleMondayOf_(dateStr);
  let week = await scheduleFetchWeek_(start);
  // NHL sometimes returns fewer than 7 days - fetch again from the first missing date.
  const have = new Set(week.map(d => d.date));
  for (let i = 0; i < 7; i++) {
    const d = scheduleAddDays_(start, i);
    if (!have.has(d)) { week = week.concat(await scheduleFetchWeek_(d)); break; }
  }
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = scheduleAddDays_(start, i);
    const src = week.find(d => d.date === date);
    const games = (src && src.games ? src.games : [])
      .filter(g => g.gameType === 2)
      .map(g => ({ away: g.awayTeam.abbrev, home: g.homeTeam.abbrev }));
    days.push({ date, games });
  }
  return { success: true, data: { start, end: scheduleAddDays_(start, 6), days } };
}
