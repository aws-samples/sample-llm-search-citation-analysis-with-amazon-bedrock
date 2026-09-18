# Design System

Visual language for the Citation Analysis dashboard. This document is the
source of truth for colours, typography, spacing, components, icons, and
the dark/light theming strategy. It exists so contributors can build new
UI without inventing styles, and so reviewers have a checklist for
catching anomalies.

> **Stack:** Tailwind CSS 3 (`darkMode: 'class'`), React 18, no icon
> library, no component library beyond AWS Amplify Authenticator. All
> primitives live under `web/src/components/ui/`.

---

## 1. Theming model

### 1.1 Strategy

The app is class-based: dark mode is enabled by adding the class `dark`
to `<html>`. Theme preference is managed by `useTheme` (`light` /
`dark` / `system`) and toggled via the `ThemeToggle` button.

There are two ways a Tailwind class can become "dark-mode aware":

1. **Explicit `dark:` variant** – e.g. `bg-white dark:bg-gray-800`.
   Used in layout chrome (sidebar, header, fallback error screens) and
   anywhere we deliberately need a different colour in dark mode.
2. **Global override** – common Tailwind classes (`bg-white`,
   `bg-gray-50`, `text-gray-900`, `border-gray-200`, …) are remapped
   inside `web/src/index.css` under the `.dark` selector. This means
   most components do not need `dark:` variants at all.

> **Rule of thumb:** if your class is in the global override list below,
> do not add a `dark:` variant; trust the override. Only reach for
> `dark:` when a component sits on a surface where the global override
> is wrong (e.g. always-dark error fallbacks, gradient backgrounds, the
> primary action rail in `main.tsx` and `TabContent.tsx`).

### 1.2 Globally overridden classes

Defined in `web/src/index.css`. Two groups: **neutral** and **accent**.

#### 1.2.1 Neutral scale

| Light class            | Dark replacement |
| ---------------------- | ---------------- |
| `bg-white`             | gray-800         |
| `bg-gray-50`           | gray-900         |
| `bg-gray-100`          | gray-700         |
| `bg-gray-200`          | gray-600         |
| `border-gray-200`      | gray-700         |
| `border-gray-100`      | gray-700         |
| `border-gray-300`      | gray-600         |
| `hover:border-gray-300`| gray-500         |
| `text-gray-900`        | gray-50          |
| `text-gray-700`        | gray-300         |
| `text-gray-600`        | gray-300         |
| `text-gray-500`        | gray-400         |
| `text-gray-400`        | gray-500         |
| `text-gray-300`        | gray-400         |
| `hover:bg-gray-50`     | gray-700         |
| `hover:bg-gray-100`    | gray-600         |
| `hover:bg-gray-200`    | gray-600         |
| `input/textarea/select` background, border, placeholder, focus ring | gray-700/-600/-400/-500 |

#### 1.2.2 Accent surfaces, text, and borders

The same global-override pattern is applied to every accent palette
the app uses. The principle is: tinted surfaces become **translucent
dark tints** and accent text shifts to the **`*-300` / `*-200`** shade
that is legible on dark.

| Light class                   | Dark behaviour |
| ----------------------------- | -------------- |
| `bg-{tone}-50`                | translucent dark tint (~25% alpha of `*-900`) |
| `bg-{tone}-100`               | translucent dark tint (~40% alpha of `*-900`) |
| `text-{tone}-700` / `-800`    | `*-300` (legible accent on dark) |
| `text-{tone}-900`             | `*-200` (highest emphasis accent) |
| `border-{tone}-100`           | translucent `*-800/-900` border (~40% alpha) |
| `border-{tone}-200`           | translucent `*-700/-800` border (~55% alpha) |
| `border-{tone}-300`           | translucent `*-600/-700` border (~70% alpha) |
| `hover:bg-{tone}-100/-200`    | denser translucent tint (50–70% alpha) |

Tones covered: `emerald`, `green`, `amber`, `yellow`, `violet`,
`purple`, `fuchsia`, `blue`, `indigo`, `sky`, `cyan`, `teal`, `red`,
`rose`, `orange`, `slate`. Alpha-modifier classes used in row
backgrounds (`bg-green-50/30`, `bg-emerald-50/50`, `bg-red-50/30`,
`bg-orange-50/30`) have their own matching dark-mode overrides.

> **What is NOT overridden:** saturated solid surfaces
> (`bg-{tone}-500/600/700`) and their `text-white` pairings. Those are
> primary-action buttons that work in both themes as-is.

Markdown prose styles (`.prose-markdown`) and AWS Amplify
Authenticator have their own dark overrides in the same file.

### 1.3 CSS variables

The body uses two semantic tokens that switch with the theme:

```css
:root        { --color-bg-primary: 249 250 251; --color-text-primary: 17 24 39;  }
.dark        { --color-bg-primary: 17 24 39;     --color-text-primary: 249 250 251; }
```

These are exposed as `bg-skin-primary` / `text-skin-primary` utilities
for the body element only. Component-level styling uses Tailwind colour
utilities directly, not these variables.

---

## 2. Colour palette

### 2.1 Neutral scale (primary surface system)

| Token           | Light      | Dark equivalent (via override) |
| --------------- | ---------- | ------------------------------ |
| Background      | `gray-50`  | `gray-900` |
| Surface         | `white`    | `gray-800` |
| Surface raised  | `gray-100` | `gray-700` |
| Border          | `gray-200` | `gray-700` |
| Text primary    | `gray-900` | `gray-50`  |
| Text secondary  | `gray-600` | `gray-300` |
| Text muted      | `gray-400` | `gray-500` |
| Action primary  | `gray-900` | (kept dark; see Buttons) |

### 2.2 Accent palette

Accents are used sparingly: navigation icon tints, stat card badges,
status pills, and feedback states. Each tone has a defined behaviour in
both themes.

| Tone    | Usage                            | Light surface        | Light text            | Dark surface (auto) | Dark text (auto) |
| ------- | -------------------------------- | -------------------- | --------------------- | ------------------- | ---------------- |
| Blue    | Searches, info, neutral metrics  | `bg-blue-50/100`     | `text-blue-700/800`   | translucent blue-900 | `blue-300`      |
| Indigo  | Visibility metrics               | `bg-indigo-50/100`   | `text-indigo-700/800` | translucent indigo-900 | `indigo-300`  |
| Violet  | Brand mentions                   | `bg-violet-50/100`   | `text-violet-700/800` | translucent violet-900 | `violet-300`  |
| Purple  | Citations                        | `bg-purple-50/100`   | `text-purple-700/800` | translucent purple-900 | `purple-300`  |
| Fuchsia | Prompt insights                  | `bg-fuchsia-50/100`  | `text-fuchsia-700/800` | translucent fuchsia-900 | `fuchsia-300` |
| Rose    | Citation gaps                    | `bg-rose-50/100`     | `text-rose-700/800`   | translucent rose-900 | `rose-300`     |
| Emerald | "Yours", success, crawled        | `bg-emerald-50/100`  | `text-emerald-700/800` | translucent emerald-900 | `emerald-300` |
| Green   | Success, positive                | `bg-green-50/100`    | `text-green-700/800`  | translucent green-900 | `green-300`    |
| Amber   | Warnings, competitors            | `bg-amber-50/100`    | `text-amber-700/800`  | translucent amber-900 | `amber-300`    |
| Yellow  | Medium priority                  | `bg-yellow-50/100`   | `text-yellow-700/800` | translucent yellow-900 | `yellow-300`  |
| Red     | Errors, destructive              | `bg-red-50/100`      | `text-red-700/800`    | translucent red-900 | `red-300`       |
| Sky     | Recent searches                  | `bg-sky-50/100`      | `text-sky-700/800`    | translucent sky-900 | `sky-300`       |
| Slate   | Raw responses, low emphasis      | `bg-slate-50/100`    | `text-slate-700/800`  | translucent slate-900 | `slate-300`   |
| Teal    | Content studio                   | `bg-teal-50/100`     | `text-teal-700/800`   | translucent teal-900 | `teal-300`     |
| Orange  | Schedule                         | `bg-orange-50/100`   | `text-orange-700/800` | translucent orange-900 | `orange-300` |

Pattern for badges and pills: `bg-{tone}-50 text-{tone}-700`
(`bg-{tone}-100` for stronger emphasis). Avoid mixing two accents in
the same component.

> Solid action buttons keep `bg-{tone}-600 text-white hover:bg-{tone}-700`
> in both themes. Those classes are intentionally NOT overridden.

### 2.3 Semantic state colours

| State    | Background     | Text          | Border         |
| -------- | -------------- | ------------- | -------------- |
| Success  | `bg-green-50`  | `text-green-700` | `border-green-200` |
| Warning  | `bg-yellow-50` | `text-yellow-800` | `border-yellow-200` |
| Error    | `bg-red-50`    | `text-red-700` | `border-red-200` |
| Info     | `bg-blue-50`   | `text-blue-700` | `border-blue-200` |

---

## 3. Typography

The app uses the system font stack inherited from Tailwind defaults.

| Role            | Class                                  |
| --------------- | -------------------------------------- |
| Page title (h2) | `text-2xl font-semibold text-gray-900` |
| Section title (h3) | `text-lg font-semibold text-gray-900` |
| Card label      | `text-sm font-medium text-gray-700`    |
| Body            | `text-sm text-gray-600`                |
| Helper / caption| `text-xs text-gray-400`                |
| Numeric stat    | `text-3xl font-semibold text-gray-900` |
| Section label   | `text-xs font-semibold uppercase tracking-wider text-gray-400` |

> Markdown prose (AI responses, content studio output) uses the
> `.prose-markdown` class which has its own typographic scale defined
> in `index.css`. Do not re-style markdown output; extend
> `.prose-markdown` instead.

---

## 4. Spacing and layout

- The grid uses Tailwind's default 4 px base.
- Standard card padding: `p-6` (24 px) on desktop, `p-4` on dense lists.
- Standard gap between cards: `gap-4` to `gap-6`.
- Section margin between blocks: `mb-6 sm:mb-8`.
- Sidebar width: `w-64` (256 px), top bar height: `h-16` (64 px).
- Page content max width is unconstrained – it fills the viewport
  minus the sidebar, so internal widgets must remain readable up to
  ultra-wide displays.

Border radius: `rounded-lg` (8 px) is the default for cards, inputs,
and buttons. Larger surfaces (icon badges, modals) use `rounded-xl`.
Pills use `rounded-full`.

Borders are 1 px (`border`) and use the neutral border tokens above.

---

## 5. Buttons

Use the `<Button>` component from `web/src/components/ui/Button.tsx`.
Do not hand-roll button class strings.

### 5.1 Variants

| Variant      | When to use | Visual |
| ------------ | ----------- | ------ |
| `primary`    | The main action of a page or form. Only **one** primary per visible group. | `bg-gray-900 text-white hover:bg-gray-800` |
| `secondary`  | Alternate actions of equal weight. | `bg-white text-gray-900 border border-gray-200 hover:bg-gray-50` |
| `ghost`      | Tertiary actions, cancel buttons, links inside dense rows. | `text-gray-600 hover:text-gray-900 hover:bg-gray-100` |
| `danger`     | Destructive primary actions inside confirmation dialogs. | `bg-red-600 text-white hover:bg-red-700` |
| `iconOnly`   | Square button hosting only an icon (toolbar / list-row actions). Always provide `aria-label`. | `text-gray-400 hover:text-gray-600 hover:bg-gray-100` |

### 5.2 Sizes

| Size | Height | When to use |
| ---- | ------ | ----------- |
| `sm` | ~32 px (`px-3 py-1.5`) | Inside dense rows, table cells, list-row actions. |
| `md` | ~36-40 px (`px-4 py-2`, default) | Standard page-level actions. |

### 5.3 Composition

Use `leadingIcon` / `trailingIcon` props instead of hand-placing icons:

```tsx
<Button
  leadingIcon={<PlusIcon className="w-4 h-4" />}
  onClick={() => setShowCreate(true)}
>
  New Persona
</Button>
```

Disabled state: pass `disabled`. The component applies `opacity-50` and
`cursor-not-allowed` automatically. For loading, swap children for a
loading label (`'Saving…'`) – do not introduce custom spinners on
primary buttons.

### 5.4 Dark-mode inversion

`primary` buttons rely on the global override system, so
`bg-gray-900 / hover:bg-gray-800` works in both themes. For buttons
that sit on always-dark surfaces in light mode (the app rail,
fallback error screens), set `invertOnDark` so the dark theme inverts
them to a light pill (`dark:bg-gray-100 dark:text-gray-900`).

```tsx
<Button invertOnDark onClick={reload}>Reload Page</Button>
```

### 5.5 Anti-patterns

- Inline `className="px-4 py-2 bg-gray-900 text-white …"` strings.
  Use `<Button>` so the design system stays consistent.
- Mixing sizes in the same row.
- More than one primary button visible at once.
- `iconOnly` button without `aria-label` / `title`.

---

## 6. Icons

### 6.1 Source and style

We ship our own icon set instead of pulling a library. Icons live in
`web/src/components/ui/Icons.tsx` and follow a single Heroicons-style
convention:

- 24 × 24 viewBox.
- Stroke only, `fill="none"`, `stroke="currentColor"`.
- `strokeLinecap="round"`, `strokeLinejoin="round"`,
  `strokeWidth={1.5}`.
- Default size `w-5 h-5` (20 px), sized via the `className` prop.
- Colour is inherited from `currentColor`, so place the icon inside an
  element whose `text-*` colour you want.

Available icons: `PauseIcon`, `PlayIcon`, `PencilIcon`, `TrashIcon`,
`PlusIcon`, `CloseIcon`, `ChevronRightIcon`, `ChevronDownIcon`,
`SearchIcon`, `LinkIcon`, `GlobeIcon`, `KeyIcon`, `WarningIcon`,
`CheckIcon`, `ArrowRightIcon`.

The sidebar (`Layout/Sidebar.tsx`) has a separate set of inline icons
(`DashboardIcon`, `BrandIcon`, `CitationsIcon`, …). They follow the
same convention; consolidating them into `Icons.tsx` is a future
refactor.

### 6.2 Adding a new icon

1. Pick or trace a Heroicons outline path.
2. Add a function component to `Icons.tsx` matching the existing
   pattern (props: `className`, `title`).
3. Re-export it from `components/ui/index.ts`.
4. Use it via `<MyIcon className="w-4 h-4" />`.

### 6.3 Sizing reference

| Context | Class |
| ------- | ----- |
| Inline with body text | `w-3 h-3` or `w-3.5 h-3.5` |
| Icon-only buttons     | `w-4 h-4` |
| Sidebar nav items     | `w-5 h-5` |
| Stat card badges      | `w-6 h-6` |
| Empty-state illustrations | `w-12 h-12` |

### 6.4 Accessibility

- Decorative icons need no label; the wrapping `<svg>` defaults to
  `aria-hidden`.
- When the icon is the only visible content (icon-only buttons,
  sidebar collapse, expand chevrons that double as the click
  target), the host element must carry `aria-label` and the icon's
  `title` prop should be set or the host element should have a
  `title` attribute.
- Use `aria-expanded` on disclosure buttons that toggle a chevron.

### 6.5 No emoji as UI

Emoji are not used as UI affordances anywhere. Reasons:

1. Inconsistent rendering across operating systems.
2. No way to recolour for dark mode or hover states.
3. Screen readers announce the unicode name, not the action.

The only places emoji appear are decorative content **inside** the
About section (`components/About/ArchitectureTab.tsx`,
`components/About/LicensesTab.tsx`) where they label conceptual
sections, not interactive controls. There is also a single
`✓` text suffix in `components/Brands/PromptEditor.tsx` inside a
native `<select>` `<option>` – browsers will not render React
components inside `<option>`, so a unicode glyph is the only viable
choice there. Treat that as the ceiling for emoji / unicode-glyph
usage.

---

## 7. Components inventory

### 7.1 Pages and theme support

Every route in `App.tsx` is listed below with its primary components
and the light / dark mode coverage status. "✓ auto" means the page
relies entirely on the global overrides described in §1.2 — no
component-level `dark:` variants are needed and the page renders
correctly in both themes.

| # | Route | Page label | Primary components | Theme support |
| - | ----- | ---------- | ------------------ | ------------- |
| 1 | `/` | Dashboard | `Layout/TabContent`, `Dashboard/StatCard`, `Dashboard/ProviderChart`, `Dashboard/BrandChart`, `Tables/TopCitationsTable`, `Tables/RecentSearchesTable` | ✓ auto |
| 2 | `/visibility` | Visibility | `Visibility/VisibilityDashboard`, `GroupOverview`, `VisibilityComponents`, `PersonaComparisonChart`, `ui/KeywordScopeSelector`, `shared/PersonaSelector` | ✓ auto |
| 3 | `/brands` | Brand Mentions | `Brands/BrandsView`, `BrandConfigContent`, `BrandConfigPanel`, `BrandTagList`, `DomainList`, `IndustrySelector`, `ExtractionOptions`, `BrandExpansionPanel`, `CompetitorDiscoveryPanel`, `FirstPartyBrandsSection`, `CompetitorBrandsSection`, `BrandMentionsTable`, `BrandOverviewTab`, `BrandDetailModal`, `ProviderResponseCard`, `PromptEditor` | ✓ auto (was the green-everywhere bug) |
| 4 | `/citations` | Citations | `Citations/CitationsView`, `CitationFilters`, `CitationRow`, `CitationTableHeader`, `CitationDetailModal`, `CrawlHistory`, `PaginationControls` | ✓ auto |
| 5 | `/prompt-insights` | Prompt Insights | `Insights/PromptInsights`, `PromptCard` | ✓ auto |
| 6 | `/citation-gaps` | Citation Gaps | `Insights/CitationGaps`, `GapCard` | ✓ auto |
| 7 | `/recommendations` | Action Center | `Insights/Recommendations` | ✓ auto |
| 8 | `/keyword-research` | Keyword Research | `KeywordResearch/KeywordResearchView`, `KeywordExpansion`, `CompetitorAnalysis`, `CompetitorAnalysisComponents`, `ResearchProgress`, `ResearchHistory`, `KeywordResultsTable` (Excel export) | ✓ auto |
| 9 | `/content-studio` | Content Studio | `ContentStudio/ContentStudioView`, `ContentGenerator`, `ContentHistory`, `ContentDetailModal`, `ContentIdeaCard`, `HistoryListItem`, `SelfReflection/SelfReflectionPanel` | ✓ auto |
| 10 | `/searches` | Recent Searches | `Searches/SearchesView`, `SearchesViewComponents` | ✓ auto |
| 11 | `/raw-responses` | Raw Responses | `RawResponses/RawResponsesExplorer`, `Breadcrumb`, `FileViewer`, `ImageViewer` | ✓ auto |
| 12 | `/execution` | Run Analysis | `Execution/ExecutionMonitor`, `ExecutionStatus`, `ExecutionMonitorComponents`, `TriggerSection` | ✓ auto |
| 13 | `/schedule` | Schedule | `Schedule/ScheduleManager`, `ScheduleForm`, `ScheduleManagerComponents` | ✓ auto |
| 14 | `/settings` | Settings | `Settings/SettingsView`, `UsersConfig`, `UserModals`, `QueryPromptsManager` | ✓ auto |

Modals and chrome:

| Component | Coverage |
| --------- | -------- |
| `Layout/Sidebar` | explicit `dark:` variants (always-dark navigation rail) |
| `App` header (sign out, about, theme toggle) | explicit `dark:` variants |
| `ui/Modal` / `ConfirmModal` / `AlertModal` | explicit `dark:` variants on overlay + content |
| `ui/Spinner` | `currentColor` – inherits theme |
| `ui/ThemeToggle` | explicit `dark:` variants |
| `ui/Button` | global override; `invertOnDark` flag for always-dark surfaces |
| `About/AboutModal` and tabs | explicit `dark:` variants |
| `ErrorBoundary` / `ErrorDisplay` | explicit `dark:` variants on always-dark fallback |
| `main.tsx` `RootErrorFallback` | explicit `dark:` variants |

> "✓ auto" pages do not need `dark:` variants on accent classes because
> the global overrides handle them. If a page in the table changes its
> mind and starts using a class that is **not** in §1.2, add the
> override to `index.css` rather than sprinkling `dark:` variants
> across components.

### 7.2 Primitives (`components/ui/`)

| Component       | Purpose |
| --------------- | ------- |
| `Button`        | Canonical button. Variants + sizes. Use everywhere. |
| `Modal`, `ConfirmModal`, `AlertModal` | Overlays with focus trap and escape handling. |
| `Spinner`       | Loading indicator (`sm`/`md`/`lg`). |
| `ThemeToggle`   | Light / dark / system theme switcher. |
| `Icons.tsx`     | Shared SVG icon set. |
| `chartTheme.ts` | `getChartTheme(isDark)` returns axis tick / grid / tooltip colours for Chart.js so canvases adapt to the theme. |
| `MarkdownProcessor` | Helpers for rendering AI markdown safely. |

### 7.3 Layout

`components/Layout/Sidebar.tsx` is the only navigation chrome. It owns
nav sections, badges, and the "running" pulse indicator. New top-level
features should be added there as a new entry, not as a new chrome
component.

### 7.4 Feature components

Organised by feature folder under `components/<Feature>`. Each feature
folder has an `index.ts` that re-exports its public surface. Internal
components keep `*.spec.tsx` next to the file. See
`.kiro/steering/structure.md` for the layout map.

### 7.5 Charts

The app uses Chart.js (via `react-chartjs-2` for declarative usage and
the imperative `Chart` constructor for the dashboard charts). Canvases
do **not** participate in the global CSS override system, so chart
chrome (axis ticks, grid, legend, tooltip) needs explicit theme-aware
colours.

Use the shared `getChartTheme(isDark)` helper from
`components/ui/chartTheme.ts` together with the `useTheme` hook:

```tsx
import { useTheme } from '../../hooks/useTheme';
import { getChartTheme } from '../ui/chartTheme';

export function MyChart() {
  const { isDark } = useTheme();
  const theme = getChartTheme(isDark);

  const options = {
    plugins: {
      legend: { labels: { color: theme.textColor } },
      tooltip: {
        backgroundColor: theme.tooltipBackground,
        borderColor: theme.tooltipBorder,
        titleColor: theme.tooltipText,
        bodyColor: theme.tooltipText,
      },
    },
    scales: {
      x: { ticks: { color: theme.textColor }, grid: { color: theme.gridColor } },
      y: { ticks: { color: theme.textColor }, grid: { color: theme.gridColor } },
    },
  };
  // ...
}
```

For imperative `new Chart(ctx, …)` usage, include `isDark` in the
`useEffect` dependency array so the chart re-renders when the user
toggles the theme.

Dataset colours (the actual bars / slices / lines) follow these
conventions:

- **Saturated branded palettes** (e.g. `rgba(168, 85, 247, 0.5)` for
  Claude) stay fixed across themes – they are saturated enough to read
  on both backgrounds.
- **Neutral data series** (e.g. the brand mentions doughnut whose
  first slices are `gray-900` / `gray-700`) need a light- and
  dark-mode palette. See `Dashboard/BrandChart.tsx` for the pattern.

### 7.6 Images

User-content images (website screenshots from the crawler, raw S3
images) usually carry their own bright white-themed backgrounds.
Without treatment they appear as harsh white slabs on the dark
surface, even when the surrounding panel is correctly tinted.

Apply the standard dim filter to `<img>` tags that render arbitrary
captured content:

```tsx
<img
  src={screenshotUrl}
  alt="Screenshot of the cited page"
  className="w-full border border-gray-300 rounded shadow-lg dark:brightness-90 dark:contrast-95"
/>
```

`dark:brightness-90 dark:contrast-95` takes the edge off harsh whites
without distorting brand colours in the screenshot. Apply it to:

- `Citations/CitationDetailModal.tsx` – cited-page screenshots.
- `Citations/CrawlHistory.tsx` – historical crawl screenshots.
- `RawResponses/ImageViewer.tsx` – raw image objects in S3.

Do NOT apply the filter to:

- **Profile photos** of real people (e.g. the AboutTab portraits).
  They are photos, not UI surfaces, and dimming looks unnatural.
- **Logos / favicons** (`web/public/assets/favicon.ico`,
  `Layout/Sidebar` brand mark). These already invert via Tailwind
  classes (`bg-gray-900 dark:bg-white`).
- **Decorative icons** – use the SVG icon set in
  `components/ui/Icons.tsx` instead.

---

## 8. Forms

- Wrap form fields in `<form>` and submit via a `primary` button.
- Labels: `block text-sm font-medium text-gray-700 mb-1` paired via
  `htmlFor` / `id`.
- Inputs / textareas / selects: `w-full p-2 border border-gray-200
  rounded-lg text-sm focus:ring-2 focus:ring-gray-900`. Dark-mode
  styling is applied globally.
- Helper text under inputs: `text-xs text-gray-400 mt-1`.
- Validation errors: `text-xs text-red-600 mt-1`.
- Cancel buttons live to the right of the submit button and use the
  `ghost` variant.

---

## 9. Tables

- Header row: `bg-gray-50` background, `text-xs font-medium uppercase
  tracking-wider text-gray-500`.
- Cell padding: `px-6 py-4`.
- Row separators: `divide-y divide-gray-200`.
- Sortable columns use a chevron icon next to the label and toggle
  `aria-sort`.
- Expandable rows use `ChevronRightIcon` (collapsed) and
  `ChevronDownIcon` (expanded), wrapped in a button with
  `aria-expanded`.

---

## 10. Favicon and identity

- App favicon: `web/public/assets/favicon.ico` (32×32 ICO).
- App name: "Citation Analysis Dashboard" (`web/index.html` `<title>`).
- Logo mark in sidebar: an inline bar-chart SVG inside an
  `bg-gray-900 dark:bg-white` rounded square (32×32). The fill colour
  inverts so the mark stays high-contrast in both themes.
- Profile portraits in the About tab (`web/public/assets/*.jpg`) are
  photos and intentionally render unchanged in both themes – the
  surrounding panel adapts via the global override.

If a new favicon is needed, replace `favicon.ico` and add modern
formats (`favicon.svg`, `apple-touch-icon.png`) referenced from
`web/index.html`. Keep the silhouette legible at 16×16.

For user-content images (screenshots, captured assets) see
§7.6 Images for the dimming pattern.

---

## 11. Anomaly checklist

Use this list during code review of any UI change. Every item is a
real anomaly that has been fixed in the codebase – don't reintroduce
them.

- [ ] No emoji as a button label or interactive icon. Use icons from
      `components/ui/Icons.tsx`.
- [ ] No unicode arrows (`▲▼◀▶`) for expand/collapse. Use
      `ChevronDownIcon` / `ChevronRightIcon`, with `aria-expanded` on
      the button.
- [ ] No hand-rolled `className="px-4 py-2 bg-gray-900 …"` button
      strings. Use `<Button>`.
- [ ] No icon-only button missing `aria-label` / `title`.
- [ ] No hard-coded hex colours. Use Tailwind tokens.
- [ ] No mixed sizes in the same button group / list row.
- [ ] No new `dark:` variants for classes already covered by the
      global override – this includes neutrals (`bg-white`,
      `text-gray-900`, …) **and accent tones** (`bg-emerald-50`,
      `text-amber-800`, `border-blue-200`, …). If you find yourself
      writing `dark:bg-emerald-900/20` or similar, add the override to
      `index.css` instead so every accent surface gets it.
- [ ] No accent surface inside an always-dark area without checking
      that the global override matches the intent (e.g. status pills
      inside the dark sidebar – those already have explicit `dark:`
      treatment).
- [ ] No `dark:` variants forgotten on always-dark surfaces (app rail,
      fallback error screens, header chrome, modals).
- [ ] No emoji-as-key prop signatures (e.g. `icon: '🔍'` mapping into
      a switch). Take a `ReactNode` icon component instead.
- [ ] All new icons follow the stroke convention: 24 × 24 viewBox,
      `currentColor`, `strokeWidth={1.5}`.
- [ ] No primary button without `transition-colors` (provided by
      `<Button>` automatically).
- [ ] No two primary buttons in the same visible group.

### 11.1 Recently fixed anomalies (May 2026)

For reference – these were the anomalies discovered during the
design-system pass:

| Component | Issue | Fix |
| --------- | ----- | --- |
| `Settings/QueryPromptsManager.tsx` | Emoji icons (`⏸▶✏️🗑`) on action buttons; non-canonical button styling for "+ New Persona". | Replaced with `PauseIcon`/`PlayIcon`/`PencilIcon`/`TrashIcon`. Buttons migrated to `<Button>` primary/ghost/iconOnly variants. |
| `Dashboard/StatCard.tsx` | `icon` prop typed as a `string` (emoji) and used as a key into an SVG lookup map – unrelated emoji silently fell back to a literal emoji render. | Refactored to take a `ReactNode` icon directly plus a `tone` prop (blue/violet/emerald/amber/gray). Call site `Layout/TabContent.tsx` updated to pass `SearchIcon`/`LinkIcon`/`GlobeIcon`/`KeyIcon`. |
| `Tables/TopCitationsTable.tsx`, `Keywords/KeywordDetailComponents.tsx`, `Brands/ProviderResponseCard.tsx` | Unicode `▲▼▶` for expand/collapse. | Replaced with `ChevronDownIcon` / `ChevronRightIcon`, plus `aria-expanded` and `aria-label` on the controls. |
| `Brands/BrandExpansionPanel.tsx` | `⚠️` emoji on duplicate-warning text. | Replaced with `WarningIcon`. |
| `Brands/BrandMentionsTable.tsx` | `→` text arrow inside "View Details" button. | Replaced with `ArrowRightIcon` trailing the label. |
| `Brands/CompetitorDiscoveryPanel.tsx` | `✓` text suffix on already-added competitor pills. | Replaced with `CheckIcon` rendered conditionally with `title="Already added"`. |
| `Brands/ProviderResponseCard.tsx` | `🌍 Geographic Analysis` emoji prefix on a section header. | Removed; section title now reads "Geographic Analysis". |
| `Keywords/KeywordDetailComponents.tsx` | `✕ Close` unicode multiplication-sign in the close button. | Replaced with `CloseIcon` leading the label. |
| **All accent-tinted surfaces (48 files, ~349 occurrences)** | Pages using `bg-{tone}-50/100`, `text-{tone}-700/800`, `border-{tone}-100/200/300` rendered as bright pale-tinted panels in dark mode. Most visible on `Settings > Brand Tracking`, where the stacked emerald + amber + violet panels turned the whole page green/yellow on a dark background. | Extended the `index.css` global override system to cover every accent tone: tinted surfaces become translucent dark tints, accent text shifts to `*-300/-200`, accent borders become muted translucent equivalents. Zero call-site changes – fixes all 48 files at once and any future accent surface gets the right behaviour automatically. |
| **Chart.js canvases** (`Dashboard/ProviderChart`, `Dashboard/BrandChart`, `Visibility/PersonaComparisonChart`, `Keywords/KeywordDetail*`) | Canvases sit outside Tailwind's CSS so the global overrides do not reach them. Axis tick text, grid lines, legend, tooltip, and the neutral doughnut palette stayed in light-mode colours on dark, leaving labels invisible and the BrandChart's `gray-900` slice merging into the dark page. Charts also did not re-render when the user toggled the theme. | Added shared `components/ui/chartTheme.ts` (`getChartTheme(isDark)`) that returns axis tick / grid / tooltip colours per theme, wired all 4 chart components to call it via `useTheme()`, added `isDark` to the imperative chart `useEffect` deps so they re-render on theme toggle, and split out a per-mode dataset palette in `BrandChart`. Extracted `KeywordDetail` chart options into a sibling `KeywordDetailChartOptions.ts` to keep the components file under the 400-line cap. Test setup gained a `window.matchMedia` polyfill so components consuming `useTheme()` render in jsdom. |
| **User-content images** (`Citations/CitationDetailModal`, `Citations/CrawlHistory`, `RawResponses/ImageViewer`) | Cited-page screenshots and raw S3 image objects carry their own bright white-themed backgrounds, so even with the surrounding panel correctly tinted dark they still appeared as harsh white slabs. | Added `dark:brightness-90 dark:contrast-95` to `<img>` tags rendering arbitrary captured content. Profile photos (About tab) and the inverting brand mark (sidebar) intentionally do **not** receive the filter – the rule only applies to user-supplied screenshots. Documented in design-system §7.6 Images. |

---

## 12. Where to put new design system code

```
web/src/components/ui/
├── Button.tsx          # button variants + sizes
├── Icons.tsx           # shared icon set
├── Modal.tsx           # overlays
├── Spinner.tsx         # loading
├── ThemeToggle.tsx     # theme switcher
├── MarkdownProcessor.tsx
└── index.ts            # public re-exports
```

When in doubt, add the primitive here and re-export it from
`index.ts`. Feature folders should consume primitives, not redefine
them.
