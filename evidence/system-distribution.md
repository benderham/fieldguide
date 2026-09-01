# System Note: Distribution Tool

Internal documentation for the distribution tool ("WirePush").

WirePush pushes an approved release to three channels: the newswire feed, the
subscriber email blast, and the partner API. Distribution is triggered manually
by an editor pasting the final headline and body into WirePush and selecting
channels.

WirePush has no integration with the intake form or the editorial tracker.
Content is entered by hand. There is no automated check that a release marked
"Approved" in the tracker matches the content pushed, or that compliance
sign-off exists for financial releases.

WirePush records a timestamp and the operator's name for every push. These logs
are retained for 90 days. They are the only reliable record of what was actually
distributed and when.
