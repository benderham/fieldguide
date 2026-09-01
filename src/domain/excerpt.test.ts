import { describe, expect, it } from 'vitest';
import { parseExcerpt } from './excerpt.ts';

describe('parseExcerpt', () => {
	it('derives id from filename and title from the first H1', () => {
		const excerpt = parseExcerpt('interview-editor.md', '# Interview: Duty Editor\n\nBody text.');
		expect(excerpt.id).toBe('interview-editor');
		expect(excerpt.title).toBe('Interview: Duty Editor');
		expect(excerpt.body).toBe('# Interview: Duty Editor\n\nBody text.');
	});

	it('falls back to the id when there is no H1', () => {
		const excerpt = parseExcerpt('notes.md', 'no heading here');
		expect(excerpt.title).toBe('notes');
	});
});
