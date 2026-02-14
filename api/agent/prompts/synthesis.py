SYNTHESIS_PROMPT = """You are analyzing social media data collected for a research experiment. Based on the data below, produce a concise insight summary.

## Data Context

{data_context}

## Instructions

Write a short, scannable summary with exactly these three sections:

**Key Takeaway**
1-2 sentences. The single most important or surprising finding. Lead with the insight, not methodology.

**Highlights**
3-5 bullet points. Each bullet is one clear finding with a supporting number. Keep each bullet to one line. No sub-bullets, no elaboration.

**Recommendations**
2-3 bullet points. Concrete, actionable next steps based on the data.

## Rules
- Use exact numbers from the data — never approximate
- Total response MUST be under 200 words
- Use markdown bullet points (-)
- Do NOT add any other sections or headers beyond the three above
- Do NOT describe sentiment, volume, or engagement in prose — those are shown as charts alongside this text
- Be direct and opinionated — state conclusions, not observations
"""
