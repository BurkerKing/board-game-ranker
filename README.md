# Board Game Preference Ranking

Mobile-first preference ranking app for Brian and Sarah.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev -- --port 5173
```

Open `http://127.0.0.1:5173`.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, create a new project from that repository.
3. Vercel should detect Vite automatically. The included `vercel.json` sets:
   - build command: `npm run build`
   - output directory: `dist`
4. Deploy.

## iPhone Use

1. Open the deployed Vercel URL in Safari on Sarah's iPhone.
2. Press **Import Google Sheet** while online.
3. Tap Safari's share button.
4. Choose **Add to Home Screen**.
5. Use the home screen app for the road trip.

Progress is saved in that iPhone browser/app using `localStorage`. Importing on a laptop does not transfer progress to the phone.

## Google Sheet Access

The sheet must be shared as:

```text
Anyone with the link -> Viewer
```

The app imports game titles and metadata from the public CSV export of the sheet.

Expected columns:

```text
A: Game title
B: BGG Rating
C: Our Rating
D-K: Player counts 1-8
L: Best player count
M: Times played
N: Last played
O: Image URL (optional)
```

If column O contains a direct `http` or `https` image URL, the app uses it as the board game cover. If it is blank, the app shows the existing title placeholder.

Solo-only games are skipped on import. A game counts as solo-only when column D has `X` and columns E-K have no `X`. Games that support 1 player plus another player count are still imported.

## Offline Notes

The app has basic PWA caching, so the installed app shell should keep opening after it has been loaded once. The first import needs internet access. Progress saves continuously on the device.

## Fair comparison bands

Matchups use bands of 8 appearances per active game. The next ceiling is the
smallest multiple of 8 strictly above the least-compared active game's count.
Only games below that ceiling may play. Once all active games reach it, the
ceiling advances by 8. Never Played games neither appear nor set the ceiling.
Counts use the existing average of Brian's and Sarah's comparison counts (both
normally increase together for every appearance). Existing counts, Elo ratings,
completed history, and exclusions are preserved.

A pair requires two games. If exactly one game is below the ceiling, that game
must play against a least-compared other active game. This is the only ceiling
exception: the opponent may move one above the ceiling per comparison. In an
already uneven historical session, the least-compared available opponent may
already be above the ceiling and may need to play repeatedly until the lone
lagging game catches up. This minimizes additional appearances among available
opponents; it never permits two games above the ceiling to play each other while
a lagging game exists. With fewer than two active games, no pair is possible.

Among eligible pairs, the least-repeated pairs take priority; ties use the
existing scoring for Elo closeness, player disagreement, uncertainty, and a small
random tie-break. Eligibility always takes precedence over scoring. The old
first-image special case has been removed so it cannot bypass eligibility.
Active sessions reselect their saved current matchup on loading. The comparison
screen and submission path also check eligibility; completed history is not
removed.

Run `npm test` with Node.js 22.8+ (the cloud environment uses Node.js 24). Tests
use Node's built-in runner and the existing TypeScript dependency to execute the
actual ranking and storage modules, with isolated in-memory localStorage.
`npm run build` checks TypeScript and builds the application.

## Backups and saved-data recovery

**Export Backup** and **Import Backup** are available above the comparison and
session screens, including on an empty device. A complete versioned JSON backup
contains all sessions, games and metadata, Elo ratings and comparison counts,
completed comparison history, Never Played exclusions, session information, and
finished ranking snapshots. It also includes the original v2/v1 storage text
when readable. Import restores the backup's application state, not arbitrary raw
storage keys. No network or Google Sheet import is needed to restore it.

On iPhone, Export Backup uses file sharing when supported: choose **Save to
Files** in the share sheet. Otherwise it requests a JSON download; check Safari's
Downloads/Files. Sharing failures also fall back to downloading and offer a separate **Download
Backup** button for contexts requiring another explicit tap. Import Backup
opens the device file picker. After validation, review the session/game/comparison
counts, tap **Restore Backup**, then confirm replacement. Canceling does not write
anything. Export existing data before replacing it. Import replaces all sessions
on that device; it does not merge them. The destination's legacy key is retained.
Pending matchups are reselected under the eight-comparison-band rules.

Malformed JSON, invalid structures, missing saved game ratings, and storage-read
failures show a recovery warning and pause automatic saving rather than creating
and saving an empty state. The recovery screen offers **Retry Saved Data**, export,
and confirmed import. Without a successfully loaded state, **Export Saved Data**
preserves the raw original text for troubleshooting; this recovery file cannot
be imported as a complete backup. If storage is inaccessible, raw data cannot be
exported until access returns. If progress was already loaded, Export Backup can
still preserve that in-memory progress even when storage later becomes unreadable.
Retry warns before discarding unsaved in-memory changes. No automatic reset or
partial repair is attempted. Valid legacy saves still migrate; original legacy
text is retained. Failed writes (including quota failures) surface a warning.

`npm test` covers corruption, storage denial/quota failures, recovery, validated
and canceled imports, full cross-device round trips, migration, and fairness.
`npm run test:browser` runs additional mobile-size Chromium checks in temporary
isolated browser contexts (recovery/autosave, downloads, import confirmation,
cross-context restoration, and simulated sharing/fallback). It needs Chromium at
`/usr/bin/chromium` and Playwright Core; in this cloud environment it uses the
preinstalled module under `/opt/codex/cua_node`. Elsewhere, set
`BOARD_RANKER_PLAYWRIGHT_MODULE` to the installed module's path. Port 5174 must be
free. This is a Chromium check, not an iPhone Safari or installed Home Screen test.
Before releasing, verify Save to Files and file import on the target iPhone/iOS
version in Safari and, where supported, the installed app. Storage is device and
browser-context specific; backups provide manual transfer, not synchronization.
