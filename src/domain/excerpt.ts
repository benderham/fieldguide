export type Excerpt = {
	id: string;
	title: string;
	body: string;
};

/**
 * Parse one evidence file into an excerpt. The id is the filename without its
 * `.md` extension; the title is the first Markdown H1, falling back to the id.
 */
export function parseExcerpt(filename: string, raw: string): Excerpt {
	const id = filename.replace(/\.md$/, '');
	const heading = raw.split('\n').find((line) => line.startsWith('# '));
	const title = heading ? heading.slice(2).trim() : id;
	return { id, title, body: raw.trim() };
}
