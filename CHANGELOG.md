# AAHL 26/27 — What's New

Every update to theaahl.ca, newest first. The site's **More → What's New** page reads this file, so add new entries at the top in the same format:
`## vX.Y — Title`, then `_Date_`, then `- ` bullets (`### ` for a sub-heading, `**bold**` allowed).

## v3.1 — Tidier Admin & next season's box builder
_Oct 16, 2026_
- **Admin redesign**: summary chips (teams, awaiting approval, unpaid, pending moves) and three tabs — **Today** (pending moves, last night's recap, live points health), **Teams** (searchable list, tap Paid/Unpaid to switch, extra actions under ⋯) and **Tools** (trades, IR list, weekly image, Sign Up button)
- **2027-28 Box Builder** (Admin → 📦): next season's boxes filled automatically from this season's pool points, updated as the season goes; drag to adjust, balance check per box; tap a player for stats; **what-if scoring** including extra stats (hits, blocks, PPP, +/-, takeaways and more)
- Nightly recap now written by AI (model updated), live points tuned for 14-game nights, live-points health tracking in Admin

## v3.0 — Faster everything, live points every minute
_Oct 15, 2026_
### New
- **Live points every minute**: during games the standings and Today's Games scores update within a minute or two of a goal (was every 10 minutes)
- **Instant updates**: Standings and Home refresh the moment new points or scores arrive, with rows sliding to their new spots
- **Faster saves**: sign-ups, My Team look-ups and roster/division changes now answer almost instantly
- **My Team redesign**: your roster as player cards, team-coloured player cards to pick moves (CURRENT / NEW), division picks with logos, and move history with headshots
- **Last Night in the AAHL**: a short recap of last night's stars and pool movers on Home every morning
- **Countdowns**: next puck drop in the Today's Games heading, the next milestone on Home, and time left to the trade deadline on My Team
- **Stat tooltips**: hover a stat (press and hold on phones) to see how it scores — PTS shows the player's full points breakdown
- **Pull to refresh** in the installed app, and a thin loading bar while data loads
- **Weekly standings picture** now looks like the site, with rank movement arrows and player photos
- **What's New** page (this one!) and a version number in the footer
### Fixes
- Deleting a team now also removes its pending move requests
- Pages no longer jump around while images load; form labels work with screen readers
### Behind the scenes
- New fast server (Cloudflare Worker at api.theaahl.ca) for saves, Admin lists, live points, the recap and the weekly picture — with Google Apps Script as the automatic backup for everything
- Admin: entries and pending moves load instantly; a banner appears when a move request comes in; Last Night recap controls (rewrite / hide)

## v2.0 — Player cards & installable app
_Oct 14, 2026_
- **Player cards** on Players, Last Night (including "How did your team do") and Boxes, with a Cards / Table switch at the top
- Cards are tinted in team colours with the team logo behind a centred headshot, and tilt as you move over them
- Tap any player anywhere for the full player card; the team popup shows mini cards
- **Animated standings**: rows slide to their new places when the order changes
- **Install the AAHL as an app** on your phone or computer (Add to Home Screen), with an offline fallback

## v1.4 — Team history & banked points
_Oct 13, 2026_
- Team popups show the team's full history: when it joined and every pick change / trade, with dates
- Banked points from traded-out players are listed by name
- "Picked by X of 47" links show which teams picked a player
- Clearer error messages for Admin pending moves

## v1.3 — Game nights
_Oct 5 – Oct 9, 2026_
- **Today's Games** ticker with live scores, period, time left and shots once the puck drops
- **Live points during games**: a "Tonight" column on the standings and live points beside each player (updated every 10 minutes at the time)
- **Players of the Week** (F / D / G), **Team of the Week** and last week's top performers, every Monday
- **Points Race** chart and a **Records** page
- "Picked by X of 47" counts on every player
- **Automatic IR List** with expected return dates
- Division picks show whether they're leading or how far back they are, plus projected division bonuses
- **Compare Two Teams** box by box (bottom of Standings)
- Hero badges for days left and NHL games left; "Updated" times on stats and standings
- New **More** menu; team nicknames on division leaders
- Weekly standings picture for the Monday email

## v1.2 — Season start
_Sep 30 – Oct 2, 2026_
- Current-season standings and stats go live
- Next-milestone box on Home (Picks Lock → Trade Deadline → Season Ends)
- **Last Night** page with "How did your team do?"
- One-time **late entry invite links** for people joining after the deadline

## v1.1 — Faster & friendlier sign-up
_Sep 1 – Sep 11, 2026_
- **27 player boxes + 4 division winner picks**
- My Team: make all your changes, then submit them together in one go
- Activity feed filters
- Much faster loading (data bundled and read straight from the database)
- Loading placeholders instead of "Loading…" text, and live email checking on sign-up
- Admin: reject several entries at once

## v1.0 — Launch
_Aug 18 – Aug 21, 2026_
- Sign up with box picks, player photo hover cards and the full rules
- Standings, team popups with every pick, Stars of the Night and the stat ticker
- Roster moves with commissioner approval, and division winner picks
- Prize pool, entries and deadline on Home, plus payout details
- Commissioner tools: entries, IR list, resend emails, show/hide the Sign Up button
