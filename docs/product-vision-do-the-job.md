# Product Vision: "Do the Job for Them"

## The Prompt

> Look at our product, think about how it relates to us, what can we learn, to preserve and to improve. Do a deep analysis.

## The Input: AI-Native Social Listening Philosophy

This is a really interesting framing — "do the job for them" rather than "help them do the job better." That distinction changes everything about how you design the workflow.

Let me think through this with you by starting from the fundamentals.

### The real job behind social listening

The person doing social listening doesn't actually want to "listen." They want outcomes — a crisis caught before it blows up, a campaign adjusted before the budget is wasted, a product insight surfaced before the competitor acts on it. The listening is just the painful middle step between the world changing and the organization responding.

So if you map out what they actually do today, it looks something like this: they configure keywords and sources, then they wade through a dashboard of mentions, then they try to separate signal from noise, then they synthesize what they found into some kind of narrative, then they communicate that narrative to the person who can actually act on it (a brand manager, a PR lead, a product manager, an executive), and then that person decides what to do.

Most of that chain is waste. The AI-native version should collapse it.

Here's how I'd think about it:

### From monitoring to autonomous response loops

Instead of "set up a tracker -> read a dashboard -> write a report," the workflow becomes: the user describes what they care about in natural language ("I need to know if anyone influential is unhappy with our checkout flow" or "watch for early signs that our rebrand is landing badly with Gen Z"), and then the system runs continuously and only surfaces things when action is needed — not as a feed to scroll, but as a specific recommendation with context.

The key shift: the unit of output isn't a "mention" or a "sentiment score." It's a **brief** — something like "Here's what's happening, here's why it matters, here's what I'd recommend, and here's a draft of the response/report/slack message if you want to act now."

### Where it plugs into real workflows

Think about who actually buys social listening tools and what happens after they get an insight:

The **community/social manager** needs to respond to something — so the app should draft the response and let them approve it, not just flag the post. It pushes to their publishing tool or directly to the platform.

The **PR/comms person** needs to brief leadership on a developing situation — so the app should generate the brief, pre-formatted for their Slack channel or email, with severity assessment and suggested talking points.

The **product manager** needs to understand recurring pain points — so the app should cluster feedback into themes over time, connect them to existing feature requests in their tracker, and surface when a theme is accelerating.

The **brand strategist** needs to know if a campaign is working — so the app should proactively compare real conversation to the intended positioning and flag drift, not wait to be asked.

### What this means for workflow design

A few principles I'd suggest thinking through:

The setup should feel like a conversation, not a configuration panel. "Tell me what you care about" beats "enter keywords, select sources, set sentiment thresholds." The AI figures out what to track from the intent.

There should be almost no dashboard in the traditional sense. Dashboards are a symptom of the tool not knowing what matters. If the AI is doing the job, it should be opinionated about what deserves attention and stay quiet otherwise. Think of it more like a senior analyst who sends you a message when something matters.

The output should be the next action, not the raw data. If the system detects a crisis brewing, the output isn't "negative sentiment is up 40%" — it's a draft holding statement, a list of the key voices to engage, and a recommended escalation path.

It should integrate where decisions happen — Slack, email, the CMS, the ad platform, the product backlog. Not pull people into yet another dashboard they need to check.

### A possible core loop

1. **User describes intent** -> "Watch for..." / "Tell me when..." / "Keep me informed about..."
2. **System autonomously monitors and reasons** -> not just keyword matching but understanding context, detecting emerging patterns, assessing relevance
3. **System delivers actionable briefs** -> pushed to wherever the user works, with drafted next steps
4. **User approves, edits, or redirects** -> one-click to act, or "dig deeper on this" to get more detail
5. **System learns from those decisions** -> refines what matters, what's noise, what level of detail this user wants

The user's ongoing interaction isn't "check the dashboard" — it's responding to briefs and occasionally updating what they care about. The AI does the actual monitoring, analysis, synthesis, and drafting.

---

## The Analysis: How This Applies to SLB

### The Ambition Hierarchy

1. **Tool** -> "Here's data, figure it out" (legacy dashboards)
2. **Assistant** -> "Here's analysis, now decide" (where SLB is today)
3. **Agent** -> "Here's what happened, what it means, and what to do — approve?" (the vision)

SLB is already at level 2 in many ways. The question is how far toward level 3 to push.

---

### What SLB Already Gets Right (Preserve These)

**1. Chat-first is the right entry point.**
The quote says "setup should feel like a conversation, not a configuration panel." SLB already does this — you type "What is TikTok saying about Ozempic?" and the agent designs the research. The `design_research` tool + `ResearchDesignCard` with approve/edit is exactly the right pattern. This is a genuine differentiator. Don't regress toward a form-first flow.

**2. The approve-before-execute pattern.**
The Research Design Card showing keywords, platforms, estimated posts, then letting the user edit or start — this is the right level of human-in-the-loop. The quote's "core loop" step 4 says "user approves, edits, or redirects." We have this.

**3. Multimodal enrichment is a moat.**
Enriching text + images + video via Gemini is something most competitors can't do. The structured enrichment schema (sentiment, emotion, entities, themes, key_quotes) turns raw posts into something an AI can reason about. This is infrastructure for the "do the job" vision.

**4. Agent with real tools, not just chat.**
12 custom tools including `execute_sql`, `create_chart`, `generate_report`, `generate_dashboard` — the agent can actually produce outputs, not just talk about them. This is the right architecture for autonomous work.

---

### Where the Quote Challenges SLB (Improve These)

**1. SLB is still pull-based, not push-based.**

The biggest gap. The quote envisions: "the system runs continuously and only surfaces things when action is needed." SLB's current flow is:

```
User asks question -> Collection runs -> User comes back to check -> User asks for analysis
```

The quote envisions:

```
User sets intent once -> System monitors continuously -> System pushes briefs when something matters
```

The infrastructure pieces exist — ongoing/scheduled collections, cron picker in CollectionForm. But there's no **autonomous reasoning loop** that runs on new data and decides "this is worth alerting the user about." The collection runs, data accumulates, but nobody's watching unless the user opens the app.

**What to build:** A "watch loop" that runs after each scheduled collection batch, applies the user's original intent as a filter, and generates a brief if something noteworthy happened. Push it to Slack/email. The user shouldn't need to open SLB to get value from an ongoing collection.

**2. The dashboard is still the center of the studio.**

The quote is blunt: "There should be almost no dashboard in the traditional sense. Dashboards are a symptom of the tool not knowing what matters."

SLB has a full customizable dashboard system with react-grid-layout, widget editing, filters — a significant investment. But consider: if the AI is good enough, why would a user manually configure widgets? The dashboard should be a **fallback for power users**, not the primary output.

**What to preserve:** Keep dashboards as an artifact type the agent can generate. Keep the shared public dashboard link (that's a distribution mechanism, not a monitoring tool).

**What to shift:** The default Studio experience should be the **Insight Report**, not the dashboard. When analysis completes, the user should see a narrative brief with key findings, not a grid of charts they need to interpret. The agent already has `generate_report` — make that the default output, with "open as dashboard" as a secondary action.

**3. The output stops at insight, not at action.**

The quote's key line: "The output should be the next action, not the raw data."

SLB currently produces: charts, reports, dashboards, CSV exports. These are all **artifacts about the data**. The quote argues the output should be:

- A **draft response** to a negative post (for community managers)
- A **pre-formatted brief** for Slack/email (for PR/comms)
- A **ticket draft** linked to a product backlog (for PMs)
- A **campaign adjustment recommendation** with specific changes (for brand strategists)

SLB's agent is smart enough to generate these, but the tools and card types don't support action-oriented outputs. There's no "draft a response" tool, no "send to Slack" tool, no "create a Jira ticket" tool.

**What to build (incrementally):**
- Start with Slack integration — the agent generates a brief, user clicks "Send to Slack" with channel picker. Lowest-friction action output.
- Add "Draft Response" as an agent capability — given a post and brand voice guidelines, generate a suggested reply.
- Add "Email Brief" — one-click to send an insight report as a formatted email to stakeholders.

**4. The Feed is a dashboard in disguise.**

The Feed tab (masonry grid of posts, sort/filter) is essentially what the quote calls "a feed to scroll." Most users won't read 500 posts. The valuable version of the Feed is **curated** — the AI picks the 5-10 posts that matter most and explains why.

The Topics view is closer to the right idea (clustering), but it still requires the user to click through and interpret.

**What to shift:** Make the default Feed view an AI-curated "highlights" mode — top posts by significance (not just engagement), with the agent's annotation on why each matters. Let users switch to "all posts" view for deep dives.

**5. No persona-aware output.**

The quote spends significant time on personas (community manager, PR lead, PM, brand strategist) because each needs a different output format and different level of detail. SLB currently has one output format regardless of who's asking.

**What to build (later):** Let users set their role during onboarding or in settings. The agent adapts its default output format:
- Community manager -> surfaces posts needing response + draft replies
- PR/comms -> generates stakeholder briefs with severity assessment
- Product manager -> clusters feedback into themes, links to trends over time
- Brand strategist -> compares conversation to intended positioning

This doesn't require new infrastructure — it's a system prompt adjustment based on user profile.

---

### Strategic Prioritization

| Priority | What | Why | Effort |
|----------|------|-----|--------|
| 1 | **Push notifications (Slack/email briefs)** | Transforms from pull to push. Biggest paradigm shift. | Medium |
| 2 | **Make Insight Report the default output** | Shifts from "here's data" to "here's what matters." Already built, just needs to be the default. | Low |
| 3 | **AI-curated Feed highlights** | Stops users from drowning in posts. Leverages existing enrichment. | Medium |
| 4 | **"Send to Slack" action on reports** | First "action output" — bridges insight to distribution. | Low-Medium |
| 5 | **Draft Response tool** | First "do the job" output for community managers. | Medium |
| 6 | **Persona-aware output formatting** | Tailors value prop per buyer. System prompt change. | Low |
| 7 | **Autonomous watch loop** | Full vision — system reasons on new data without being asked. | High |

---

### The Honest Assessment

SLB is ahead of most competitors because it starts with a conversation, not a form. That's genuinely differentiated. But the quote exposes the gap between "AI-assisted social listening" and "AI that does social listening for you."

The current product is essentially: **a really good analyst you can talk to, but who only works when you're in the room.** The vision is: **an analyst who works 24/7, only bothers you when something matters, and hands you the draft of what to do next.**

The good news: the infrastructure is almost all there. BigQuery for data, Gemini for reasoning, scheduled collections for continuous monitoring, the agent tool system for producing outputs. The gap is mostly in the **last mile** — pushing outputs to where users work, and shifting the default experience from "explore data" to "receive briefs."

The biggest risk from the quote's framing: don't kill the dashboard/feed prematurely. Power users and analysts *want* to explore. The right move is to make the **default path** brief-oriented while keeping exploration available. Two modes: "tell me what matters" (default) and "let me dig in" (power user).

---

*Date: 2026-03-23*
