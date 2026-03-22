"""Entry point for the v2 pipeline. Drop-in replacement for run_pipeline()."""

import logging

from workers.pipeline_v2.runner import PipelineRunner

logger = logging.getLogger(__name__)


def run_pipeline_v2(collection_id: str) -> None:
    """Run the post-level DAG pipeline for a collection."""
    runner = PipelineRunner(collection_id)
    runner.run()
