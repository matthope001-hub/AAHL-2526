# Retired Apps Script files

One-off / no-longer-needed scripts removed from the AAHL-2526-Agent Apps Script
project on Oct 16, 2026. Kept here only so they can be restored if ever needed
(paste back into Apps Script as a new file). Nothing in the live project uses them.

| File | What it did |
|---|---|
| ClearStats.gs | Pre-season clean-up (deleted stats docs / ALL roster moves) |
| ResetStats.gs | Zeroed every player's current-season stats |
| Fixcount.gs | One-time entry count / prize pool fix |
| failedids.gs | Looked up 3 player IDs that failed a prevStats fetch |
| migrate.gs | Copied Firestore -> Supabase (migration finished) |
| moverepair.gs | One-time fix for trades misapplied as pre-season changes |
| Diagnose.gs | Old Firestore connectivity check |
| FirebaseAuth.gs | Firebase sign-in for the old Firestore backend (retired) |
| FirestoreCRUD.gs | Old Firestore read/write code (clearListCache moved to DbSwitch.gs) |
| DbSwitch-old.gs | DbSwitch.gs before Firestore was removed |
| testrunner.gs | Ran all module tests - unsafe mid-season (creates test entries, changes config, removes triggers) |
| RosterMovesTest.gs | Roster move test - creates a test entry and changes seasonStartDate |
