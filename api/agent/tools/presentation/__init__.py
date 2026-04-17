"""Presentation generation package — template-native PowerPoint rendering.

Exports:
    generate_presentation — render a deck from a validated plan
    validate_deck_plan — check a plan against template capabilities
"""

from api.agent.tools.presentation.renderer import generate_presentation
from api.agent.tools.presentation.validator import validate_deck_plan

__all__ = ["generate_presentation", "validate_deck_plan"]
