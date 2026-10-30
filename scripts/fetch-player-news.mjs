// AAHL player news puller - runs in GitHub Actions (Node 20, no dependencies).
// 1. Reads pool players from Supabase.
// 2. Matches each to an ESPN player ID using ESPN team rosters (name, then team as tiebreak).
// 3. Pulls RotoWire news from ESPN in batches of 25, keeps the newest 2 per player.
// 4. Upserts into the player_news table. Never touches any other table.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

const ESPN = 'https://site.api.espn.com/apis';
const ITEMS_PER_PLAYER = 2;
const BATCH = 25;

// Manual fixes for players the auto-match misses: { 'NHL id': 'ESPN id' }
const OVERRIDES = {
  '8477946': '3114755', // Dylan Larkin
  '8477970': '3114996', // Vitek Vanecek
  '8479406': '4272674', // Filip Gustavsson
};

// ESPN team abbreviations that differ from the NHL's
const TEAM_FIX = { LA: 'LAK', NJ: 'NJD', SJ: 'SJS', TB: 'TBL', UTAH: 'UTA' };

const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) return await res.json();
      console.warn(`HTTP ${res.status} ${url}`);
    } catch (e) { console.warn(`Fetch error ${url}: ${e.message}`); }
    if (i < tries) await sleep(1500 * i);
  }
  return null;
}

async function loadPoolPlayers() {
  const res = await fetch(`${SB_URL}/rest/v1/players?select=id,data`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase players read failed: ${res.status}`);
  return (await res.json()).map(r => ({ id: String(r.id), name: r.data?.fullName, team: r.data?.team }));
}

async function loadEspnRosters() {
  const teamsJson = await getJson(`${ESPN}/site/v2/sports/hockey/nhl/teams`);
  const teams = teamsJson?.sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team) || [];
  if (!teams.length) throw new Error('Could not load ESPN team list');

  const byName = new Map(); // normalized name -> [{ espnId, team }]
  for (const t of teams) {
    const roster = await getJson(`${ESPN}/site/v2/sports/hockey/nhl/teams/${t.id}/roster`);
    const groups = roster?.athletes || [];
    const athletes = groups.flatMap(g => (g.items ? g.items : [g]));
    const team = TEAM_FIX[t.abbreviation] || t.abbreviation;
    for (const a of athletes) {
      const key = norm(a.fullName || a.displayName);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ espnId: String(a.id), team });
    }
    await sleep(200);
  }
  return byName;
}

function matchPlayers(pool, byName) {
  const matched = [], unmatched = [];
  for (const p of pool) {
    if (OVERRIDES[p.id]) { matched.push({ ...p, espnId: OVERRIDES[p.id] }); continue; }
    const hits = byName.get(norm(p.name)) || [];
    const pick = hits.length === 1 ? hits[0] : hits.find(h => h.team === p.team);
    if (pick) matched.push({ ...p, espnId: pick.espnId });
    else unmatched.push(`${p.name} (${p.team}, NHL ${p.id})`);
  }
  return { matched, unmatched };
}

async function loadNews(matched) {
  const byEspn = new Map(); // espnId -> items[]
  let okBatches = 0;
  for (let i = 0; i < matched.length; i += BATCH) {
    const chunk = matched.slice(i, i + BATCH);
    const qs = chunk.map(p => `playerId=${p.espnId}`).join('&');
    const json = await getJson(`${ESPN}/fantasy/v2/games/fhl/news/players?${qs}&limit=${chunk.length * 8}`);
    if (!json || !Array.isArray(json.feed)) continue;
    okBatches++;
    for (const it of json.feed) {
      if (it.type !== 'Rotowire' || it.premium) continue;
      const k = String(it.playerId);
      if (!byEspn.has(k)) byEspn.set(k, []);
      byEspn.get(k).push({ headline: it.headline, story: it.story || '', published: it.published });
    }
    await sleep(300);
  }
  return { byEspn, okBatches, totalBatches: Math.ceil(matched.length / BATCH) };
}

async function upsert(rows) {
  const res = await fetch(`${SB_URL}/rest/v1/player_news`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status} ${await res.text()}`);
}

const pool = await loadPoolPlayers();
const byName = await loadEspnRosters();
const { matched, unmatched } = matchPlayers(pool, byName);
console.log(`Pool ${pool.length} | matched ${matched.length} | unmatched ${unmatched.length}`);

const { byEspn, okBatches, totalBatches } = await loadNews(matched);
if (okBatches === 0) throw new Error('No news batches succeeded - leaving existing news untouched');

const now = new Date().toISOString();
const rows = matched.map(p => {
  const items = (byEspn.get(p.espnId) || [])
    .sort((a, b) => (b.published || '').localeCompare(a.published || ''))
    .slice(0, ITEMS_PER_PLAYER);
  return { id: p.id, data: { espnId: p.espnId, items }, updated_at: now };
});
rows.push({ id: '_meta', data: { lastRun: now, matched: matched.length, unmatched, okBatches, totalBatches }, updated_at: now });

await upsert(rows);
console.log(`Saved ${rows.length - 1} players (${okBatches}/${totalBatches} batches ok).`);
if (unmatched.length) console.log('Unmatched:\n  ' + unmatched.join('\n  '));
