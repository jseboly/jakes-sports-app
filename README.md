# Sports Results PWA

A mobile-friendly Progressive Web App for browsing sports results stored in Neon PostgreSQL. The first version groups games by round, supports season/region/round/status filters and team-name search, and allows a single configured Neon Auth user to edit only score override fields.

## Stack

- Vite + vanilla JavaScript
- `@neondatabase/neon-js` for Neon Auth and the Neon Data API
- Neon PostgreSQL tables `RegionalGame` and `Teams`
- GitHub Pages deployment workflow
- Installable PWA manifest

## Important: database security must be configured before enabling public access

The frontend is not a security boundary. Anyone can inspect or modify browser JavaScript. Configure PostgreSQL grants and row-level security before treating the app as production-ready.

Required policy goals:

- Public/anonymous visitors can `SELECT` from `RegionalGame` and `Teams`.
- The configured editor can `SELECT` and `UPDATE` existing `RegionalGame` rows.
- The editor has column-level update rights only for `override_h_score` and `override_v_score`.
- No application role receives `INSERT` or `DELETE` rights for these tables.
- `Teams` is read-only through this application.
- RLS update policy verifies the Neon Auth identity equals the editor UUID.
- Anonymous read policy is enabled only for the intended public tables.

Do not apply a guessed SQL policy without checking the actual roles and RLS state in your Neon project. Neon Auth's identity helper and role configuration should be confirmed against your project configuration first. Also verify that `RegionalGame` and `Teams` are exposed to the Data API and that the API role has the necessary grants.

Configured editor UUID:
`d4e58c53-073d-4906-9b35-015b2f5c2835`

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Database assumptions

- `public."RegionalGame"` has columns `id`, `region`, `round`, `played`, `home`, `visitor`, `h_perf`, `v_perf`, `override_h_score`, `override_v_score`, and `season_id`.
- `public."Teams"` has columns `id` and `name`.
- `RegionalGame.home` and `RegionalGame.visitor` correspond to `Teams.id`.
- Table names are case-sensitive as shown. If the actual table names differ, update `src/main.js`.

## Scoring display rules

- Both overrides populated: show the actual override scores and determine the winner from those scores.
- Both overrides null: show performance values and use the higher performance value to indicate the winner.
- Only one override populated: label the result “Incomplete override” and do not mark a winner until both actual scores are entered.
- The editor form only updates `override_h_score` and `override_v_score`. It does not update performance values, `played`, or any other column.

## Authentication

The app uses Neon Auth email/password sign-in. The editor controls are shown only when the current session's user ID matches the configured UUID. This is only a user-interface convenience; PostgreSQL grants and RLS must independently enforce the same rule.

Public reads use the SDK's anonymous access mode. Check the Neon Auth allowed origins and database policy setup for both local development and the deployed GitHub Pages URL.

## Deploy to GitHub Pages

1. Create a GitHub repository and upload this project.
2. Push the default branch as `main`.
3. In repository **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
4. The workflow in `.github/workflows/deploy.yml` builds and deploys the app after a push to `main`.
5. In Neon Auth settings, add the local development origin and your GitHub Pages origin to the allowed origins/URLs as required by your Neon Auth configuration.
6. Test public reads in a signed-out browser and test score editing only after the database permissions have been verified.

## Known first-version limits

- Team names are loaded separately and joined to games in the browser, so foreign-key relationship metadata is not required.
- Filters operate on the rows loaded from the Data API. If the database grows very large, server-side filtering and pagination should be added.
- Offline caching is not included yet; the app needs a network connection to load and save results.
- This starter has not been connected to or tested against your live database. Verify table casing, API exposure, auth session shape, and grants before using it for actual updates.
