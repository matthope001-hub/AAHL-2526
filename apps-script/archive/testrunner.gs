/**
 * TestRunner.gs
 * Runs every known testXModule() function in one pass instead of finding
 * and clicking through them individually in the function dropdown.
 *
 * IMPORTANT LIMITATION: most test functions Logger.log() their results for
 * a human to read, rather than explicitly asserting and throwing on a
 * wrong result. This runner reliably catches CRASHES (a function throwing
 * an exception) - it does NOT automatically verify that the logged numbers
 * are actually correct. After a PASSED run, it's still worth skimming the
 * full log for anything that looks off, the same way you'd read it if you
 * ran each test individually. This is a safety net for regressions that
 * break something outright, not a replacement for judgment.
 *
 * testStatsModule is deliberately EXCLUDED from the default run - it pulls
 * real historical NHL data and permanently updates real player stat
 * totals with no cleanup step, so running it repeatedly (or after the
 * season starts) would corrupt real season data. Run it manually and only
 * when you specifically mean to.
 */

const ALL_TEST_FUNCTIONS = [
  'testFirestoreCRUD',
  'testSupabaseCRUD',
  'testActiveBackend',
  'testEntriesModule',
  'testPlayersModule',
  'testStandingsModule',
  'testWebAppModule',
  'testConfigIRModule',
  'testRosterMovesModule',
  'testPipelineModule',
  'testCurrentDivisionLeaders',
  'testLastSeasonStandings',
  'testEmailQueueModule'
  // testStatsModule intentionally excluded - see file header.
];

function runAllTests() {
  Logger.log(`Running ${ALL_TEST_FUNCTIONS.length} tests...\n`);
  const results = [];

  ALL_TEST_FUNCTIONS.forEach(name => {
    const fn = globalThis[name];
    if (typeof fn !== 'function') {
      results.push({ name, status: 'SKIPPED', note: 'function not found' });
      Logger.log(`SKIPPED: ${name} (function not found - may have been renamed or removed)`);
      return;
    }

    try {
      fn();
      results.push({ name, status: 'PASSED' });
      Logger.log(`PASSED: ${name}`);
    } catch (err) {
      results.push({ name, status: 'FAILED', error: err.message });
      Logger.log(`FAILED: ${name} - ${err.message}`);
    }
    Logger.log(''); // blank line between tests for readability
  });

  const passed = results.filter(r => r.status === 'PASSED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  const skipped = results.filter(r => r.status === 'SKIPPED').length;

  Logger.log(`=== Test Run Complete: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failed > 0) {
    Logger.log('\nFAILURES:');
    results.filter(r => r.status === 'FAILED').forEach(r => Logger.log(`  ${r.name}: ${r.error}`));
  }
  if (skipped > 0) {
    Logger.log('\nSKIPPED (check if these were renamed/removed intentionally):');
    results.filter(r => r.status === 'SKIPPED').forEach(r => Logger.log(`  ${r.name}`));
  }

  return results;
}