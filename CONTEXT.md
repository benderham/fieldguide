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
