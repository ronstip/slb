# Dashboard Feature

Dynamic, user-configurable dashboard for visualizing social listening data.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  3 Rendering Contexts                   │
├──────────────────┬──────────────────┬───────────────────┤
│  Studio Panel    │  Fullscreen      │  Shared (Public)  │
│  (right sidebar) │  /artifact/:id   │  /shared/:token   │
├──────────────────┴──────────────────┴───────────────────┤
│                    DashboardView                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Toolbar (edit/done, data, share, PDF)            │   │
│  │ DashboardFilterBar (sentiment, emotion, etc.)    │   │
│  │ SocialDashboardView (grid + widget config)       │   │
│  │   ├─ SocialDashboardGrid (react-grid-layout)     │   │
│  │   │   └─ SocialWidgetRenderer × N                │   │
│  │   │       ├─ SocialKpiCard                       │   │
│  │   │       ├─ SocialChartWidget (Chart.js)        │   │
│  │   │       ├─ SocialWordCloudWidget               │   │
│  │   │       ├─ SocialTableWidget                   │   │
│  │   │       └─ SocialProgressListWidget            │   │
│  │   └─ SocialWidgetConfigDialog                    │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `DashboardView.tsx` | Top-level wrapper: data fetching, filters, toolbar |
| `SocialDashboardView.tsx` | Grid layout, widget CRUD, auto-save |
| `SocialDashboardGrid.tsx` | react-grid-layout wrapper |
| `SocialWidgetRenderer.tsx` | Dispatches to correct widget component |
| `SocialWidgetConfigDialog.tsx` | Add/edit widget dialog with live preview |
| `types-social-dashboard.ts` | Core types: `SocialDashboardWidget`, `CustomChartConfig` |
| `defaults-social-dashboard.ts` | Default layout (KPIs, charts, tables) |
| `social-dashboard-store.ts` | Zustand store (edit mode, dialog state) |
| `dashboard-aggregations.ts` | Data aggregation functions per widget type |
| `DashboardFilterBar.tsx` | Global filter bar (configurable pills) |
| `exportDashboardPdf.ts` | PDF export via html2canvas |
| `ShareDashboardDialog.tsx` | Share link generation |

## Data Flow

```
API (/dashboard/data) → allPosts
  → useDashboardFilters() → filteredPosts (global filters)
    → SocialDashboardGrid → SocialWidgetRenderer
      → applyWidgetFilters() → per-widget filtered posts
        → dashboard-aggregations.ts → WidgetData
          → Chart.js / KPI card / Table / Word cloud
```

## Layout Persistence

- Layouts saved to Firestore `dashboard_layouts` collection (keyed by artifactId)
- `useDashboardLayout` hook (TanStack Query) loads on mount
- Auto-saves on edit with 800ms debounce
- Falls back to `getDefaultLayout()` if no saved layout exists

## Widget System

Each widget is a `SocialDashboardWidget` with:
- **Grid position:** `x, y, w, h` (12-column grid)
- **Aggregation:** preset (`sentiment`, `volume`, etc.) or `custom`
- **Chart type:** `bar | line | pie | doughnut | number-card | word-cloud | table | progress-list`
- **Custom config:** dimension (groupBy) + metric + aggregation (sum/avg) + time bucket
- **Per-widget filters:** applied on top of global filters
- **Accent color:** optional custom color

Presets are auto-converted to `custom` config when opening the config dialog (`presetToCustomConfig`).

## Widget Config Dialog

- Split layout: 55% config (left) | 45% live preview (right)
- Tabs: Data (title, description, groupBy, metric) | Filters | Style
- Chart type selector above tabs
- Draggable header
- Supports both `add` and `edit` modes

## AI Agent Integration (Future)

Widget configs are structured JSON — ideal for AI agent tool calls:
- Agent can generate `SocialDashboardWidget[]` from natural language
- Each widget config maps directly to visual output
- Layout coordinates can be auto-computed (y=Infinity for bottom placement)
- The `CustomChartConfig` type defines the exact schema an agent needs:
  `{ dimension, metric, metricAgg, timeBucket }`
