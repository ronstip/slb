"""Chart component — renders a chart at placeholder bounds."""

import logging
from typing import Optional

from lxml import etree
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.oxml.ns import qn

from api.agent.tools.presentation.theme import TemplateTheme

logger = logging.getLogger(__name__)

_CHART_TYPE_MAP = {
    "bar": XL_CHART_TYPE.BAR_CLUSTERED,
    "pie": XL_CHART_TYPE.PIE,
    "line": XL_CHART_TYPE.LINE,
}


def fill_chart(
    slide,
    placeholder,
    spec: dict,
    theme: TemplateTheme,
) -> None:
    """Render a chart at the placeholder's bounds, then remove the placeholder.

    Args:
        slide: The pptx slide object.
        placeholder: The OBJECT placeholder whose bounds define chart position.
        spec: Chart component spec with chart_type, labels, values.
        theme: The active template theme.
    """
    chart_type_str = spec.get("chart_type", "bar")
    xl_type = _CHART_TYPE_MAP.get(chart_type_str, XL_CHART_TYPE.BAR_CLUSTERED)

    labels = [str(l) for l in spec.get("labels", [])]
    values = [float(v) if v is not None else 0 for v in spec.get("values", [])]
    series_name = spec.get("series_name", "")

    if not labels or not values or len(labels) != len(values):
        logger.warning("fill_chart: invalid data shape, skipping")
        return

    # Build chart data
    cd = CategoryChartData()
    cd.categories = labels
    cd.add_series(series_name, values)

    # Add chart at placeholder bounds
    left, top, width, height = placeholder.left, placeholder.top, placeholder.width, placeholder.height
    chart_shape = slide.shapes.add_chart(xl_type, left, top, width, height, cd)

    # Remove the original placeholder element
    try:
        ph_el = placeholder._element
        ph_el.getparent().remove(ph_el)
    except Exception as e:
        logger.debug("fill_chart: could not remove placeholder element: %s", e)

    # Style the chart
    _apply_chart_style(chart_shape.chart, theme)


def _apply_chart_style(chart, theme: TemplateTheme) -> None:
    """Apply theme-aware styling to a chart."""
    _remove_chart_bg(chart)
    _color_chart_series(chart, theme.chart_palette)
    _style_chart_axes(chart, theme)
    _style_chart_legend(chart, theme)


def _remove_chart_bg(chart) -> None:
    """Force transparent fill on chart space and plot area."""
    try:
        def _no_fill(parent, sp_pr_tag: str):
            sp_pr = parent.find(qn(sp_pr_tag))
            if sp_pr is None:
                sp_pr = etree.SubElement(parent, qn(sp_pr_tag))
            for tag in ("a:noFill", "a:solidFill", "a:gradFill", "a:pattFill"):
                el = sp_pr.find(qn(tag))
                if el is not None:
                    sp_pr.remove(el)
            sp_pr.insert(0, etree.Element(qn("a:noFill")))

        _no_fill(chart._element, "c:spPr")
        c_chart = chart._element.find(qn("c:chart"))
        if c_chart is not None:
            pa = c_chart.find(qn("c:plotArea"))
            if pa is not None:
                _no_fill(pa, "c:spPr")
    except Exception as e:
        logger.debug("Chart bg removal failed: %s", e)


def _rgbcolor_to_hex(c: RGBColor) -> str:
    """Convert RGBColor to 6-char hex string for XML."""
    return str(c).replace("#", "")


def _style_chart_axes(chart, theme: TemplateTheme) -> None:
    """Muted axis labels + light gridlines."""
    try:
        label_hex = _rgbcolor_to_hex(theme.muted)
        grid_hex = _rgbcolor_to_hex(theme.border)

        c_chart = chart._element.find(qn("c:chart"))
        if c_chart is None:
            return
        pa = c_chart.find(qn("c:plotArea"))
        if pa is None:
            return

        for ax_tag in ("c:valAx", "c:catAx", "c:dateAx", "c:serAx"):
            for ax in pa.findall(qn(ax_tag)):
                # Label color
                tx_pr = ax.find(qn("c:txPr"))
                if tx_pr is None:
                    tx_pr = etree.SubElement(ax, qn("c:txPr"))
                    etree.SubElement(tx_pr, qn("a:bodyPr"))
                    etree.SubElement(tx_pr, qn("a:lstStyle"))
                p = tx_pr.find(qn("a:p"))
                if p is None:
                    p = etree.SubElement(tx_pr, qn("a:p"))
                r = p.find(qn("a:r"))
                if r is None:
                    r = etree.SubElement(p, qn("a:r"))
                rpr = r.find(qn("a:rPr"))
                if rpr is None:
                    rpr = etree.SubElement(r, qn("a:rPr"))
                rpr.set("sz", "800")
                for sf in rpr.findall(qn("a:solidFill")):
                    rpr.remove(sf)
                sf = etree.SubElement(rpr, qn("a:solidFill"))
                etree.SubElement(sf, qn("a:srgbClr")).set("val", label_hex)

                # Gridlines
                for gl in ax.findall(qn("c:majorGridlines")):
                    sp = gl.find(qn("c:spPr"))
                    if sp is None:
                        sp = etree.SubElement(gl, qn("c:spPr"))
                    ln = sp.find(qn("a:ln"))
                    if ln is None:
                        ln = etree.SubElement(sp, qn("a:ln"))
                    for sf2 in ln.findall(qn("a:solidFill")):
                        ln.remove(sf2)
                    sf2 = etree.SubElement(ln, qn("a:solidFill"))
                    etree.SubElement(sf2, qn("a:srgbClr")).set("val", grid_hex)

                # Axis line — invisible
                ax_sp = ax.find(qn("c:spPr"))
                if ax_sp is None:
                    ax_sp = etree.SubElement(ax, qn("c:spPr"))
                ax_ln = ax_sp.find(qn("a:ln"))
                if ax_ln is None:
                    ax_ln = etree.SubElement(ax_sp, qn("a:ln"))
                if ax_ln.find(qn("a:noFill")) is None and ax_ln.find(qn("a:solidFill")) is None:
                    etree.SubElement(ax_ln, qn("a:noFill"))
    except Exception as e:
        logger.debug("Axis styling failed: %s", e)


def _color_chart_series(chart, palette: list[RGBColor]) -> None:
    """Apply theme palette colors to chart series/points."""
    try:
        plot = chart.plots[0]
        # Pie/doughnut: color individual points
        if hasattr(plot, "series") and plot.series:
            try:
                for i, point in enumerate(plot.series[0].points):
                    point.format.fill.solid()
                    point.format.fill.fore_color.rgb = palette[i % len(palette)]
                return
            except Exception:
                pass
        for i, series in enumerate(chart.series):
            c = palette[i % len(palette)]
            try:
                series.format.fill.solid()
                series.format.fill.fore_color.rgb = c
            except Exception:
                pass
            try:
                series.format.line.color.rgb = c
            except Exception:
                pass
    except Exception as e:
        logger.debug("Chart color failed: %s", e)


def _style_chart_legend(chart, theme: TemplateTheme) -> None:
    """Style the chart legend with muted text."""
    try:
        chart.has_legend = True
        chart.legend.position = 2  # BOTTOM
        chart.legend.include_in_layout = False
        legend_hex = _rgbcolor_to_hex(theme.muted)

        leg = chart.legend._element
        tx_pr = leg.find(qn("c:txPr"))
        if tx_pr is None:
            tx_pr = etree.SubElement(leg, qn("c:txPr"))
            etree.SubElement(tx_pr, qn("a:bodyPr"))
            etree.SubElement(tx_pr, qn("a:lstStyle"))
        p = tx_pr.find(qn("a:p"))
        if p is None:
            p = etree.SubElement(tx_pr, qn("a:p"))
        r = p.find(qn("a:r"))
        if r is None:
            r = etree.SubElement(p, qn("a:r"))
        rpr = r.find(qn("a:rPr"))
        if rpr is None:
            rpr = etree.SubElement(r, qn("a:rPr"))
        rpr.set("sz", "900")
        for sf in rpr.findall(qn("a:solidFill")):
            rpr.remove(sf)
        sf = etree.SubElement(rpr, qn("a:solidFill"))
        etree.SubElement(sf, qn("a:srgbClr")).set("val", legend_hex)
    except Exception:
        pass
