# Project diary

Plain-language updates for anyone following Fieldguide. Newest first. No jargon, no code: this is the story of the project, not its technical record. The decisions and their reasoning live in `decisions.md`; the fine detail lives in the commit history.

---

## 2 September 2026 — Fieldguide reads from the real workspace

Until now, Fieldguide practised on a small set of sample files kept inside the project. That was enough to prove the investigation loop worked: give it a goal, let it decide what to look at next, and have it hand back a first sketch of how the work actually happens.

This week it graduated to the real thing. Fieldguide can now read from a live Notion workspace. We pointed it at a single section, a set of pages describing how SignalWire receives, reviews, approves and publishes client press releases, and confirmed it can see those pages and nothing else in the workspace. The boundary is set in Notion itself, by choosing which pages the tool is allowed to open.

Two habits from the practice version carried over on purpose. Fieldguide still works to a fixed budget: it can only open so many documents before it has to stop and produce its map, which keeps a run quick and accountable. And every claim in its final map still points back to a specific document it read, so a person can check the source rather than take its word.

One decision this week is worth flagging because it went against the obvious choice. Notion offers a ready-made connector that would have been less work to plug in. We looked at it and turned it down, because it would have let Fieldguide read documents without those reads counting against its budget. Keeping the agent honest and bounded mattered more than saving ourselves a little wiring. That trade-off, and the others behind it, are written up in the decisions log.

Next up: seeing how well Fieldguide reconstructs the real publishing workflow from these pages, and where it gets confused or over-reaches.
