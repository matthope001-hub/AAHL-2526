/**
 * MoveRepair.gs
 * One-off cleanup for trades made AFTER the season started but auto-applied
 * as free "pre-season" changes (the seasonStartDate bug).
 *
 * 1. Run listMisappliedMoves()  -> logs + emails you every affected trade.
 * 2. Run fixMisappliedMoves()   -> reverts each one to a PENDING move so it
 *                                  shows on the Commissioner page for
 *                                  approve/reject like any normal trade.
 *
 * Note: the original request-time point values can't be reconstructed, so
 * the frozen values use each player's points at the moment the fix runs.
 */

/** Season start used to detect bad moves: seasonStartDate, else deadline. */
function misappliedCutoff_() {
  const config = getConfig();
  return new Date(config.seasonStartDate || config.deadline);
}

/** Pre-season-flagged moves requested after the season actually started. */
function findMisappliedMoves_() {
  const cutoff = misappliedCutoff_();
  return fsList('rosterMoves', true)
    .filter(m => m.preSeason && m.status === 'approved' && new Date(m.requestedAt) >= cutoff)
    .sort((a, b) => (a.requestedAt || '').localeCompare(b.requestedAt || ''));
}

function listMisappliedMoves() {
  const moves = findMisappliedMoves_();
  if (moves.length === 0) { Logger.log('No misapplied moves found.'); return; }

  const lines = moves.map(m => {
    const entry = fsGet('entries', m.entryId);
    const box = fsGet('boxes', m.boxId);
    const outP = fsGet('players', m.outPlayerId);
    const inP = fsGet('players', m.inPlayerId);
    return `${m.requestedAt} | ${entry ? entry.teamName : m.entryId} | ${box ? box.boxLabel : 'Box ' + m.boxId}: ` +
      `${outP ? outP.fullName : m.outPlayerId} → ${inP ? inP.fullName : m.inPlayerId} | moveId ${m.id}`;
  });

  Logger.log(lines.join('\n'));
  const to = getConfig().commissionerEmail || 'matt.hope@rocketmail.com';
  sendFromAahlEmail_(to, `AAHL: ${moves.length} trade(s) auto-applied after season start`,
    `These trades were applied instantly as free pre-season changes after the season started:\n\n${lines.join('\n')}\n\nRun fixMisappliedMoves() to turn them into pending moves for approval.`);
}

function fixMisappliedMoves() {
  const moves = findMisappliedMoves_();
  if (moves.length === 0) { Logger.log('No misapplied moves found.'); return; }

  const config = getConfig();
  const players = fsList('players');
  const playersById = {};
  players.forEach(p => { playersById[p.id] = p; });

  const touchedEntries = {};
  let fixed = 0;

  moves.forEach(m => {
    const entry = touchedEntries[m.entryId] || fsGet('entries', m.entryId);
    if (!entry) { Logger.log(`Skip ${m.id}: entry gone`); return; }

    if (entry.picks[m.boxId] !== m.inPlayerId) {
      Logger.log(`Skip ${m.id}: box ${m.boxId} has changed again since - fix by hand`);
      return;
    }

    // Put the original player back; the swap now waits for approval.
    entry.picks[m.boxId] = m.outPlayerId;
    touchedEntries[m.entryId] = entry;

    const inP = playersById[m.inPlayerId];
    const outP = playersById[m.outPlayerId];
    m.preSeason = false;
    m.status = 'pending';
    m.newPlayerBaselineAtRequest = inP ? computePlayerPoints_(inP, config) : 0;
    m.outPlayerValueAtRequest = outP ? computePlayerPoints_(outP, config) : 0;
    m.bankedAmount = 0;
    m.resolvedAt = null;
    fsSet('rosterMoves', m.id, m);
    fixed++;
  });

  Object.keys(touchedEntries).forEach(id => fsSet('entries', id, touchedEntries[id]));
  clearListCache('entries');
  recomputeStandings();

  Logger.log(`Fixed ${fixed} of ${moves.length} move(s). They now show as pending on the Commissioner page.`);
}
function debugMoves() {
  const c = getConfig();
  Logger.log('deadline=' + c.deadline + ' seasonStartDate=' + c.seasonStartDate + ' picksLocked=' + c.picksLocked);
  fsList('rosterMoves', true).forEach(m => Logger.log(JSON.stringify(m)));
}