/**
 * One-off: fixes the current stale totalEntries/prizePool by recalculating
 * from the actual entries in Firestore right now. Run once.
 */
function fixEntryCountNow() {
  recalculateEntryCount_();
  const config = getConfig();
  Logger.log('Fixed. totalEntries: ' + config.totalEntries + ', prizePool: $' + config.prizePool);
}