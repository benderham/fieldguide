# Project diary

Plain-language updates for anyone following Fieldguide. Newest first. No jargon, no code: this is the story of the project, not its technical record. The decisions and their reasoning live in `decisions.md`; the fine detail lives in the commit history.

---

## An audit can be picked up where it was left

Until now, every time Fieldguide looked at a workflow it started from nothing. It read what it could, produced its map, and forgot everything. That was fine while the point was proving it could do the work at all, but it made one of its most important habits pointless. Fieldguide is built never to decide things a person should decide: when it hits a compliance question, or an account of the work that only a human can settle, it hands the question over rather than guessing. Handing a question over is meaningless if nobody can hand back an answer, and there is nothing left to hand it back to.

So an investigation is now a thing that lasts, and a single sitting is just one pass over it. What carries from one pass to the next is deliberately narrow: the evidence gathered, the documents opened, the questions still unanswered, and the disagreements nobody has settled. Those keep for a simple reason — they stay true. A sentence quoted from a policy is still in that policy tomorrow.

What does not carry over is Fieldguide's own thinking. Its conclusions from a previous pass — the risks it named, the improvement it recommended, what it thought the change was worth — are kept as a record of what it concluded that day, and are never fed back to it. When work resumes, it sees the evidence again and has to reach its own view, rather than being handed last week's story and asked to nod along. The same goes for its working notes: the model's own reasoning is kept so we can see how it arrived at a bad answer, but it is never treated as something the next pass can build on. Reasoning is how you get to a finding; it is not itself a finding.

That distinction turned out to have a sharper edge than expected. Fieldguide was already allowed to label some of its statements as its own inference rather than as something a document said — an honest label, and useful. But nothing stopped it then leaning on that inference as the support for its recommendation, or as the evidence behind a number, which is a neat way of quoting yourself as your own source. It can still use an inference to describe how a step works. It can no longer use one to hold up a conclusion.

A person answering a question now does so by pointing at a document, and Fieldguide has to actually open and read it before anything can rest on it. An answer gets no more trust than a policy or an interview does; it is somebody's account, filed as such. And every single thing the system keeps now has to say, in writing, why it is worth keeping. That includes the least flattering item on the list: the full transcript of everything the model ever thought, which is kept indefinitely, is never treated as fact, and would need a proper deletion policy the day this runs on a real client's material.

Still ahead: proving all of this against the live workspace, and seeing whether a second pass genuinely spends its effort on what is still open rather than re-reading what it already knows.

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
