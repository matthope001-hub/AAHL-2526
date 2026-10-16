/**
 * Migrate.gs
 * One-time migration: copies every document from Firestore into the
 * matching Supabase table. Safe to run multiple times (upserts, won't
 * duplicate) - useful for re-syncing Supabase with fresh Firestore data
 * while you're still testing, before actually cutting over.
 *
 * Does NOT touch Firestore at all - read-only on that side. Firestore
 * stays the live source of truth until you flip DB_BACKEND yourself.
 */

const MIGRATION_COLLECTIONS = ['entries', 'boxes', 'players', 'rosterMoves', 'config', 'ir', 'standings', 'stats'];
const MIGRATION_BATCH_SIZE = 300;

/**
 * Upserts many rows in one Supabase request instead of one request per
 * document - critical for the 'players' collection specifically, which
 * currently has 1288 docs in Firestore (leftover from before we filtered
 * seedAllPlayers() to pool-only players). One-at-a-time writes at that
 * volume risk the same 6-minute Apps Script execution timeout we hit and
 * fixed earlier for the nightly roster pull.
 */
function batchUpsertSupabase_(collection, rows) {
  const table = supabaseTableName_(collection);
  const url = `${supabaseUrl_()}/rest/v1/${table}`;

  for (let i = 0; i < rows.length; i += MIGRATION_BATCH_SIZE) {
    const chunk = rows.slice(i, i + MIGRATION_BATCH_SIZE);
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: supabaseHeaders_({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code !== 200 && code !== 201 && code !== 204) {
      throw new Error(`batchUpsertSupabase_ failed on ${table} chunk starting at ${i} (${code}): ${response.getContentText()}`);
    }
  }
}

function migrateFirestoreToSupabase() {
  const summary = {};

  MIGRATION_COLLECTIONS.forEach(collection => {
    const docs = fsListFirestore_(collection, true); // skip cache - want current truth
    const firestoreIds = new Set(docs.map(d => d.id));

    const rows = docs.map(doc => {
      const data = Object.assign({}, doc);
      delete data.id; // id is stored as its own column, not inside the jsonb blob
      return { id: doc.id, data: data };
    });

    if (rows.length > 0) {
      batchUpsertSupabase_(collection, rows);
    }

    // True sync, not just upsert: remove anything in Supabase that isn't
    // in Firestore anymore - e.g. leftover test entries/moves/cache docs
    // created while DB_BACKEND was 'supabase' during testing. Without
    // this, re-running the migration only ever adds, never cleans up.
    const supabaseIds = fsListSupabase_(collection, true).map(d => d.id);
    const extraIds = supabaseIds.filter(id => !firestoreIds.has(id));
    if (extraIds.length > 0) {
      batchDeleteSupabase_(collection, extraIds);
    }

    summary[collection] = { firestoreCount: docs.length, written: rows.length, removedExtras: extraIds.length };
    Logger.log(`${collection}: read ${docs.length} from Firestore, wrote ${rows.length} to Supabase, removed ${extraIds.length} stale row(s).`);
  });

  Logger.log('Migration complete: ' + JSON.stringify(summary));
  return summary;
}

/**
 * Compares row counts between Firestore and Supabase per collection, after
 * running the migration - quick sanity check that nothing was dropped.
 */
function verifyMigration() {
  const results = {};

  MIGRATION_COLLECTIONS.forEach(collection => {
    const firestoreCount = fsListFirestore_(collection, true).length;
    const supabaseCount = fsListSupabase_(collection, true).length;
    const match = firestoreCount === supabaseCount;

    results[collection] = { firestoreCount, supabaseCount, match };
    Logger.log(`${collection}: Firestore=${firestoreCount} Supabase=${supabaseCount} ${match ? 'OK' : 'MISMATCH'}`);
  });

  return results;
}