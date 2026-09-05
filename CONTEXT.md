# Fieldguide

A Discovery Copilot. This glossary pins the terms that carry specific meaning here; it is not a spec.

Terms are added as they are settled, not written up front. Everything below has been decided; anything absent is still open.

## Language

**Discovery objective**:
The instruction a run investigates, supplied by a human as the CLI's argument. The only human input to a run.
_Avoid_: Prompt, query, task.

**Discovery note**:
One document a run may read. On Day 1 these are synthetic and authored alongside the project; later they come from a real source.
_Avoid_: Document, file, fixture (those describe the storage, not the role).

**Description**:
The one-line account of a discovery note that the model sees *before* reading it, and chooses from. Deliberately no more informative than a filename would be — a description rich enough to write a brief from defeats the point of reading. A property of the corpus, computed once, never regenerated inside a run.
_Avoid_: Gist (collides with GitHub Gist, and this repo is hosted there), summary, excerpt (both imply the note's content is being condensed; a description only says what the note is).

**Step**:
One discovery note read. Not one model turn and not one pass: a turn in which the model reasons and writes prose costs no steps. The step limit therefore bounds how much evidence a run may gather.
_Avoid_: Turn, iteration, pass.

**Discovery brief**:
What a run produces: prose, written by the model from the notes it read. Preliminary by nature — a run that exhausts its step limit still produces one, from whatever it gathered.
_Avoid_: Report, summary, findings.
