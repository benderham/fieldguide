# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary of terms that carry specific meaning here.
- **`docs/decisions.md`**: the ADR log. Read the entries that touch the area you are about to work in.

If either file doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/
│   └── decisions.md
└── src/
```

This repo keeps decisions as **one append-only log**, not one file per ADR. Newest entries at the bottom. Never rewrite an existing entry: a correction or reversal is a new entry that names the one it changes and updates that entry's status. Status is one of ACCEPTED, PENDING, AMENDED (still in force except where a named later entry changes it), or SUPERSEDED (kept for history; a named later entry replaces it).

If this repo ever grows into genuinely separate contexts, a `CONTEXT-MAP.md` at the root would point at one `CONTEXT.md` per context. It does not, and adding one before it does would be premature.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts an entry in `docs/decisions.md`, surface it explicitly rather than silently overriding:

> _Contradicts the entry on the hand-rolled analysis loop, but worth reopening because…_
