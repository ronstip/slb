"""Component fillers for presentation placeholders."""

from api.agent.tools.presentation.components.text import fill_text
from api.agent.tools.presentation.components.chart import fill_chart
from api.agent.tools.presentation.components.table import fill_table
from api.agent.tools.presentation.components.kpi_grid import render_kpi_grid
from api.agent.tools.presentation.components.key_finding import render_key_finding

__all__ = [
    "fill_text",
    "fill_chart",
    "fill_table",
    "render_kpi_grid",
    "render_key_finding",
]
