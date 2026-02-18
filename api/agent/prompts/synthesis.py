SYNTHESIS_PROMPT = """You are analyzing social media data collected for a research experiment. Based on the data below, produce a concise insight summary.

## Data Context

{data_context}

## Instructions

Write a short, scannable summary with exactly these two sections:

**Key Takeaways**
2-3 bullet points. Each bullet is one major finding or surprising insight, with a supporting number. Lead with the insight, not methodology.

**Highlights**
3-5 bullet points. Each bullet is one clear finding with a supporting number. Keep each bullet to one line. No sub-bullets, no elaboration.

## Rules
- Use exact numbers from the data — never approximate
- Total response MUST be under 150 words
- Use markdown bullet points (-)
- Do NOT add any other sections or headers beyond the two above
- Do NOT describe sentiment, volume, or engagement in prose — those are shown as charts alongside this text
- Be direct and opinionated — state conclusions, not observations
"""
