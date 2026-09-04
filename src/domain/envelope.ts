import type { OperatingMap, OperatingMapDraft, Provenance } from './operating-map.ts';
import { type RetentionEntry, retentionManifest } from './retention.ts';

/**
 * What a run leaves behind: the operating map, wrapped in the record-keeping
 * around it.
 *
 * The wrapping is deliberate. `provenance` and `status` live *inside* the map
 * because they are epistemic properties of the findings — how much a reader
 * should trust them. The audit and run ids, and the retention manifest, are
 * facts about the record of the run rather than about the findings, and putting
 * a description of its own storage inside the copilot's eight-output deliverable
 * would confuse the two. So `OperatingMap` is untouched and `renderReport` stays
 * a pure function over it.
 */

/** What a finish tool hands the persistence layer. One of `map` (complete) or `draft` (turn-capped) is always present. */
export type RunOutcome = {
	auditId: string;
	runId: string;
	/** The objective this run was given, which may differ from the one the audit was founded on. */
	objective: string;
	provenance: Provenance;
	incomplete: boolean;
	map?: OperatingMap;
	draft?: OperatingMapDraft;
	/** The opportunity of a recommendation withheld from a partial map because it failed the guards. */
	withheld?: string;
};

export type RunEnvelope = {
	audit: {
		auditId: string;
		/** The objective the audit was founded on. Recorded beside the run's own so drift is visible after the fact. */
		objective: string;
	};
	run: {
		runId: string;
		objective: string;
		provenance: Provenance;
		incomplete: boolean;
		savedAt: string;
		withheld?: string;
	};
	/** What this system kept and why, at both scopes. The registry, rendered. */
	retention: RetentionEntry[];
	map?: OperatingMap;
	draft?: OperatingMapDraft;
};

/** Wrap a run's outcome for the record. `foundingObjective` comes from the audit, never from the model. */
export function buildEnvelope(
	outcome: RunOutcome,
	foundingObjective: string,
	savedAt: string,
): RunEnvelope {
	return {
		audit: { auditId: outcome.auditId, objective: foundingObjective },
		run: {
			runId: outcome.runId,
			objective: outcome.objective,
			provenance: outcome.provenance,
			incomplete: outcome.incomplete,
			savedAt,
			...(outcome.withheld === undefined ? {} : { withheld: outcome.withheld }),
		},
		retention: retentionManifest(),
		...(outcome.map === undefined ? {} : { map: outcome.map }),
		...(outcome.draft === undefined ? {} : { draft: outcome.draft }),
	};
}
