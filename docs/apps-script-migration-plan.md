# AAHL — Move off Google Apps Script (plan)

**Status:** planned · **Start:** ~Apr 26, 2027 (about 2 weeks after the regular season ends Apr 10, 2027) · **Finish by:** before 2027-28 sign-ups open (target early Aug 2027)
**Written:** Oct 16, 2026

## Goal

Run the whole pool on **GitHub Pages (site) + Cloudflare Worker (all server work) + Supabase (data)**, and retire the Apps Script project **AAHL-2526-Agent**.

Why:
- One codebase in GitHub with full history; every change deploys itself (no copy/paste into Apps Script, no "redeploy the web app").
- Claude can change, test, deploy and check logs end to end.
- Faster (no Apps Script cold starts), no Google daily quotas, one system instead of two hand-offs.

## Ground rules

- **One step at a time, side by side.** Each step runs on the Worker *and* Apps Script in parallel (Worker writes to a test row or dry-run log) until the numbers match, then Apps Script's version is switched off. Nothing is deleted until the Worker version has run cleanly for a week.
- **Off-season testing on real data:** replay the 2026-27 season (Oct–Apr nightly snapshots in Supabase `stats`) through the new code and compare totals with the final standings — every team must match to the cent.
- **Back up first:** the whole Apps Script project is archived to GitHub (`apps-script/`) before step 1.
- **Ask before deleting anything** (Matt's rule).

## What Apps Script does today (Oct 2026 — 33 files, ~6,800 lines)

| Area | Files | Runs |
|---|---|---|
| Nightly official stats + standings | Pipeline, Stats, StatsResync, Standings, Players, DivisionStandings | 4am ET daily |
| Derived data for the site | pickcounts, DivisionProjection, pointsrace, teamviews, weeklystars | 5am / hourly / Mon 6am |
| Injuries / IR list | injuries, ConfigIR | every 4 h |
| Today's Games + live points (backup only — Worker does this now) | todaysgames, livepoints | every 10 min |
| Admin actions | WebApp, Entries, RosterMoves, ConfigIR, lateinvite, AdminAuth, Boxes, BoxRebuild | on demand |
| Follow-ups for Worker saves | WorkerBridge, EmailQueue | on demand |
| Emails (confirmations, change notices, commissioner alerts, Monday summary) | EmailQueue, Entries, RosterMoves, WeeklySummary | on demand / Mon 7am |
| Weekly picture (Slides backup; Worker screenshot is primary) | weeklyimage | Mon |
| Backups, keep-alive, audit | backup, keepalive, audit, Boxes (tradeDeadlineAudit) | daily |
| Data access | DbSwitch, SupabaseCRUD | — |

## Decisions to make before starting

1. **Cloudflare Workers Paid (US$5/mo)** — recommended. Free plan allows 10 ms CPU per run; the 4am stats run and standings recompute need more. Paid = 30 s CPU per run, also covers busy live-points nights.
2. **Email sender** — recommended **Resend** (free 3,000/month, 100/day): add its DNS records to theaahl.ca in Cloudflare, send from e.g. `pool@theaahl.ca`, replies forwarded to Gmail with Cloudflare Email Routing. Alternative: keep a tiny Apps Script that only sends email.
3. **Backups** — move the nightly backup from Google Drive to **Cloudflare R2** (free 10 GB), keep 30 days.

## Steps

### Step 0 — Prep (½ session)
- Archive the full Apps Script project into the repo (`apps-script/`), plus the list of triggers and Script Properties names (not values).
- Decide on items 1–3 above. Set up Resend + DNS + R2 bucket.
- Split the Worker into modules (`worker/src/…`): db, nhl, scoring, jobs, admin, email.

### Step 1 — Derived data jobs (low risk)
Pick counts, division projection, team views, Points Race snapshot, Players/Team of the Week, injuries + IR list, backups (→ R2), keep-alive (drop — Worker traffic keeps Supabase awake).
- Each becomes a Worker cron; compare its output row with Apps Script's for a few days, then remove the Apps Script trigger.

### Step 2 — Admin actions (low–medium)
Approve / reject entries and moves, batch reject, edit entry, process trade, IR overrides, late-invite links, config updates, resend email, box rebuild.
- Admin page calls the Worker (password check already there). Keep Apps Script routes as fallback for one week, then remove.

### Step 3 — Emails (medium)
All emails through Resend: entry confirmation, late-entry confirmation, change confirmations, commissioner alerts, Monday weekly summary (with the screenshot attached), any reminders.
- Send test copies to Matt for each email type; check spam folders (Gmail + Outlook/rocketmail).
- WorkerBridge follow-ups disappear (the Worker does the slow parts itself, in the background).

### Step 4 — The 4am official run (highest risk, last)
Nightly NHL box scores → player stats (bulk upsert) → snapshot → standings recompute → public caches → Stars of the Night + tally → recap.
- Replay the full 2026-27 season through the new code and match every team's final total exactly.
- Then run side by side for a week (Worker writes to shadow rows, Apps Script stays official); switch over when identical.
- Repair tools ported too: resync from NHL, rebuild totals from snapshots, backfills, audit.

### Step 5 — Retire Apps Script
- Remove all triggers, then the web app deployment; leave the project in Drive (read-only archive) for one season.
- Site: drop `WEBAPP_URL` fallbacks from data.js (Worker becomes the only server; keep the health-gated retry).
- Update the setup reference doc and CHANGELOG (v4.0).

## Rough effort

| Step | Sessions |
|---|---|
| 0 Prep | 0.5 |
| 1 Derived jobs | 1 |
| 2 Admin | 1 |
| 3 Emails | 0.5–1 |
| 4 Nightly run | 1–1.5 |
| 5 Retire | 0.5 |
| **Total** | **~4–5 sessions over 4–8 weeks** |

## Watch-outs

- Scoring rules exist in several places today (Standings.gs, data.js, the Worker) — after the move there should be **one** shared scoring module in the Worker, with the site using the same numbers.
- Season settings in `config/season` (deadlines, scoring values, seasonComplete, divisionWinners) must be read the same way everywhere.
- The site's offline/app cache (sw.js) — bump the cache version at cut-over.
- Keep the Supabase service key only as a Cloudflare secret, never in GitHub.
