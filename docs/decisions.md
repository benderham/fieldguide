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

**Status:** AMENDED (by ADR-0007, ADR-0010) · 2026-09-02

**Context.** Each step in the produced workflow map cites the document it came from, so a reviewer can trace it. A citation is only meaningful if it points at a document the agent actually opened during the run.

**Decision.** The run records the id of every document it successfully reads. The finish tool accepts a citation only if its id is in that set. A read that fails does not record an id, so it cannot later be cited.

**Consequences.** The citation guarantee is as strong as the read path's failure behaviour: a failed read must not record its id. The REST delegate throws on a non-ok response, so a failed fetch never records, which is what makes this hold. This is one more reason reads go through our own code (ADR-0004).

---

## ADR-0006 — Scope Notion access through integration sharing, not code-side filtering

**Status:** ACCEPTED · 2026-09-02

**Context.** The agent should only reach the intended section of a Notion workspace, not everything an account can see. Scope can be enforced in Notion's sharing model or in our own code.

**Decision.** Rely on Notion's sharing. A Notion integration reads only the pages explicitly connected to it, and sub-pages inherit their parent's connection. Scoping is done by connecting the integration to a single root page and nothing else. Our code adds no ancestor filtering.

**Consequences.** The boundary is enforced by Notion and needs no code. The search endpoint has no "within this subtree" filter, so this only works while the integration is connected to just the intended root. If the same integration ever needs connecting to unrelated pages, a code-side fence (a configured root id plus a descendant check) would have to be added as a later entry.

---

## ADR-0007 — The deliverable is one validated operating map covering all eight copilot outputs

**Status:** ACCEPTED · 2026-09-02

**Context.** The copilot assignment asks for eight outputs (a current-state operating map; an evidence and contradiction register; focused clarification questions; friction and risk; a software/agent/human responsibility map; a ranked opportunity assessment; a recommended thin-slice workflow; expected value and open assumptions) under five operating boundaries (cite the source behind every material finding; never resolve contradictory accounts silently; treat staff recollection as evidence not fact; escalate compliance-sensitive or irreversible decisions; do not infer that a manual step should use AI merely because it is manual). The previous deliverable was a `WorkflowMap` of `{actor, action, evidenceId}` steps plus `gaps`: it covered one of the eight and enforced only the citation boundary. This work makes the agent satisfy all eight and all five, proven on the local fixtures.

**Decision.** One canonical valibot object, `OperatingMap` (`src/domain/operating-map.ts`), is the record; the `WorkflowMap` schema is superseded (ADR-0005 amended, its citation guarantee carried forward and widened). Five decisions define the design:

1. **One object, phased tools.** The agent fills the map section by section, one tool per section (`record_claims`, `record_workflow`, and the rest), each validating its slice and merging it into a durable draft. `finish_operating_map` assembles the whole object, revalidates it, checks that every cross-reference resolves and every cited evidence id was actually read, then saves and ends the run. Phasing gives the small pinned model early, specific feedback rather than one all-or-nothing parse.

2. **Claims are the substrate, classified at read time.** Every material finding is a `Claim` with a `type` (documented-policy, observed-practice, staff-recollection, system-fact, inference), a verbatim `quote` span, and the `evidenceId` it came from. The agent assigns the type; fixtures carry no machine tags. Typing is what encodes the boundary that staff recollection is evidence, not fact.

3. **The boundaries are schema guards, not prompt hopes.** Citation: a claim needs a non-empty quote and an evidence id, `finish` rejects any evidence id the run did not read (the ADR-0005 mechanism, now over all claim types), and on the fixtures path a claim's quote must be a verbatim span of the cited document (collapsed-whitespace match); the live path cannot verify spans because read bodies are not retained. Never-resolve-silently: `Contradiction` has no resolution or winner field and a `needs-human` status; the type cannot express a silent resolution. Escalate: compliance-sensitive or irreversible items are flagged, and a compliance-sensitive opportunity may be recommended only with an assist-only AI part (a whole-object check). No-AI-because-manual: a responsibility entry may target `agent` only with a rationale naming the friction it addresses. These fail a parse or a `finish` call, so a run cannot end having crossed one.

4. **The report is a pure function.** `renderReport(map)` (`src/domain/render-report.ts`) turns the object into Markdown with no model and no tokens, so the human-readable deliverable is deterministic and free.

5. **Two eval layers.** Structural evals (deterministic Vitest) prove the schema and tools reject what the boundaries forbid. Behavioural evals (`src/evals/`) drive the real agent against the fixtures and grade seven gold cases k-of-n; the grader is pure and unit-tested, the live run is gated behind `RUN_LIVE_EVALS` so the default suite spends no tokens.

Scope is fixtures-only; live-Notion parity is deferred to a later entry. The pinned model (`deepseek-v4-flash-0731`) is held; a bump, if the behavioural rate forces it, is its own entry.

**Consequences.** The boundaries now hold by construction: the failure modes the assignment names (an uncited finding, a silently resolved contradiction, an interview treated as fact, an unbounded AI recommendation, AI proposed for a step with no friction behind it) are unrepresentable or rejected, not merely discouraged. The cost is a much larger schema and ten tools where there was one, and a longer agent loop: a full run makes a dozen-plus tool calls over many turns, which the pinned small model can do but slowly. Because Flue re-renders the agent each turn, the section tools keep an in-turn mirror of the draft so `finish` and the progress messages see sections recorded earlier in the same turn, which the turn-start persistent snapshot alone would miss; the durable write still goes through Flue state. Cross-object boundaries (compliance-sensitive recommendation, agent-target rationale resolving to a real friction) can only be checked once the whole object exists, so they live in the whole-map check and in `finish`, not in the per-section tools.

---

## ADR-0008 — Harden the audit boundary: validate input, cap turns, gate outputs structurally

**Status:** ACCEPTED · 2026-09-03

**Context.** The operating map (ADR-0007) enforced the five copilot boundaries, but three surfaces around it were unguarded. The submitted audit objective reached the model with no validation. The run had a read budget (`MAX_STEPS`) but no bound on total turns, so a model that never finished could loop indefinitely (Flue exposes no runtime turn cap). And the requirement that "unsupported conclusions and prohibited autonomous approval recommendations cannot become final findings" was only partly met: claims and value statements had to cite read evidence, but a recommendation carried no support link and no way to name the kind of decision it made.

**Decision.** Four guards, each structural rather than a prompt instruction.

1. **Validate the objective at the intake seam.** `AuditObjective` (`src/domain/objective.ts`) is a valibot schema: non-empty after trim, at most 2000 characters, at least three readable characters. The agent reads the delivery with `useDelivery()` and validates it inside `useAgentStart()`, whose throw fails the submission before the first model turn. A bad objective is rejected naming the failed rule, never coerced.

2. **Cap total turns at twelve.** `TURN_CAP` (`src/domain/workflow-map.ts`) bounds tool-calling turns, separate from the four-read budget. Each tool run increments a durable `turnsUsed`; because Flue renders are pure reads, the count is flipped inside tools, not in render. Past the cap the render offers only `finish_incomplete`: the tool surface is the enforcement, since Flue has no runtime turn bound. `finish_incomplete` saves whatever sections exist as a provisional, incomplete map (`data/last-operating-map.incomplete.json`, kept apart from the finished artifact) and ends the run, so a capped run does not discard its reads.

3. **A recommendation must cite its support.** `Recommendation.supportRefs` requires at least one claim id or read-evidence id, resolved by `validateCrossRefs`. A recommendation with no support cannot pass `finish`, so an unsupported conclusion cannot become a final finding.

4. **An autonomous AI part may not approve or publish.** `Recommendation.decisionClass` (advisory, approval, publish) names the decision; an entry-level check rejects `autonomous` aiRole paired with an approval or publish class. This is the specific prohibited finding the SignalWire requirement names, now unrepresentable in a valid map.

Output filtering stays structural: the schema and the finish-time cross-reference check are the filter. No semantic classifier scans free-text fields, and none is added; a model self-judging its own prose is the "prompt hope" ADR-0007 rejects. The residual gap this leaves is a recommendation citing a real, read evidence id that does not actually support it, a resolving non-sequitur, catchable only by judgement. On the fixtures path it is unaddressed; on the live path it is moot because every live finding is provisional (ADR-0009).

**Consequences.** The three named failures (an unvalidated objective, an unbounded run, an unsupported or autonomous-approval recommendation) are rejected by construction, at the intake seam, the tool surface, or the schema. The turn cap is best-effort in one narrow sense: a model that emits only free text, calling no tool, ends its response without saving, which the cap cannot prevent; it can only bound tool-calling work, which is the runaway that mattered. Every existing map fixture gained `provenance`, `status`, `decisionClass`, and `supportRefs`, a mechanical but wide change across tests.

---

## ADR-0009 — A live-sourced map is provisional, never final

**Status:** ACCEPTED · 2026-09-03

**Context.** On the fixtures path a claim's quote is verified as a verbatim span of the cited document. On the live-Notion path the read bodies are not retained (ADR-0007), so quotes cannot be verified: a live map's citations are unchecked. Yet nothing distinguished a verified fixture map from an unverified live one; both looked equally final.

**Decision.** The map carries its origin and its standing. `provenance` (fixture or live) and `status` (final or provisional) are set by the run at `finish`, not by the model, so neither can be spoofed. A whole-object check forbids a `final` status on a `live`-sourced map. The run stamps a live map provisional; the report renders a provisional banner ahead of the findings.

**Consequences.** A live-path finding announces that it is pending human verification, which is honest given the unverifiable quotes. The distinction is coarse: it marks the whole map provisional rather than the individual unverifiable spans, and it does not itself add the verification step. When the live path retains bodies and can verify spans, a later entry can let a verified live map be final.

---

## ADR-0010 — Retention: evidence and unresolved questions survive a run; conclusions do not

**Status:** ACCEPTED · 2026-09-04

**Context.** Everything the agent produced was retained the same way and for the same duration. Flue's durable state held the budgets, the read set and the in-progress draft, keyed to a conversation and never reset; `data/last-operating-map.json` held the deliverable, overwritten every run so an audit's history was one file deep. Nothing distinguished a record that must outlive the run from reasoning that should die with it, nothing said why any of it was kept, and nothing stopped a second run inheriting the first run's prose along with its findings.

The shape of the problem is the copilot's own: an audit is not one sitting. It escalates a question, a human answers, work resumes. That only works if the right things survive — and only stays honest if the wrong things do not.

**Decision.** Retention is split by what a record *is*, and every retained item states why it is kept.

1. **Two identities: the audit and the run.** An *audit* is a durable investigation, founded explicitly (`npm run audit -- new`) and living in its own store (`data/audit.db`, `src/store/audit.ts`). A *run* is one bounded pass over it: a fresh Flue instance with a fresh conversation id, its own read and turn budgets, and an empty transcript. `initialData` carries the `auditId`, validated at admission, and a run against an audit the store does not hold fails before the first model turn — a mistyped id cannot quietly found a second investigation.

   A fresh instance per run is not a preference. Flue's durable state never resets (there is no unset; a name once written always has a value), and its conversation record is append-only with no pruning API, so one instance per audit would put the previous run's reasoning in the next run's context on turn one, unremovably. There is no fork, clone or cross-instance state API anywhere in Flue: a fresh id *cannot* inherit a transcript. The rule that a resumed audit rehydrates only from canonical records is therefore unimplementable to violate, rather than a discipline.

2. **Three retention scopes.** `run` — discarded with the run: budgets, the in-progress draft. `audit` — accumulates as canonical state a later run may rest findings on: claims, the read set, open questions, contradictions. `history` — retained but never an input: each run's conclusions, and Flue's transcript.

   Only evidence and unresolved questions accumulate, because only those stay true after the run that found them. The six conclusion sections (steps, frictions, responsibility, opportunities, recommendation, expected value) are an interpretation reached under one objective with one budget; they are saved as immutable per-run snapshots that supersede without merging, and are never seeded back. A resumed audit re-derives its map from the evidence rather than inheriting the story someone told about it last time.

3. **The registry, not the prose, is the policy.** `src/domain/retention.ts` names every retained item with a scope and a written reason. Every durable write path resolves its entry first and throws when there is none, and a test reads the agent source to assert every `usePersistentState` key is registered. A policy that lives only in a document is a docs hope — the documentation analogue of the prompt hopes ADR-0007 replaced. The manifest ships in every run's envelope and renders as a report footer, so a reviewer sees what was kept, at which scope, and why. It includes the transcript store, which is the largest thing kept and the easiest to omit: retained indefinitely, non-canonical, never read back, and on real client evidence in need of a deletion policy the framework cannot currently provide.

4. **One promotion seam, with one deliberate exception.** A finish tool is the only place a run's work crosses into the record (`src/store/persist.ts`): everything crossing has passed the section guards and, for a complete map, the whole-object and cross-reference checks. The exception is reads, which write through as they happen — opening a document is an event that occurred, not a judgement awaiting validation, so a run that crashes still leaves the audit knowing what was looked at. An incomplete run accumulates its evidence and questions exactly as a complete one does; running out of turns does not make a claim less true.

5. **Content-addressed identity.** Model-supplied ids are run-local, so a claim is identified by the span it quotes (`src/domain/identity.ts`), a question by its text, a contradiction by the claims it holds in conflict. Accumulation is idempotent, corroboration is visible as several runs sighting one claim, and the normalisation is versioned because changing it would silently re-identify history. The accumulating types are all commutative — a set of reads, a hashed register — so concurrent runs of one audit converge; the only symptom is a stale seed, which is why no lease is taken.

6. **A human answer is evidence.** An answered question names the document the answer arrived as (`npm run audit -- answer`), and the store owns question status, never the model. The answer is seeded prominently but is not free: a run must read it before anything may rest on it, so the citation guarantee holds for a human's decision exactly as for a policy document. An answer is staff recollection, not fact.

7. **An inference may describe, never support.** The `inference` claim type is the model's own reasoning inside the canonical register. It may appear in a step's or a friction's refs, where it is informative; it may not be the support under a recommendation, the evidence behind a value statement, or a side of a contradiction. Three whole-object checks enforce it. This closes the specific vector of the residual gap ADR-0008 named: without it, "unsupported conclusions cannot become final findings" meant reasoning-backed rather than evidence-backed.

8. **What is deliberately not enforced.** Audit identity is a human assertion: each run stamps its own objective beside the audit's founding one, so drift is auditable after the fact, but nothing rejects a divergent objective — that would need a model judging text, which is the prompt hope ADR-0007 rejects. There is no audit-level budget; a human starts each run, which bounds it better than a number, and the cumulative counts are recorded so the decision can be revisited on evidence. Seeding is whole or not at all: past a registered cap the run refuses to start rather than seed a partial register the model would believe was complete. Retrieval over a large register is the successor to that cap, deferred.

Two things changed during implementation, against the design as reasoned:

- The audit's canonical state was to be mirrored into run-scoped durable state so the citation guards could stay synchronous. It cannot be: the render that declares the hooks runs *before* the intake seam, and Flue recomputes the prompt and tools only after a turn completes, so a mirror written at intake is invisible exactly when the first turn's tools run. The prohibition on store I/O only ever applied to renders, and the store is synchronous, so tools read it directly through a per-run cache in process memory (`src/store/run-context.ts`). Nothing durable is duplicated and the guards stay pure functions over data.
- The scope was to be two values, `run` and `audit`, with `audit` meaning canonical. A snapshot broke that: it survives the run but must never be something a later run rests on. `history` is the third value, so scope alone still carries the meaning.

**Consequences.** An audit can now be worked in several sittings, with escalation that actually returns. What survives is evidence and unresolved questions; what does not survive is conclusion — the run's reasoning product, kept as history but never promoted to something a later run treats as established. The transcript still holds every reasoning delta, forever, and that is now stated rather than unexamined.

The costs are real. Running the agent takes two steps where it took one, since an audit must be founded before a run. `data/last-operating-map.json` is gone, so anything reading it must move to `data/audits/<auditId>/<runId>.json`, where the map sits inside an envelope. The audit id is a free-form string a human passes, and the founding step is what keeps a typo from being silent. And the wiring is proven by the type checker and by unit tests of every piece; the first end-to-end proof is the gated resumption eval, which is the one thing here a deterministic test cannot reach.

**Amends ADR-0005.** Its citation guarantee widens from "a document this run read" to "a document this audit has read". A resumed run may cite what an earlier run opened without spending a read on it again. On the fixtures path this stays airtight, because a quote is verified as a verbatim span of the document independently of who read it. On the live path read bodies are not retained, so an inherited citation is unverifiable and the document may have changed since — which ADR-0009 already covers by stamping every live map provisional. When the live path retains bodies, re-verification hooks in here.
