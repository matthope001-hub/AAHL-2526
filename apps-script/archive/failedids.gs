/**
 * Paste into Apps Script, run once, check Execution log.
 * Looks up the 3 failed player IDs from seedPrevStatsForBoxPlayers()
 * against the 'players' collection to identify who they are and why
 * the prevStats fetch likely failed (rookie/no 25-26 season, wrong team
 * that season, etc).
 */
function lookupFailedPrevStatsIds() {
  const ids = ['8482221', '8482657', '8473575'];
  ids.forEach(id => {
    const player = fsGet('players', id);
    if (player) {
      Logger.log(`${id}: ${player.fullName} (${player.team}, ${player.position})`);
    } else {
      Logger.log(`${id}: NOT FOUND in players collection`);
    }
  });
}