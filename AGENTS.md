# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `npx flue run src/agents/fieldguide.ts --message "Hi"` — run an agent locally, no server.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.

## Keeping the record

This is a build-in-public project. Two documents under `docs/` are part of the deliverable, not optional extras. Before finishing a task, update them when it applies:

- `docs/decisions.md` — append an ADR whenever a task makes or changes an architectural decision: a new dependency or integration, a data-flow or boundary change, a tool contract, or an approach chosen over a real alternative. Newest at the bottom. Never rewrite an existing entry; a correction or reversal is a new entry that names the one it changes, and updates that entry's status. Status is one of ACCEPTED, PENDING, AMENDED (still in force except where a named later entry changes it), or SUPERSEDED (kept for history; a named later entry replaces it). Keep it technical and cite the reasoning, not just the choice.
- `docs/diary.md` — add an entry at each milestone worth telling a follower about: a capability that now works, a direction that changed, a notable success or failure. Newest first. Plain language for a non-technical reader: no code, no jargon, no ADR numbers. The technical record stays in `decisions.md` and git history.

Not every task touches these. A typo fix or a refactor with no decision behind it needs neither. When in doubt about a decision entry, add it: the log is meant to be complete, and a short entry is cheap.
