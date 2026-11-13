# Shift Monitor

Live shift and break tracking for teams. Next.js app; several people on a
team see the same schedule and every change syncs live.

The original single-file app is kept in `legacy/` for reference.

## Run it locally

```sh
npm install
npm run dev          # http://localhost:3000
```

Locally the app uses a **dev backend** built into Next.js: a JSON file at
`.data/dev-db.json` plus server-sent events for live updates. Sign-in asks
for an email only (no password). To try it as several people, sign in with
different emails in different browsers or profiles, create a team in one,
and join it from the others with the code in the team menu.

Delete `.data/dev-db.json` to start over.

## Tests

```sh
npm test             # unit tests (break planning, parsing, actions, exports, team isolation)
npm run test:e2e     # two users + an outsider in real Chrome, checks live sync and isolation
npm run typecheck
npm run lint
```

The end-to-end tests start their own server on port 3100 with a throwaway
database, and use the installed Google Chrome.

## Layout

| Path | What |
|---|---|
| `lib/` | Plain TypeScript: data model, time math, break rules, paste parsing, exports, and `actions.ts` (each user action → a list of write ops) |
| `lib/backend/` | The `Backend` interface the UI talks to, and the dev implementation |
| `lib/server/` + `app/api/dev/` | The local dev backend (disabled in production builds) |
| `components/` | React UI |

## Next: AWS

The AWS backend (Cognito sign-in, AppSync + DynamoDB, per-team access, live
subscriptions) will implement the same `Backend` interface in
`lib/backend/`, so the UI and `lib/actions.ts` stay as they are.
