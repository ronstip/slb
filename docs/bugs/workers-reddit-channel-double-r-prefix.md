# workers — Reddit channel collection returns 0 posts for "r/name" handles

## Repro
1. Agent → Settings → Data Sources → add a Reddit source, leave Keywords empty.
2. In Channels type `r/nba` (the placeholder is "reddit.com/r/name or name", so the
   `r/` prefix is an invited input form) and commit the chip.
3. Save, click the per-source play → Start refresh.
4. Collection runs but stores 0 posts. No error surfaces in the UI.

## Root cause
`BrightDataAdapter._collect_reddit` (`workers/collection/adapters/brightdata.py`)
built the subreddit URL with a bare prepend:

```python
if not url.startswith("http"):
    url = f"https://www.reddit.com/r/{url}/"
```

For `r/nba` this yields `https://www.reddit.com/r/r/nba/` (double `r/`) — there is no
subreddit named `r`, so BrightData's `subreddit_url` discovery returns only error
items → 0 valid posts. Same class as the Twitter bare-handle bug
(`workers-twitter-channel-bare-handle.md`): the channel UI accepts a handle form the
adapter didn't normalize.

## Fix
New module helper `_normalize_subreddit_url(raw)` accepts a full URL, `r/name`,
`/r/name`, or bare `name`, strips a leading `r/`, and returns a single canonical
`https://www.reddit.com/r/<name>/`. `_collect_reddit` now routes every channel input
through it (skipping empties).

## Regression test
`workers/collection/adapters/test_brightdata_adapter.py::test_reddit_channel_normalizes_subreddit_inputs`
— feeds `["r/nba", "nba", "https://www.reddit.com/r/nba/"]` and asserts all three
resolve to `https://www.reddit.com/r/nba/` via the posts dataset + `discover_by="subreddit_url"`.

## Fix commit
Branch `dev` (channel-collection feature), not yet committed at time of writing.
