import * as v from 'valibot';

/** The longest audit objective accepted. Long enough for a paragraph of framing, short enough to reject a pasted dump. */
export const AUDIT_OBJECTIVE_MAX = 2000;

/** The minimum count of letters or digits an objective must carry, so control-character or punctuation-only junk is refused. */
export const AUDIT_OBJECTIVE_MIN_WORD_CHARS = 3;

const wordChars = /[\p{L}\p{N}]/gu;

/**
 * The submitted audit objective. A non-empty, bounded string carrying real text:
 * the agent's only human input, validated at the intake seam before any model
 * turn runs. Coercion is deliberately absent; a bad objective is rejected, not
 * repaired, so tampering is never silently absorbed.
 */
export const AuditObjective = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'an audit objective is required'),
	v.maxLength(
		AUDIT_OBJECTIVE_MAX,
		`an audit objective must be at most ${AUDIT_OBJECTIVE_MAX} characters`,
	),
	v.check(
		(s) => (s.match(wordChars) ?? []).length >= AUDIT_OBJECTIVE_MIN_WORD_CHARS,
		'an audit objective must contain readable text',
	),
);

/** Throw if `body` is not a valid audit objective. A throw at the intake seam fails the submission before the model runs. */
export function assertValidObjective(body: string): void {
	const result = v.safeParse(AuditObjective, body);
	if (!result.success) {
		throw new Error(`Rejected audit objective: ${result.issues[0]?.message ?? 'invalid input'}.`);
	}
}
