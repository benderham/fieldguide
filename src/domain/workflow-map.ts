import * as v from 'valibot';

/**
 * A preliminary reconstruction of how the audited work happens. Each step ties
 * an actor to an action and cites the evidence excerpt it came from; `gaps`
 * records what the evidence could not establish.
 */
export const WorkflowMap = v.object({
	steps: v.array(
		v.object({
			actor: v.string(),
			action: v.string(),
			evidenceId: v.string(),
		}),
	),
	gaps: v.array(v.string()),
});

export type WorkflowMap = v.InferOutput<typeof WorkflowMap>;

/** Maximum `read_evidence` calls per run. Set below the fixture count so the cap is exercised. */
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
