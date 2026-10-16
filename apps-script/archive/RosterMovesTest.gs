/**
 * RosterMovesTest.gs
 * Exercises the full roster move lifecycle against whichever backend
 * DB_BACKEND currently points at: pre-season instant swap, mid-season
 * pending -> approve, and pending -> reject. Uses real box/player data
 * (not fake IDs) since requestRosterMove validates against a box's actual
 * curated player list.
 *
 * Temporarily overrides config.seasonStartDate to test the mid-season
 * approval flow, then restores it afterward - safe to run against
 * Supabase while it's under DB_BACKEND test mode; do NOT run this while
 * DB_BACKEND is 'firestore' pointed at production, since it briefly
 * changes the real seasonStartDate config value mid-test.
 */

function testRosterMovesModule() {
  const config = getConfig();
  const originalSeasonStartDate = config.seasonStartDate;

  const boxes = fsList('boxes');
  const picks = {};
  boxes.forEach(box => {
    if (box.players && box.players.length > 0) picks[box.id] = box.players[0].playerId;
  });

  const testBox = boxes.find(b => b.players && b.players.length >= 2);
  if (!testBox) {
    Logger.log('No box with 2+ player options found - cannot test moves.');
    return;
  }

  const outPlayerId = testBox.players[0].playerId;
  const inPlayerId = testBox.players[1].playerId;

  const createResult = createEntry({
    teamName: 'Move Test Squad',
    ownerName: 'Move Tester',
    email: 'movetest@example.com',
    picks: picks,
    divisionPicks: { Atlantic: 'TOR', Metropolitan: 'NYR', Central: 'DAL', Pacific: 'VGK' },
    emailPref: 'Daily'
  });
  Logger.log('Create entry: ' + JSON.stringify(createResult));
  if (!createResult.success) return;

  const entryId = createResult.entryId;

  try {
    // --- Test 1: pre-season instant swap (real current config state) ---
    const preSeasonMove = requestRosterMove(entryId, 'movetest@example.com', testBox.id, inPlayerId);
    Logger.log('Pre-season instant move: ' + JSON.stringify(preSeasonMove));

    // --- Test 2: simulate mid-season pending -> approve flow ---
    updateConfig({ seasonStartDate: '2020-01-01T00:00:00Z' }); // force "season started" = true

    const pendingMove = requestRosterMove(entryId, 'movetest@example.com', testBox.id, outPlayerId);
    Logger.log('Pending move request: ' + JSON.stringify(pendingMove));

    if (pendingMove.success) {
      const approveResult = approveRosterMove(pendingMove.moveId);
      Logger.log('Approve move: ' + JSON.stringify(approveResult));
    }

    // --- Test 3: pending -> reject flow ---
    const rejectTestMove = requestRosterMove(entryId, 'movetest@example.com', testBox.id, inPlayerId);
    Logger.log('Second move request (for reject test): ' + JSON.stringify(rejectTestMove));

    if (rejectTestMove.success) {
      const rejectResult = rejectRosterMove(rejectTestMove.moveId);
      Logger.log('Reject move: ' + JSON.stringify(rejectResult));
    }

    Logger.log('Moves remaining before cleanup: ' + getMovesRemaining(entryId));
  } finally {
    // Always restore the real config, even if something above threw.
    updateConfig({ seasonStartDate: originalSeasonStartDate });
    Logger.log('Restored seasonStartDate to: ' + originalSeasonStartDate);

    rejectEntry(entryId);
    Logger.log('Cleaned up test entry.');
  }
}