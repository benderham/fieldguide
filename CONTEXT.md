# Fieldguide

A discovery copilot that reconstructs how work actually happens from the evidence it can reach, and produces one traceable operating map. This glossary pins the terms that carry specific meaning here; it is not a spec.

## Language

### The deliverable

**Operating map**:
The single canonical record a run produces, holding all eight copilot outputs in one validated object.
_Avoid_: Report (that is the rendered Markdown view of the map), workflow map (the superseded predecessor).

**Audit objective**:
The submitted instruction a run investigates, the agent's only human input, validated before the first model turn.
_Avoid_: Prompt, query, task.

**Final** / **Provisional**:
A map's standing. Final findings are verified; provisional findings are pending a human's verification. A live-sourced map is always provisional.
_Avoid_: Draft, complete (those describe how much is filled, not whether it is verified).

**Incomplete map**:
A partial map saved when the turn budget runs out before every section is recorded. Always provisional.

### The investigation

**Audit**:
The durable investigation an operating map is built for. Founded explicitly, identified by an id a human supplies, and the owner of everything that outlives a single pass: the evidence register, the read set, open questions, contradictions.
_Avoid_: Session, conversation (both name Flue mechanics, not the investigation).

**Run**:
One bounded pass over an audit: a fresh agent instance with its own read and turn budgets and an empty transcript. An audit may take several.
_Avoid_: Attempt, pass (a run is the unit budgets are counted against).

**Canonical record**:
Something the audit keeps because it stays true after the run that found it ends: a claim, a read, an open question, a contradiction. Only canonical records are seeded into a later run.

**Snapshot**:
One run's conclusions, kept immutably as history. A later run's snapshot supersedes an earlier one; snapshots are never merged and never seeded back, so conclusions are re-derived from evidence rather than inherited.
_Avoid_: Version, revision (a snapshot is not an edit of the one before it).

**Retention scope**:
How long a retained item lives and what a later run may do with it: `run` (discarded with the run), `audit` (accumulates as canonical state), `history` (kept, never an input). Every retained item carries one, plus a written reason.

**Human answer**:
The document a person's answer to an open question arrives as. It is evidence like any other: a run must read it before citing it, and it is staff recollection, not fact.
_Avoid_: Response, resolution (an answer settles the question, it does not adjudicate the evidence).

### Evidence

**Claim**:
One traceable statement drawn from a document, classified by type, quoting a verbatim span, and naming the evidence it came from. The substrate every finding rests on.
_Avoid_: Fact, finding (a claim is evidence, not adjudicated truth).

**Provenance**:
Where a run's evidence came from: the local fixtures, or a live Notion workspace. Set by the run, not the model.
_Avoid_: Source (overloaded), origin.

**Support**:
The claims or read evidence a recommendation cites to justify it. A recommendation with no support cannot be a final finding.

### Boundaries and guards

**Audit boundary**:
The set of rules a run may not cross when recording outputs: cite read evidence, never resolve a contradiction, treat recollection as evidence not fact, escalate compliance-sensitive or irreversible decisions, and never let an autonomous AI part approve or publish. Enforced as schema guards and finish-time checks, not prompt instructions.
_Avoid_: Operating boundary (the same thing; prefer "audit boundary").

**Decision class**:
The kind of decision a recommendation's action makes: advisory, approval, or publish. An autonomous AI part may carry only advisory.

**Escalation**:
Handing a compliance-sensitive or irreversible decision to a human, by flagging it, marking a contradiction needs-human, or marking an open question blocking. The copilot escalates; it never decides.

### Run budgets

**Read budget**:
The maximum evidence reads a run may spend. A read is one investigative step.
_Avoid_: Step budget (prefer "read budget" now that turns are also counted).

**Turn budget**:
The maximum tool-calling turns a run may take, bounding a run that never finishes. Past it, the run can only save a provisional incomplete map.
_Avoid_: Turn cap (that names the limit; the budget is what a run spends against it).
