// The step budget and gate. The deliverable schema that once lived here is
// superseded by `operating-map.ts` (see ADR-0007); only the read-budget
// primitives remain, still shared by the fixture and live-Notion read paths.

/** Maximum evidence reads per run. Set below the fixture count so the cap is exercised. */
export const MAX_STEPS = 4;

export type StepGate = { allowed: true; message: null } | { allowed: false; message: string };

/**
 * Decide whether another evidence read is permitted. The count is the number of
 * reads already spent; at or above the limit the caller must stop and produce
 * the map instead.
 */
export function stepGate(stepsUsed: number, max: number = MAX_STEPS): StepGate {
	if (stepsUsed >= max) {
		return {
			allowed: false,
			message: `Step limit reached (${stepsUsed}/${max}). Do not read more evidence. Call produce_workflow_map now with your preliminary map, marking anything unverified in gaps.`,
		};
	}
	return { allowed: true, message: null };
}
