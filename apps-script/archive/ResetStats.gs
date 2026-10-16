/**
 * One-off: zeroes out current-season stats for every player, without
 * touching team/position/headshot/prevStats/injuryStatus. Needed because
 * an earlier test run (verifying the stats pipeline against real Jan 2026
 * games) left real numbers baked into ~300 players, and those survived
 * later reseeds since seedAllPlayers now preserves existing in-season stats.
 */
function resetCurrentSeasonStats() {
  const players = fsList('players', true);
  const zeroStats = { goals: 0, assists: 0, sog: 0, pim: 0, wins: 0, losses: 0, otl: 0, shutouts: 0, saves: 0, hatTricks: 0 };

  let reset = 0;
  players.forEach(p => {
    p.stats = zeroStats;
    fsSet('players', p.id, p);
    reset++;
  });

  clearListCache('players');
  Logger.log(`Reset current-season stats for ${reset} players.`);
  return reset;
}