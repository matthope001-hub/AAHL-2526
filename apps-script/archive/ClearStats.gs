/**
 * One-off: removes any leftover stats docs (should be zero pre-season).
 * Run once to clear the stale test data.
 */
function clearStaleStats() {
  const stats = fsList('stats');
  Logger.log('Found ' + stats.length + ' stats docs.');
  stats.forEach(s => {
    fsDelete('stats', s.id);
    Logger.log('Deleted stats/' + s.id);
  });
  clearListCache('stats');
  Logger.log('Done.');
}

/**
 * One-off: removes all rosterMoves docs (test move history). This is what
 * "move" activity in the Recent Activity feed is built from, so clearing
 * this also clears that part of the activity log. Join events come from
 * actual entries instead - delete those via Admin to clear those too.
 */
function clearAllRosterMoves() {
  const moves = fsList('rosterMoves', true);
  Logger.log('Found ' + moves.length + ' rosterMoves docs.');
  moves.forEach(m => {
    fsDelete('rosterMoves', m.id);
  });
  clearListCache('rosterMoves');
  Logger.log('Deleted ' + moves.length + ' rosterMoves docs.');
}

/**
 * One-off: clears the Stars of the Night / Last Night cache. Both features
 * read from the same doc, so this resets both to "No games played yet."
 */
function clearStarsOfNightCache() {
  fsDelete('config', 'starsOfNightCache');
  clearListCache('config');
  Logger.log('Stars of the Night / Last Night cache cleared.');
}