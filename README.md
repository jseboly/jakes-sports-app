# Sports Results PWA

A mobile-friendly Progressive Web App for browsing and updating sports results stored in Neon PostgreSQL. The Results page groups games by round, supports season/region/round/status filters and team-name search, and provides public score override and played-status editing. The Standings page displays team ratings and records with season/region filters and configurable sorting.

## Stack

- Vite + vanilla JavaScript
- `@neondatabase/neon-js` for Neon Auth and the Neon Data API
- Neon PostgreSQL tables/views `RegionalGame`, `TeamSeason`, and `RegionalTeamsFullView`
- GitHub Pages deployment workflow
- Installable PWA manifest

## Important: public editing is intentionally unrestricted

The frontend is not a security boundary. Anyone who can access the app can edit score overrides and mark any game as played. There is no editor sign-in or identity check. The database must allow anonymous updates for the app's write operations to work.

If unrestricted public writes are not acceptable, do not enable anonymous UPDATE. Use an authenticated editor or put writes behind a protected server-side endpoint instead. Do not rely on hiding controls or changing browser code for access control.

Configure PostgreSQL grants and row-level security to match this public-write model:

- Anonymous visitors can `SELECT` from `RegionalGame`, `TeamSeason`, and `RegionalTeamsFullView`.
- Anonymous visitors can `UPDATE` only `override_h_score`, `override_v_score`, and `played` on `RegionalGame`, with a policy that permits updates to any game.
- No application role receives `INSERT` or `DELETE` rights.
- `TeamSeason` remains read-only through this application.

Do not apply a guessed SQL policy without checking the actual roles and RLS state in your Neon project. Verify that both tables are exposed to the Data API, the anonymous API role has the required grants, and row-level security permits these public updates. The checklist in `sql/SECURITY_CHECKLIST.sql` is not a ready-to-run migration.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Database assumptions

- `public."RegionalGame"` has columns `id`, `region`, `round`, `played`, `home`, `visitor`, `h_perf`, `v_perf`, `override_h_score`, `override_v_score`, and `season_id`.
- `public."TeamSeason"` has columns `reg_id`, `season_id`, `name`, and `rating`.
- `RegionalGame.home` and `RegionalGame.visitor` correspond to `TeamSeason.reg_id`; match both `season_id` and the registration ID when looking up a team name.
- `public."RegionalTeamsFullView"` exposes `season_id`, `name`, `region`, `rating`, `proxy`, `wins`, and `losses`. The Standings page uses `season_id` for filtering and defaults to season descending, wins descending, and rating descending.
- Table names are case-sensitive as shown. If the actual table names differ, update `src/main.js`.

## Scoring display rules

- Games not marked played show each team's `TeamSeason.rating` in the score area, rounded to one decimal place, and do not show a winner. This rating display takes precedence over any entered score overrides until the game is marked played.
- Both overrides populated: show the actual override scores and determine the winner from those scores.
- Both overrides null: show and compare `h_perf + home TeamSeason.rating` against `v_perf + visitor TeamSeason.rating` for the same season. If any required performance or rating value is missing, show no value for that team and do not indicate a winner.
- Only one override populated: label the result “Incomplete override” and do not mark a winner until both actual scores are entered.
- Anyone can edit a game's `override_h_score` and `override_v_score`, or mark that game as played. The app does not update performance values or other columns.
- The batch action marks all unplayed database rows matching the selected season, region, and round filters as played. It asks for confirmation and ignores the game-status and team-name filters.

## Public database access

The Neon SDK uses anonymous access to call the Data API; this does not authenticate or identify editors. Check Neon Auth allowed origins and the anonymous database grants/policies for both local development and the deployed GitHub Pages URL. Ensure `RegionalTeamsFullView` is exposed to the Data API and has anonymous `SELECT` permission.

## Deploy to GitHub Pages

1. Create a GitHub repository and upload this project.
2. Push the default branch as `main`.
3. In repository **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
4. The workflow in `.github/workflows/deploy.yml` builds and deploys the app after a push to `main`.
5. In Neon Auth settings, add the local development origin and your GitHub Pages origin to the allowed origins/URLs as required by your Neon Auth configuration.
6. Test public reads and writes in a signed-out browser, and verify that the database permits only the intended anonymous update columns.

## Known first-version limits

- Team-season rows are loaded separately and joined to games in the browser using `(season_id, reg_id)`, so foreign-key relationship metadata is not required.
- Filters operate on the rows loaded from the Data API. If the database grows very large, server-side filtering and pagination should be added.
- Offline caching is not included yet; the app needs a network connection to load and save results.
- This starter has not been connected to or tested against your live database. Verify table casing, API exposure, and grants before using it for actual updates.
