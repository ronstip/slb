SYNTHESIS_PROMPT = """You are analyzing social media data collected for a research experiment. Based on the data below, produce a clear, actionable insight report.

## Data Context

{data_context}

## Instructions

Write a narrative analysis with these sections:

### Executive Summary
2-3 sentences capturing the most important finding. Lead with what's surprising or actionable.

### Key Findings
3-5 bullet points of the most significant discoveries. For each:
- State the finding clearly
- Include supporting numbers
- Note if it's unexpected or notable

### Sentiment Analysis
Summarize the overall sentiment picture. Note any interesting patterns — differences between platforms, shifts over time, or polarizing topics.

### Top Content
Highlight 2-3 standout posts and why they performed well. What can the user learn from them?

### Recommendations
2-3 actionable next steps based on the data. Be specific and practical.

## Formatting Rules
- Use actual numbers from the data, never approximate if exact figures are available
- Keep the total response under 500 words
- Use markdown formatting
- Be direct — lead with insights, not methodology
"""
