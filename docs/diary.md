# Project diary

Plain-language updates for anyone following Fieldguide. Newest first. No jargon, no code: this is the story of the project, not its technical record. The decisions and their reasoning live in `decisions.md`; the fine detail lives in the commit history.

---

## Fieldguide produces the full operating map

Fieldguide's first version handed back a single thing: a sketch of the steps in a workflow, each pointing at the document it came from. Useful, but only a small part of what the job asks for. The job asks for eight things: the map of how the work happens now; a register of the evidence and, kept separate, the places where accounts disagree; the questions a person still needs to answer; where the work is risky or painful; who should own each step, whether a person, plain software, or an assistant; a ranked list of improvements worth trying; one small, safe change to try first; and an honest account of what it is worth, with its assumptions labelled as assumptions. Fieldguide now produces all eight.

The harder part was building in the guardrails the job insists on, so they hold by construction rather than by hope. Every finding has to quote the document it rests on, and Fieldguide cannot cite a document it never opened, nor pass off words that are not actually in the source. When two people describe the work differently, it cannot pick a side; it records both accounts and, where the stakes call for it, marks the disagreement as one a person must settle. What someone remembers in an interview is filed as recollection, never as established fact. Anything touching a compliance sign-off, or a step that cannot be taken back once done, is flagged for a human and can never be handed to the assistant to decide. And it will not propose automating a step for the sole reason that the step is done by hand; it has to point to a real problem that automating would solve.

A valid shape is not proof of good judgement, so Fieldguide is also run against the sample material and graded on seven specific things we care about, such as catching the planted disagreement over whether a chat message counts as sign-off, and escalating the release that went out on a verbal 'ok' the compliance officer never gave. Grading is exact and repeatable. Because the model behind Fieldguide is small, it does not get everything right every time, so the run is repeated and we keep the honest score rather than a flattering one. In a set of three runs, all three produced a fully correct result, passing every one of the seven checks; the small model does not always finish inside its time budget, which is why the run is repeated rather than trusted once. The readable report a reviewer opens is built straight from the recorded map with no model involved, so it always matches what Fieldguide actually found.

Still ahead: making the same work against the live workspace, and helping the small model finish more reliably inside its time budget.

---

## Fieldguide reads from the real workspace

Fieldguide began by practising on a small set of sample files kept inside the project. That was enough to prove the investigation loop worked: give it a goal, let it decide what to look at next, and have it hand back a first sketch of how the work actually happens.

The plan was always to move it onto real material, and it now reads from a live Notion workspace. We pointed it at a single section, a set of pages describing how SignalWire receives, reviews, approves and publishes client press releases, and confirmed it can see those pages and nothing else in the workspace. The boundary is set in Notion itself, by choosing which pages the tool is allowed to open.

Two habits from the practice version carried over on purpose. Fieldguide works to a fixed budget: it can only open so many documents before it has to stop and produce its map, which keeps a run quick and accountable. And every claim in its final map points back to a specific document it read, so a person can check the source rather than take its word.

One decision along the way is worth flagging, because it went against the obvious choice. Notion offers a ready-made connector that would have been less work to plug in. We looked at it and turned it down, because it would have let Fieldguide read documents without those reads counting against its budget. Keeping the agent honest and bounded mattered more than saving ourselves a little wiring. That trade-off, and the others behind it, are written up in the decisions log.

Still ahead: seeing how well Fieldguide reconstructs the real publishing workflow from these pages, and where it gets confused or over-reaches.
