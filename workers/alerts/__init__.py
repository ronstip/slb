"""Dynamic per-agent email alerts.

When an agent run finishes (all its collections enriched),
`evaluator.evaluate_alerts_for_agent_run` matches the run's newly-collected posts
(across ALL the run's collections) against every enabled alert on the agent and
emails the recipients on a match. Filter evaluation reuses the dashboard engine
(`api.services.dashboard_widget_filters`) verbatim.
"""
