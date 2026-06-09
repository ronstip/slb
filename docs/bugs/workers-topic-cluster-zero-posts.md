# workers — paid topic-clustering Gemini calls when a run collected 0 new posts

## Repro
1. Trigger a collection/data-refresh that ends up collecting 0 new posts (e.g. a channel
   refresh that returns nothing, or a re-run with no new content).
2. Admin → Recent Activity shows a burst of `topic_cluster` Gemini cost events anyway.

## Root cause
The pipeline's final stage (`workers/pipeline/runner.py`, ~line 1874) ran the agent-wide
topic-clustering step (`run_llm_topics` / `run_clustering`) unconditionally whenever
`auto_regenerate_on_pipeline` was on — even when the run added nothing. Re-clustering an
unchanged corpus reproduces the same topics and bills Gemini for a no-op.

## Fix
Track `self._posts_marked_this_run` (incremented at `mark_collected(in_range)`), and skip
topic regeneration when it is `<= 0`. Uses a per-run counter (not the cumulative
`_total_posts_collected`, which the resume branch overwrites) so it's correct for both fresh
and continuation runs. Existing `topic_clusters` rows remain valid.

## Regression test
Logic is a guard in the pipeline finalize path; covered by manual verification (0-post run
emits no `topic_cluster` events). No isolated runner unit-test harness exists for this stage.

## Fix commit
Branch `dev` (channel-collection feature), not yet committed at time of writing.
