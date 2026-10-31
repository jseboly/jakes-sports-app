# Sports Results PWA

A mobile-friendly Progressive Web App for browsing and updating football and baseball results stored in Neon PostgreSQL. Use the league tabs or the `#football`, `#baseball-regional`, and `#baseball-national` URL fragments to switch datasets. Each league has Results and Standings pages; Results groups games by round, supports season, region/tier, round, and status filters plus team-name search, and provides public score override and played-status editing.

## Stack

- Vite + vanilla JavaScript
- `@neondatabase/neon-js` for Neon Auth and the Neon Data API
- Neon PostgreSQL tables/views for Football, Baseball-Regional, and Baseball-National
- GitHub Pages deployment workflow
- Installable PWA manifest

## Important: public editing is intentionally unrestricted

The frontend is not a security boundary. Anyone who can access the app can edit score overrides and mark any game as played. There is no editor sign-in or identity check. The database must allow anonymous updates for the app's write operations to work.

If unrestricted public writes are not acceptable, do not enable anonymous UPDATE. Use an authenticated editor or put writes behind a protected server-side endpoint instead. Do not rely on hiding controls or changing browser code for access control.

Configure PostgreSQL grants and row-level security to match this public-write model:

- Anonymous visitors can `SELECT` from the game table, `TeamSeason`, and standings view for each configured league. Baseball-National also needs `SELECT` on `Team` for team names.
- Anonymous visitors can `UPDATE` only `override_h_score`, `override_v_score`, and `played` on each game table, with a policy that permits updates to any game.
- No application role receives `INSERT` or `DELETE` rights.
- `TeamSeason` remains read-only through this application.

Do not apply a guessed SQL policy without checking the actual roles and RLS state in your Neon project. Verify that the configured tables and views are exposed to the Data API, the anonymous API role has the required grants, and row-level security permits these public updates. The checklist in `sql/SECURITY_CHECKLIST.sql` is not a ready-to-run migration.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Database assumptions

- Football uses the existing Football Data API and the `RegionalGame`, `TeamSeason`, and `RegionalTeamsFullView` tables/views.
- Baseball uses the Data API at `https://ep-super-bird-aebryt44.apirest.c-2.us-east-2.aws.neon.tech/neondb/rest/v1`. Baseball-Regional uses `RegionalGame`, `TeamSeason`, and `RegionalTeamsFullView`; Baseball-National uses `NationalGame`, `TeamSeason`, `Team`, and `NationalTeamsFullView`.
- Football and Baseball-Regional game tables use `region`; `NationalGame` uses `tier` instead. The game tables also have `id`, `round`, `played`, `home`, `visitor`, `h_perf`, `v_perf`, `override_h_score`, `override_v_score`, and `season_id`.
- Football and Baseball-Regional `TeamSeason` tables expose `reg_id`, `season_id`, `name`, and `rating`. Baseball-National `TeamSeason` exposes `nat_id`, `team_id`, `season_id`, and `rating`. National game `home` and `visitor` values match `TeamSeason.nat_id`; team names come from `Team.name` by matching `TeamSeason.team_id` to `Team.id`.
- Game `home` and `visitor` values correspond to the appropriate game identifier in `TeamSeason` (`reg_id` for Football and Baseball-Regional, `nat_id` for Baseball-National); match both `season_id` and that identifier for game team/rating lookups.
- Football's `RegionalTeamsFullView` exposes `season_id`, `name`, `region`, `rating`, `proxy`, `wins`, and `losses`. Baseball standings views expose the same core data without `proxy`; National standings use `tier` instead of `region`. The proxy column and sort option are only shown for Football. Standings default to season descending, wins descending, and rating descending.
- Table names are case-sensitive as shown. If actual table names differ, update the league configuration in `src/main.js`.

## Scoring display rules

- Games not marked played show each team's `TeamSeason.rating` in the score area, rounded to one decimal place, and do not show a winner. This rating display takes precedence over any entered score overrides until the game is marked played.
- Results and Standings season filters default to season `1` when that season is available; clearing Results filters also restores season `1`.
- Both overrides populated: show the actual override scores and determine the winner from those scores.
- Both overrides null: show and compare `h_perf + home TeamSeason.rating` against `v_perf + visitor TeamSeason.rating` for the same season. If any required performance or rating value is missing, show no value for that team and do not indicate a winner.
- Only one override populated: label the result “Incomplete override” and do not mark a winner until both actual scores are entered.
- Anyone can edit a game's `override_h_score` and `override_v_score`, or mark that game as played. The app does not update performance values or other columns.
- The batch action marks all unplayed database rows matching the selected season, region/tier, and round filters as played. It asks for confirmation and ignores the game-status and team-name filters.

## Public database access

The Neon SDK uses anonymous access to call the Data API; this does not authenticate or identify editors. Check Neon Auth allowed origins and the anonymous database grants/policies for both local development and the deployed GitHub Pages URL. Ensure each configured game's table, `TeamSeason`, and standings view are exposed to the Data API and have the required anonymous permissions. Baseball-National also requires `Team` to be exposed with anonymous `SELECT`.

## Deploy to GitHub Pages

1. Create a GitHub repository and upload this project.
2. Push the default branch as `main`.
3. In repository **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
4. The workflow in `.github/workflows/deploy.yml` builds and deploys the app after a push to `main`.
5. In Neon Auth settings, add the local development origin and your GitHub Pages origin to the allowed origins/URLs as required by your Neon Auth configuration.
6. Test public reads and writes in a signed-out browser, and verify that the database permits only the intended anonymous update columns.

## Known first-version limits

- Team-season rows are loaded separately and joined to games in the browser using `(season_id, reg_id)` for Football and Baseball-Regional, or `(season_id, nat_id)` for Baseball-National, so foreign-key relationship metadata is not required.
- Filters operate on the rows loaded from the Data API. If the database grows very large, server-side filtering and pagination should be added.
- Offline caching is not included yet; the app needs a network connection to load and save results.
- This starter has not been connected to or tested against your live database. Verify table casing, API exposure, and grants before using it for actual updates.
