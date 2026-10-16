/**
 * DbSwitch.gs
 * The ONE place that decides which database backend is live. Every other
 * file in the project calls fsGet/fsSet/fsList/fsDelete exactly as before -
 * they don't know or care which backend is behind it.
 *
 * To cut over from Firestore to Supabase once you've tested it: change
 * DB_BACKEND below to 'supabase', save, redeploy. To roll back instantly,
 * change it back to 'firestore' and redeploy - Firestore data is untouched
 * the whole time Supabase is being tested, so rollback is always available.
 *
 * PER-REQUEST MEMOIZATION: fsGet results are cached in _requestMemo_ for
 * the duration of a single doGet/doPost execution only (reset at the start
 * of each - see WebApp.gs). Real functions like createEntry end up calling
 * getConfig() (fsGet('config','season')) three separate times across
 * createEntry -> recalculateEntryCount_ -> recomputeStandings, each one a
 * fresh network round-trip to Supabase with no caching at all previously.
 * Memoizing collapses those into one fetch, cutting both the baseline
 * latency of writes and the number of chances for any single call to hit
 * a slow tail-latency spike. fsSet/fsDelete update or clear the relevant
 * memo entry so a write is always immediately visible to a later read
 * within the same execution.
 */

const DB_BACKEND = 'supabase'; // 'firestore' | 'supabase'

let _requestMemo_ = {};

/**
 * Clears the per-request memo. Called at the start of every doGet/doPost
 * so memoization never leaks stale data across separate requests, even if
 * Apps Script happens to reuse the same execution context back-to-back.
 */
function resetRequestMemo_() {
  _requestMemo_ = {};
}

function fsGet(collection, docId) {
  const key = collection + '|' + docId;
  if (Object.prototype.hasOwnProperty.call(_requestMemo_, key)) {
    return _requestMemo_[key];
  }
  const result = DB_BACKEND === 'supabase'
    ? fsGetSupabase_(collection, docId)
    : fsGetFirestore_(collection, docId);
  _requestMemo_[key] = result;
  return result;
}

function fsSet(collection, docId, data) {
  const result = DB_BACKEND === 'supabase'
    ? fsSetSupabase_(collection, docId, data)
    : fsSetFirestore_(collection, docId, data);
  _requestMemo_[collection + '|' + docId] = data; // keep memo consistent with what was just written
  return result;
}

function fsList(collection, skipCache) {
  return DB_BACKEND === 'supabase'
    ? fsListSupabase_(collection, skipCache)
    : fsListFirestore_(collection, skipCache);
}

function fsDelete(collection, docId) {
  const result = DB_BACKEND === 'supabase'
    ? fsDeleteSupabase_(collection, docId)
    : fsDeleteFirestore_(collection, docId);
  delete _requestMemo_[collection + '|' + docId];
  return result;
}

/**
 * Quick sanity check: confirms which backend is currently active and that
 * its basic read/write/delete cycle works, without touching real data.
 */
function testActiveBackend() {
  resetRequestMemo_();
  Logger.log(`DB_BACKEND is currently: ${DB_BACKEND}`);
  fsSet('players', 'testPlayer1', { fullName: 'Test Player', team: 'TOR' });
  Logger.log('Write OK: ' + JSON.stringify(fsGet('players', 'testPlayer1')));
  Logger.log('List OK, count: ' + fsList('players', true).length);
  fsDelete('players', 'testPlayer1');
  Logger.log('Delete OK, cleaned up.');
}