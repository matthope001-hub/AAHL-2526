/**
 * Diagnostic: checks player count and Firestore connectivity directly.
 */
/**
 * Force-clears cache for every collection. Run this if data seems stale.
 */
function clearAllCaches() {
  ['players', 'boxes', 'entries', 'config', 'stats', 'ir'].forEach(c => clearListCache(c));
  Logger.log('All caches cleared.');
}

function diagnosePlayersIssue() {
  try {
    const token = getFirebaseAccessToken();
    Logger.log('Auth token OK.');
  } catch (e) {
    Logger.log('AUTH FAILED: ' + e.message);
    return;
  }

  ['players', 'boxes', 'entries', 'config', 'stats', 'ir'].forEach(collection => {
    try {
      const docs = fsList(collection, true); // skip cache for true ground truth
      Logger.log(`${collection}: ${docs.length} documents`);
      if (collection === 'entries') {
        docs.forEach(e => Logger.log(`  - ${e.teamName} (${e.email})`));
      }
    } catch (e) {
      Logger.log(`${collection}: FAILED - ${e.message}`);
    }
  });
}