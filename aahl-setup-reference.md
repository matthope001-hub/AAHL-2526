# AAHL 2026-27 — Setup Reference

Where everything lives, what runs when, and how to deploy changes. Last updated Oct 15, 2026.

## How the site fits together

- **Website** (theaahl.ca): GitHub Pages, repo `matthope001-hub/AAHL-2526`. Files: `index.html`, `style.css`, `data.js`, `stats.js`, `signup.js`, `admin.js`, `cards.js`, `main.js` (main.js loads last). Also `manifest.json`, `sw.js` and app icons (installable app).
- **Member saves API**: Cloudflare Worker **aahl-2526** at `https://api.theaahl.ca` (code in the repo's `worker/` folder). See below.
- **Backend**: Google Apps Script project **AAHL-2526-Agent**, deployed as a Web App. Runs admin, nightly jobs, live points, emails and standings.
- **Data**: Supabase. Pages read Supabase directly through the official `supabase-js` library (falls back to plain requests if it doesn't load). The `entries` table is private and only read by Apps Script and the Worker. The `config` table is **publicly readable** — never put secrets in it.

## Cloudflare Worker (member saves)

- Handles: sign-ups, late-invite sign-ups, My Team "Submit all changes" (also Admin trades), My Team look-up, late-link checks. Admin and everything else stay on Apps Script.
- Saves straight to Supabase, answers the member instantly, then calls Apps Script in the background (`WorkerBridge.gs`, doPost action `workerFollowup`) for standings, entry count, emails, commissioner alert and the pending-moves signal.
- Retries are safe: entry/move IDs come from the request's idempotencyKey.
- **On/off switch**: `USE_WORKER` in `data.js`. Each browser checks `api.theaahl.ca/health` first (3s limit, remembered 5 min); if unreachable, everything uses Apps Script, so saves never fail and never duplicate.
- **Health check**: `https://api.theaahl.ca/health` → `{"ok":true,"configured":true}`.
- **Cloudflare build settings** (aahl-2526 → Settings → Build): root directory `worker`; build command empty; deploy command copies the three build secrets into the running Worker:
  `npx wrangler deploy && printf '%s' "$SUPABASE_SERVICE_KEY" | npx wrangler secret put SUPABASE_SERVICE_KEY --name aahl-2526 && ...` (same for WORKER_SHARED_SECRET, LATE_INVITE_SECRET).
- Secrets (stored as Build secrets, copied on every build): `SUPABASE_SERVICE_KEY` (same as the Apps Script property), `WORKER_SHARED_SECRET` and `LATE_INVITE_SECRET` (both printed by `setupWorkerBridge()` in Apps Script).
- Public settings (`SUPABASE_URL`, `APPS_SCRIPT_URL`) are in `worker/wrangler.toml`. If the Apps Script web app URL ever changes, update it there too.
- Every GitHub upload triggers a Worker rebuild (~30s, harmless).
- Logs: aahl-2526 → Logs/Observability ("Follow-up:" lines show what Apps Script reported back).

## Live updates (Supabase Realtime)

- Supabase → Database → Publications → `supabase_realtime`: the `config` table is switched on.
- Standings/Home refresh the moment `livePointsCache` or `todaysGamesCache` is saved (the 3-minute check stays as a backup).
- Admin listens to `config/pendingMovesSignal` (count + time only, written by `touchPendingMovesSignal_` in RosterMoves.gs) and reloads Pending Moves with a banner.

## Apps Script files added or changed this season

| File | What it does | Setup function (run once) |
|---|---|---|
| Stats.gs | Nightly stats, shutouts, games played, 3 Stars tally | — (nightly pipeline) |
| Standings.gs | Points and ranking; division bonus only at season end | — |
| RosterMoves.gs | Roster moves; `buildFullPicksView_` (team popup data); pending-moves signal | — |
| Entries.gs | Entries, confirmation emails (late-entry wording) | — |
| WebApp.gs | Routes website requests (incl. `workerFollowup`). **Redeploy the Web App after changing it** | — |
| WorkerBridge.gs | Background follow-up for Worker saves (standings, emails, alerts) | setupWorkerBridge |
| LateInvite.gs | One-time late-entry invite links (Admin button) | — |
| WeeklySummary.gs | Monday 7am summary email, with the standings picture attached | setupWeeklySummaryTrigger |
| WeeklyImage.gs | Builds the weekly standings picture via a Google Slides file ("AAHL Weekly Image (auto-generated)" in Drive — leave it) | — (test: previewWeeklyImage) |
| WeeklyStars.gs | Players of the Week (F/D/G) + season history; last week's top 10 | setupWeeklyTopTrigger |
| TodaysGames.gs | Today's Games ticker, live scores; also runs live points | setupTodaysGamesTrigger |
| LivePoints.gs | Live pool points during games (estimate until 4am). Box scores kept in `livePointsWork`, so the public `livePointsCache` stays small | — (runs inside TodaysGames; test: testLivePoints) |
| PointsRace.gs | Saves each night's team points (Points Race chart, Records, Team of the Week, weekly image) | setupPointsRaceTrigger |
| PickCounts.gs | "Picked by X of 47" counts | setupPickCountsTrigger |
| Injuries.gs | Automatic IR List from the ESPN injury feed + "not playing" check + Admin overrides | setupInjuriesTrigger (test: testInjuryFeed) |
| DivisionProjection.gs | Division picks currently leading (dots, Div / Projected columns) | setupDivisionProjectionTrigger |
| TeamViews.gs | Pre-built team popups so they load fast | setupTeamViewsTrigger |

## Triggers (12) — check with `listTriggers`

| Function | When |
|---|---|
| nightlyPipeline | Daily ~4am ET (official stats + standings) |
| keepSupabaseAlive | Existing |
| runNightlyBackup | Existing |
| tradeDeadlineAudit | Existing |
| sendWeeklySummary | Mondays 7am ET |
| rebuildWeeklyTopPerformers | Mondays 6am ET |
| refreshTodaysGames | Every 10 min (skips when no games are on) |
| recordPointsRaceSnapshot | Daily 5am ET |
| rebuildPickCounts | Daily 5am ET |
| rebuildDivisionProjection | Daily 5am ET |
| refreshInjuries | Every 4 hours |
| rebuildTeamViews | Hourly (skips when standings unchanged) |

Google limits (free account): 20 triggers per script, 90 min of trigger run time per day, 20,000 web requests per day. Current use is well inside all three, including a 16-game night with live points.

## Data saved in the `config` table (public)

starsOfNightCache, starsTallyCache, recentActivityCache, divisionLeadersDisplayCache, currentSeasonStandings, lastSeasonStandings, season (settings), todaysGamesCache, livePointsCache, livePointsWork, pendingMovesSignal, weeklyTopCache, playersOfWeekHistory, pointsRaceHistory, pickCountsCache, injuriesCache, injuryOverrides, divisionProjectionCache, teamViewsMeta, teamView_<entryId> (one per team).

## Deploying changes

- **Apps Script**: paste the file, save. Only redeploy the Web App when `WebApp.gs` (or something it calls for the website) changes.
- **GitHub from a phone**: **upload the file, don't paste it.** The phone clipboard cuts off at about 20,000 characters, which broke `stats.js` once. Upload page: `github.com/matthope001-hub/AAHL-2526/upload/main` (use the browser, not the GitHub app).
- After a GitHub upload, browsers can show the old files for ~10 minutes. Check in incognito.
- **Cloudflare Worker**: upload changes to `worker/` on GitHub; Cloudflare rebuilds and deploys automatically.

## Known quirks

- **ESPN injury feed**: the first address returns 403 to Google's servers; the second (`site.web.api.espn.com`) works. Injuries.gs tries them in order.
- **Feed statuses**: ESPN only says "Out" / "Suspension"; IR / LTIR / NR are worked out from the write-up. Correct any in Admin → Player Status.
- **Points Race nights before Oct 6** are estimates (rebuilt from picks); Best Night by a Team counts from Oct 6.
- **Live points** are an estimate; the 4am run is official.
- **Division bonus** (+25 each) is only added at season end (`config/season.seasonComplete = true` and `divisionWinners` filled).
- **Cloudflare variables**: secrets added under Settings → Build are build-only; the long deploy command copies them into the running Worker.
- **New DNS names**: a computer that looked up `api.theaahl.ca` before it existed can keep getting "not found" for up to an hour; `ipconfig /flushdns` helps. The site falls back to Apps Script meanwhile.
- **Color Thief** can't read NHL logos (their server blocks it); card team colours use a built-in list in `cards.js`.
