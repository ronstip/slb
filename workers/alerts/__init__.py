"""Dynamic per-agent email alerts.

When a collection run finishes enrichment, `evaluator.evaluate_alerts_for_collection`
matches the run's newly-collected posts against every enabled alert on the
owning agent and emails the recipients on a match. Filter evaluation reuses the
dashboard engine (`api.services.dashboard_widget_filters`) verbatim.
"""
