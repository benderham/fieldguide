# Architecture decisions

An append-only log of the architectural decisions behind Fieldguide. Newest at the bottom.

Each entry carries a status:

- **ACCEPTED** — in force.
- **PENDING** — proposed, not yet settled.
- **AMENDED** — still in force except where a named later entry changes it.
- **SUPERSEDED** — kept for history; a named later entry replaces it.

Original text is never rewritten. A correction or reversal is a new entry that names the one it changes.

---

## ADR-0001 — Flue owns the agent loop; the repo is a declarative agent plus tools

**Status:** ACCEPTED · 2026-09-02

**Context.** Fieldguide needs an investigative loop: accept an objective, take successive steps, feed each observation into the next turn, and finish. That loop can be hand-written or delegated to a framework.

**Decision.** Delegate the loop to Flue. The repo declares an agent as a function that returns a system prompt and registers tools; Flue drives the model turn after turn, feeds tool results back, and persists conversation state. The repo owns the evidence, the tools, the step budget, and the finish condition, not the iteration.

**Consequences.** Less code to own and test. In exchange, the agent's behaviour is bounded by what Flue exposes, and some capabilities depend on Flue internals rather than our own code. ADR-0004 is a direct instance of that trade-off.

---

## ADR-0002 — A shared step budget and an explicit finish tool bound every run

**Status:** ACCEPTED · 2026-09-02

**Context.** An investigative loop that can read evidence indefinitely is both expensive and unaccountable. Runs need a guaranteed stopping point.

**Decision.** Two stopping mechanisms. Every run finishes explicitly by calling `produce_workflow_map`, which ends the loop. Independently, a step budget (`MAX_STEPS`) caps how many document reads a run may spend; once spent, the read tool refuses further reads and instructs the model to produce its map from what it has. Cheap operations (listing, searching) do not count against the budget; only reads do.

**Consequences.** Every run terminates, one way or the other. The budget is enforced at turn boundaries, so a model that emits several reads within a single turn can momentarily exceed it; the prompt asks for one read per turn to hold that line. There is no framework-level turn cap to fall back on.

---

## ADR-0003 — Evidence has two sources: live Notion in production, local fixtures for evaluation

**Status:** ACCEPTED · 2026-09-02

**Context.** The production agent audits a real Notion workspace. The evaluation suite needs deterministic, offline inputs that never depend on a network or a live workspace.

**Decision.** The presence of a `NOTION_TOKEN` selects the source. With a token, the agent mounts the Notion tools and reads the live workspace. Without one, it falls back to the local `evidence/*.md` fixtures through `list_evidence` and `read_evidence`. Both paths share the same step budget and the same finish tool. The fixtures exist only to exercise the loop under test.

**Consequences.** Evals stay deterministic and offline. The live path cannot be exercised by the offline test suite, so its correctness is verified through injected test doubles rather than a real workspace. The two read paths keep separate not-found behaviour, which is a small, deliberate duplication.

---

## ADR-0004 — Reach Notion over its REST API, not MCP

**Status:** ACCEPTED · 2026-09-02

**Context.** Notion offers a hosted MCP server, and Flue has a native MCP client, so mounting Notion's own `search` and `fetch` tools looked like the least-code path. But ADR-0002 requires that document reads be counted against the step budget, which means the read has to pass through our own gated tool.

**Decision.** Call the Notion REST API directly from our own `search_documents` and `read_document` tools. We do not use MCP for these.

The deciding constraint: a Flue-mounted MCP tool executes only when the model calls it, routed through Flue's internal adapter. Its exposed `run` method is a stub that throws, so our code cannot invoke it to wrap a budget check around it. An MCP-mounted read would therefore be uncounted, and there is no framework turn cap to bound it instead. REST puts our tool in the call path, where it can check the budget before reading and record the read after.

**Consequences.** We own a small amount of Notion REST integration and its request shapes, rather than inheriting them from MCP. In return, live reads are genuinely gated and the citation record (ADR-0005) is trustworthy. MCP was evaluated and rejected here only for reads; a future entry could reintroduce it for a non-budgeted capability such as search.

---

## ADR-0005 — Workflow-map citations are validated against documents actually read

**Status:** ACCEPTED · 2026-09-02

**Context.** Each step in the produced workflow map cites the document it came from, so a reviewer can trace it. A citation is only meaningful if it points at a document the agent actually opened during the run.

**Decision.** The run records the id of every document it successfully reads. The finish tool accepts a citation only if its id is in that set. A read that fails does not record an id, so it cannot later be cited.

**Consequences.** The citation guarantee is as strong as the read path's failure behaviour: a failed read must not record its id. The REST delegate throws on a non-ok response, so a failed fetch never records, which is what makes this hold. This is one more reason reads go through our own code (ADR-0004).

---

## ADR-0006 — Scope Notion access through integration sharing, not code-side filtering

**Status:** ACCEPTED · 2026-09-02

**Context.** The agent should only reach the intended section of a Notion workspace, not everything an account can see. Scope can be enforced in Notion's sharing model or in our own code.

**Decision.** Rely on Notion's sharing. A Notion integration reads only the pages explicitly connected to it, and sub-pages inherit their parent's connection. Scoping is done by connecting the integration to a single root page and nothing else. Our code adds no ancestor filtering.

**Consequences.** The boundary is enforced by Notion and needs no code. The search endpoint has no "within this subtree" filter, so this only works while the integration is connected to just the intended root. If the same integration ever needs connecting to unrelated pages, a code-side fence (a configured root id plus a descendant check) would have to be added as a later entry.
