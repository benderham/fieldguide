# Fieldguide

> Turn messy operational knowledge into a decision-ready operating map.

Fieldguide is an experimental AI copilot for Forward Deployed Engineering discovery. It reviews fragmented evidence about how work happens—policies, interviews, working notes, operational records, and exceptions—and helps an FDE build an evidence-backed view of the real workflow.

This repository is being built in public as a 30-day learning experiment, following the structure of [Varick Agents' FDE in 30 Days](https://learn.varickagents.com/fde-in-30-days).

Fieldguide is an independent project and is not affiliated with or endorsed by Varick Agents.

## The experiment

The goal is to take one enterprise workflow through the full Forward Deployed Engineering cycle:

1. Audit how the work actually happens.
2. Build an agent that can complete a useful loop.
3. Make its execution recoverable and observable.
4. Evaluate its behaviour against representative cases.
5. Explain the system, economics, risks, and trade-offs.

The same system will be developed throughout the 30 days. This is not a collection of disconnected AI demos.

## The scenario

Fieldguide is initially being tested against **SignalWire**, a fictional corporate-news distribution business.

SignalWire receives press releases from clients, reviews and enriches them, obtains the necessary approvals, and publishes them through several distribution channels. Its apparently simple workflow hides manual re-keying, inconsistent approvals, undocumented knowledge, compliance exceptions, and conflicting interpretations of status.

The synthetic discovery room is stored in Notion and contains:

- Official procedures and policies
- Staff interview notes
- System documentation
- Example submissions and approval threads
- Operational metrics and incidents
- Normal, incomplete, ambiguous, and high-risk cases

The documents deliberately disagree. Fieldguide must identify those contradictions rather than silently inventing a single coherent story.

## Intended output

Fieldguide produces a **decision-ready operating map** containing:

- The reconstructed current-state workflow
- Evidence supporting each material finding
- Contradictions and unresolved questions
- Bottlenecks, risks, and exception paths
- A division of responsibility between deterministic software, agent assistance, and human control
- Ranked opportunities for improvement
- One bounded recommendation suitable for a pilot

The copilot may recommend an intervention. It cannot approve compliance-sensitive or irreversible changes.

## How the agent works

At a high level, Fieldguide repeats the following loop:

```text
inspect available evidence
        ↓
select the next useful investigation step
        ↓
read, compare, or record evidence
        ↓
identify gaps and contradictions
        ↓
continue, ask for clarification, or complete the audit
```

Every run has an explicit completion condition and a maximum-step limit.

## Architecture direction

The initial implementation will use:

- **Notion** as the mock client's existing discovery system
- **Flue** for agent execution, durable runtime state, and observability
- **TypeScript** for the application and tool contracts
- **Vitest** for deterministic tests and live-model behavioural evals
- A separate application store for canonical audit evidence and workflow state

The runtime transcript is not the business record. Flue owns model turns and tool execution history; Fieldguide owns evidence, contradictions, workflow steps, audit status, and human decisions.

What survives a run is deliberate and narrow. Evidence and unresolved questions accumulate into the audit, because they stay true after the run that found them ends. A run's conclusions are kept as immutable history and never fed back, so a resumed audit re-derives its map from the evidence rather than inheriting an earlier run's story. Everything retained carries a written reason, checked at the write site rather than asserted in a document, and that manifest ships with every map.

The architecture may change as the experiment exposes better boundaries. Those changes—and the evidence behind them—are part of the case study.

## Evaluation principles

Fieldguide will not be judged by whether its prose sounds convincing. Evaluation will focus on observable behaviour:

- Did it retrieve the correct evidence?
- Did it distinguish policy, observation, and inference?
- Did it detect planted contradictions?
- Did it avoid unsupported conclusions?
- Did it select appropriate tools and investigation steps?
- Did it preserve required human-control points?
- Did it escalate incomplete, ambiguous, and high-risk cases?
- Could a reviewer trace every important finding to its source?

Failed cases will remain visible. The purpose of the experiment is to learn how the system fails, not to curate a perfect demo.

## Running locally

Fieldguide is a [Flue](https://flueframework.com) project: agents are TypeScript functions in `src/agents/`. A module whose first line is the `'use agent'` directive exports agents, and each exported capitalised function is one agent whose name is its durable identity.

### Setup

```sh
npm install
```

Then add a model provider API key to `.env` (any [provider Pi supports](https://pi.dev/docs/latest/providers#api-keys)):

```sh
FIREWORKS_API_KEY="..."
```

#### Evidence source

Fieldguide reaches evidence through two search-and-read tools whose choice the model makes each turn, plus one finish tool. Which pair is mounted depends on the environment:

- **Live Notion** — set `NOTION_TOKEN` (a Notion integration token; optionally `NOTION_API_URL` to point at a proxy). The agent calls the Notion REST API and exposes `search_documents` (natural-language search, free) and `read_document` (fetch one document's text, costs one step). REST rather than MCP because the read has to be gated against the step budget, and Flue runs MCP tools only when the model calls them directly. This is the production path.
- **Fixtures** — with no `NOTION_TOKEN`, the agent falls back to the local `evidence/*.md` corpus via `list_evidence` and `read_evidence`. This keeps the evals deterministic and offline.

Both paths share one read budget (`MAX_STEPS`) and one turn budget (`TURN_CAP`); past the turn budget the run can only save a provisional partial map via `finish_incomplete`. `finish_operating_map` accepts only citations to documents the audit actually read — this run or an earlier one — and a live-sourced map is always stamped provisional.

```sh
NOTION_TOKEN="..."
```

### Run an audit

An audit is the durable investigation; a run is one bounded pass over it. Found the audit first:

```sh
npm run audit -- new --id audit-1 --objective "Audit how SignalWire approves and distributes press releases"
```

Then run against it. Each run is a fresh conversation with its own read and turn budgets, so give it a new `--id` every time and name the audit in `--data`:

```sh
npx flue run src/agents/fieldguide.ts --new --id audit-1-run-1 \
  --data '{"auditId":"audit-1"}' \
  --message "Audit how SignalWire approves and distributes press releases"
```

The run writes `data/audits/audit-1/audit-1-run-1.json`: the operating map, wrapped in the record of the run that produced it and what it retained. A run against an audit that was never founded fails before the first model turn.

Between runs, a person answers what the copilot escalated. An answer is evidence: it names a document, and the next run must read it before citing it.

```sh
npm run audit -- show --id audit-1
npm run audit -- answer --id audit-1 --question "Who signs off a compliance exception?" --evidence procedure-approvals
```

`npm run audit -- retention` prints everything the system keeps and why.

Typecheck with `npm run check:types`.

### Learn more

- [Flue docs](https://flueframework.com/docs/), or `npx flue docs` from the terminal.
- See `AGENTS.md` for the project layout and common commands.

## Current status

Fieldguide is an early learning project, not production software. The client, people, records, incidents, and operating metrics used in the initial experiment are entirely synthetic.

## Why build this in public?

Forward Deployed Engineering sits between business discovery and production engineering. A polished final demo hides most of the interesting work: incorrect assumptions, awkward integrations, failed evals, recovery behaviour, and the decisions about where AI should not be used.

Building in public creates a record of that work and makes the final case study evidence-based rather than retrospective. Two documents keep that record:

- [`docs/decisions.md`](docs/decisions.md) — an append-only log of the architectural decisions and the reasoning behind them.
- [`docs/diary.md`](docs/diary.md) — plain-language updates at each milestone, for anyone following along.

## Licence

To be decided before the project accepts external contributions or reuse.
