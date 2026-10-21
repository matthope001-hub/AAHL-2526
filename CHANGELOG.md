# AAHL 26/27 — What's New

Every update to theaahl.ca, newest first. The site's **More → What's New** page reads this file, so add new entries at the top in the same format:
`## vX.Y — Title`, then `_Date_`, then `- ` bullets (`### ` for a sub-heading, `**bold**` allowed).

## v3.5 — Highlights
_Oct 21, 2026_
- New **Highlights** page (top menu): a card for every **goal** and **assist** by a pool player, within minutes of the play
- **Tap a card** to watch the official NHL clip right on the page, or open it on NHL.com. Cards say **Clip coming** until the NHL posts the video
- **Fight cards** too, showing who they fought (the NHL doesn't post fight video, so these have no clip)
- Filter by **Goals / Assists / Fights**, and step back with **‹ ›** to catch up on any of the last two weeks
- Updates on its own every minute while you're watching tonight's games

## v3.4 — Live standings during games
_Oct 20, 2026_
- **Standings move live**: while games are on, Rank, Points and Payout include tonight's points, on both Home and the Standings page
- Teams **slide up and down** as they pass each other, within a minute or two of each goal
- **▲ / ▼ beside the rank** shows spots gained or lost tonight
- The **Tonight** column still shows the points earned so far tonight
- Live numbers are an estimate; the official standings come in the 4am update

## v3.3 — Sign in to see all your teams
_Oct 19, 2026_
- **Optional sign-in** on My Team: continue with **Google**, **Hotmail / Outlook**, **Yahoo**, or get a sign-in link by email — no password, no Entry ID needed
- **All your teams in one place**: once signed in, My Team lists every team on your email; tap one to manage roster moves and division picks. One team? It opens automatically
- **Sign in button** at the top right of every page — once signed in it shows your name with a menu for **My Teams** and **Log out**
- Commissioner **Admin** moved into the **More** menu
- **Link another account**: own teams under a different email? Link that account and those teams show up too
- Signing in is never required — the Entry ID + email look-up still works exactly as before, and Standings stay open to everyone
- New **Privacy Policy** page (theaahl.ca/privacy.html) — your email is never shown publicly or shared
- Behind the scenes: sign-in runs on Supabase Auth; the fast server only returns teams for verified emails

## v3.2 — Weekly schedule & tap-a-game pool points
_Oct 18, 2026_
- **Weekly Schedule** (More → Schedule): every NHL team night by night, Monday to Sunday — home games filled, away games outlined, light nights (fewer than 8 games) shaded, with games and light-night totals for each team
- **Best & Worst schedules**: the teams with the most and fewest games this week, shown as cards above the grid
- Flip between weeks with ◀ / ▶; on Sundays it opens next week automatically
- **Tap a game** on Today's Games: it flips over into a card of the pool players in that game — who has points (live during the game, final after), their goals, assists or saves, and how many pool teams have them (tap to see which). Before puck drop it lists each side's pool players. 🎩 marks a hat trick
- The game card updates on its own as live points come in, and the ticker pauses while it's open
- A hint under Today's Games shows you can tap a game; the scores ticker pauses when you hover over it (or tab to it)
- Fixes: schedule buttons no longer stretch full-width on phones; bigger close button on the game card
- Behind the scenes: the schedule comes from the fast server (api.theaahl.ca), cached for 6 hours

## v3.1 — Tidier Admin & next season's box builder
_Oct 16, 2026_
- **Admin redesign**: summary chips (teams, awaiting approval, unpaid, pending moves) and three tabs — **Today** (pending moves, last night's recap, live points health), **Teams** (searchable list, tap Paid/Unpaid to switch, extra actions under ⋯) and **Tools** (trades, IR list, weekly image, Sign Up button)
- **2027-28 Box Builder** (Admin → 📦): next season's boxes filled automatically from this season's pool points, updated as the season goes; drag to adjust, balance check per box; **NEW** badge on players new to the pool; tap a player for stats; **what-if scoring** including extra stats (hits, blocks, PPP, +/-, takeaways and more)
- Nightly recap now written by AI (model updated), live points tuned for 14-game nights, live-points health tracking in Admin
- Behind the scenes: fast server now blocks junk bot traffic and keeps searchable logs; retired Apps Script files archived

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

## v1.5 — Rules check, trade tool & faster nightly update
_Oct 14, 2026_
- **Rules page checked against the real scoring**: point values and deadlines now come straight from the pool settings; added notes on late entries, commissioner trades, regular-season-only games, shared shutouts and when standings update
- Stat ticker only scrolls when there's more than fits on screen
- Admin: **Process Trade** — log an official trade for any team using the same steps as an owner's roster move (points banked, activity logged), with 🩹 IR tags in the player lists
- Behind the scenes: the 4 am nightly stats update went from timing out (6+ min) to about 1½ minutes

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
- **Trades column** on Standings: moves used / left, with a marker for moves awaiting approval; standings columns centred
- Trade fixes: trade deadline (Mar 1) enforced, safer submit, and Admin pending moves no longer show "No pending moves" by mistake
- **Nightly stat check**: every pool player's stats are re-checked against the NHL's official game logs and corrected automatically (the NHL sometimes fixes shots/saves after the fact)
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
_Sep 29 – Oct 2, 2026_
- **Opening night (Sep 29)**: picks locked, first nightly stats in
- Fixes: nightly stats read the previous night's completed games; test-run stats cleared before opening night; Boxes listed in order
- Current-season standings and stats go live, including live NHL division standings on Boxes
- Next-milestone box on Home (Picks Lock → Trade Deadline → Season Ends)
- **Last Night** page with "How did your team do?"
- One-time **late entry invite links** for people joining after the deadline

## v1.1.1 — Pre-season prep
_Sep 16 – Sep 28, 2026_
- **Paper entry form** (PDF) for people who'd rather sign up offline
- Admin: **Add Late Entry** for sign-ups after the deadline (late entries score from day 1 of the season)
- Fixes: deadline and season start set to 5 PM ET (were landing the night before); no more duplicate entries when a save is retried
- Behind the scenes: unused player records cleaned out so standings recalculate faster

## v1.1 — Faster & friendlier sign-up
_Sep 1 – Sep 11, 2026_
- **27 player boxes + 4 division winner picks**
- My Team: make all your changes, then submit them together in one go
- Activity feed filters
- Much faster loading (data bundled and read straight from the database)
- Database moved from Firebase to Supabase
- Password show/hide eye inside the box; new site icon and phone home-screen icon
- Loading placeholders instead of "Loading…" text, and live email checking on sign-up
- Admin: reject several entries at once

## v1.0 — Launch
_Aug 18 – Aug 21, 2026_
- Sign up with box picks, player photo hover cards and the full rules
- Standings, team popups with every pick, Stars of the Night and the stat ticker
- Roster moves with commissioner approval, and division winner picks
- Prize pool, entries and deadline on Home, plus payout details
- Commissioner tools: entries, IR list, resend emails, show/hide the Sign Up button

## v0.9 — Planning & first prototype
_Apr 28 – Aug 17, 2026_
- 2024-25 pool wrapped up: Trish H 1st, Nova Scotia JWM 2nd, Sklepo2 3rd
- First 2026-27 prototype built on Google Sheets (picks page, standings, ticker, IR badges, roster moves, nightly stats)
- Fresh rebuild planned for 2026-27: new site, new backend, new database, and the scoreboard look (ice blue + amber)
- Division winner bonus set at +25 per correct pick, paid at season end; 50/50 split with Mackenzie & Dan
