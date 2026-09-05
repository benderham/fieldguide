# AGENTS.md

Fieldguide — a Discovery Copilot, built over 30 days as a learning exercise.

This file is deliberately thin. Day 1 has not been built yet, and conventions that have not been earned do not belong here. Add to it as decisions land.

## Where the work is planned

Wayfinding maps and their tickets live in GitHub Issues. The current map is **Day 1 — the smallest sensible Discovery Copilot** (labelled `wayfinder:map`). Read it before starting work; its Decisions-so-far is the index of what is already settled.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root, decisions in `docs/decisions.md`. See `docs/agents/domain.md`.
