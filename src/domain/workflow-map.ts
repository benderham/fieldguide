// The run budgets and gates. The deliverable schema that once lived here is
// superseded by `operating-map.ts` (see ADR-0007); the read-budget primitives
// remain, shared by the fixture and live-Notion read paths, alongside the
// whole-run turn cap.

/** Maximum evidence reads per run. Set below the fixture count so the cap is exercised. */
export const MAX_STEPS = 4;

/**
 * Maximum tool-calling turns per run. Flue exposes no runtime turn bound, so this
 * cap is enforced in the agent render: past it the only tool offered is
 * `finish_incomplete`. Set well above the read budget to leave room for the
 * record and finish turns. See docs/decisions.md.
 */
export const TURN_CAP = 12;

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
			message: `Step limit reached (${stepsUsed}/${max}). Do not read more evidence. Record the operating map from what you have, then call finish_operating_map.`,
		};
	}
	return { allowed: true, message: null };
}

/** True once the run has spent its turn budget: the render then offers only `finish_incomplete`. */
export function overTurnCap(turnsUsed: number, max: number = TURN_CAP): boolean {
	return turnsUsed >= max;
}
