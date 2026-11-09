# Design System

Visual language for the Citation Analysis dashboard: colours, typography,
spacing, components, icons, charts, print output and dark/light theming. Use
it to build new UI without inventing styles, and as a review checklist.

> **Stack:** Tailwind CSS 3 (`darkMode: 'class'`), React 18, no icon
> library, no component library beyond the AWS Amplify `Authenticator`.
> Generic primitives live in `web/src/components/ui/`; report building blocks
> live in `components/Reports/layout/` and `components/Reports/charts/`.

---

## 1. Theming model

### 1.1 Strategy

Dark mode is class-based: `useTheme` (`hooks/useTheme.ts`) adds `dark` to
`<html>`. It returns `{ theme, setTheme, toggleTheme, isDark }`; `theme` is
`light`, `dark` or `system` (the default), persisted in `localStorage`
under `theme`. `ThemeToggle` in the header cycles light → dark → system.

A Tailwind class becomes dark-mode aware in one of two ways:

1. **Global override** – common classes (`bg-white`, `bg-gray-50`,
   `text-gray-900`, `border-gray-200`, accent tints, …) are remapped in
   `web/src/index.css` under the `.dark` selector, so most components need
   no `dark:` variants.
2. **Explicit `dark:` variant** – e.g. `bg-white dark:bg-gray-800`. Used in
   app chrome (sidebar, header, login and loading screens, modals, root
   error fallback) and wherever the override gives the wrong result, such as
   the sidebar logo mark and other fixed-contrast surfaces.

> **Cascade:** Tailwind emits variant classes (`dark:`, `hover:`,
> `focus:`, `disabled:`) after the overrides in `index.css`, at the same
> specificity, so an explicit `dark:` variant wins over a global override.
> Plain utilities come before the overrides, so the override wins over them.

> **Rule of thumb:** if a class is covered by §1.2, do not add a `dark:`
> variant. If a class you need is not covered, add the override to
> `index.css` rather than sprinkling `dark:` variants across components.

### 1.2 Globally overridden classes

#### 1.2.1 Neutral scale

| Light class            | Dark replacement |
| ---------------------- | ---------------- |
| `bg-white`             | gray-800         |
| `bg-gray-50`           | gray-900         |
| `bg-gray-100`          | gray-700         |
| `bg-gray-200`          | gray-600         |
| `border-gray-100` / `-200` | gray-700     |
| `border-gray-300`      | gray-600         |
| `hover:border-gray-300`| gray-500         |
| `text-gray-900`        | gray-50          |
| `text-gray-700` / `-600` | gray-300       |
| `text-gray-500`        | gray-400         |
| `text-gray-400`        | gray-500         |
| `text-gray-300`        | gray-400         |
| `hover:bg-gray-50`     | gray-700         |
| `hover:bg-gray-100` / `-200` | gray-600   |
| `input` (except checkbox/radio), `textarea`, `select` | background gray-700, border gray-600, text gray-100, placeholder gray-400, focus ring and border gray-500 |
| disabled `input`, `textarea`, `select` | background gray-800, text gray-400 |
| `text-gray-800`        | gray-200         |
| `hover:text-gray-900` / `-800` | gray-50  |
| `hover:text-gray-700` / `-600` | gray-200 |
| `divide-gray-100` / `-200` | gray-700     |
| `bg-gray-900 text-white` (primary buttons, selected toggles) | white background, gray-900 text; `hover:bg-gray-800` → gray-100. Skipped when the element sets its own `dark:bg-*`, and while disabled when it sets `disabled:bg-*` |
| `text-white disabled:bg-gray-300` (disabled) | gray-600 background, gray-300 text |

#### 1.2.2 Accent surfaces, text and borders

Only the palette roles of §2.2 have dark overrides: tinted surfaces become
translucent tints of the tone's `*-900`, and accent text lifts to `*-300`
(`*-400` for `-600` text, `*-200` for `-900` text).

| Tone | `bg-` | `text-` | `border-` | `hover:bg-` | `hover:text-` |
| ---- | ----- | ------- | --------- | ----------- | ------------- |
| blue    | 50, 100 | 600, 700, 800, 900 | 200 | 100 | 800 |
| violet  | 50, 100 | 700, 800, 900 | 100, 200, 300 | – | 800 |
| red     | 50, 100, 50/30 | 600, 700, 800 | 200, 300 | 50, 100 | 600, 700 |
| amber   | – | 600, 700, 800, 900 | – | – | 900 |
| emerald | – | 600, 700, 800, 900 | – | – | – |

Other tones have no overrides. Rules in `index.css` ship whether or not a
component uses the class, so add one only for a class in use.

> **Not overridden:** saturated solid surfaces (`bg-{tone}-500/600/700`)
> and their `text-white` pairings. They work in both themes as-is.

Markdown prose (`.prose-markdown`) and the Amplify `Authenticator` have
their own dark overrides in the same file.

### 1.3 CSS variables

The body uses two semantic tokens that switch with the theme:

```css
:root        { --color-bg-primary: 249 250 251; --color-text-primary: 17 24 39;  }
.dark        { --color-bg-primary: 17 24 39;     --color-text-primary: 249 250 251; }
```

`index.css` exposes them as `bg-skin-primary` / `text-skin-primary`, applied
to `body` only. Components use Tailwind colour utilities directly.

### 1.4 Print

Every page can be printed to PDF. `PrintToPdfButton` (header) opens the
current URL with `?print=1` in a new tab; `usePrintMode` then adds
`print-mode` to the app root, hides the sidebar, the provider banner and
the onboarding modal, reduces the header to the page title and a
timestamp, and opens the print dialog once the data is ready. Reports decide readiness themselves (`Reports/layout/useReportReady.ts`).

- Hide screen-only controls with `print-hidden` (or
  `data-print-hidden="true"`).
- Reference content that would crowd the screen (the KPI definitions at the
  end of every report and of the Visibility page) goes in `ui/Disclosure`:
  collapsed on screen, always open in print and `?print=1` (`print-reveal`).
- Keep a card or chart on one page with `avoid-break-inside`; start a
  section on a new page with `page-break-before`.
- Print output is always light. `useTheme` renders a `?print=1` tab in the
  light theme (class and chart palette) whatever the saved theme, and drops
  the `dark` class between `beforeprint` and `afterprint` when a dark page is
  printed directly.
- Print output has a white background and black text, keeps
  background colours (`print-color-adjust: exact`) and makes `sticky`
  elements static.

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
| Text muted      | `gray-500` | `gray-400` |

`text-gray-400` is for decoration only (dividers, disabled controls): it is
2.6:1 on white, below the 4.5:1 that text needs. Captions, helper text and
icon buttons use `text-gray-500` (4.8:1 on white, about 5:1 on gray-800 in dark).
| Action primary  | `gray-900` | `white` (inverted, see §1.2.1) |

### 2.2 Palette: grey, blue, violet

The dashboard uses three colour roles in both themes, plus status colours
kept to text, numbers and dots. Feature tints (one hue per page or section)
are not used: a screen with many hues reads as noise, and colour stops
meaning anything.

| Role | Light | Dark | Used for |
| ---- | ----- | ---- | -------- |
| Neutral | white / gray-50 / gray-100 surfaces, gray-200 borders, gray-500 to gray-900 text | gray-900 to gray-700 surfaces, gray-700 borders, gray-100 to gray-400 text | Everything by default: icons, chips, category and engine badges, cards, competitors, "Other" |
| Interaction | blue-600 / blue-700 | blue-400 / blue-300 | Links, focus, the open page in the sidebar, selected states |
| Your brand | violet-50 surfaces, violet-700 text, violet-600 buttons | violet tints, violet-300 text, violet-600 buttons | First-party brands and domains, the "First Party" badge, first-party rows and buttons |
| Status | amber-700 (warning), emerald-700 (positive), red-600/700 (error) | amber-300, emerald-300, red-300/400 | Text, numbers and dots only; never card fills, stripes or category labels. Red tinted panels are kept for real errors |

Rules:

- No coloured card stripes (`border-l-4 border-{tone}-500`): a card is
  neutral and its status is a number, a word or a dot.
- Brand-type badges come from `constants/brandTypeBadge.ts`, engine chips
  from `constants/providers.ts` `badge` (neutral grey with the engine name).
- Sidebar icons use `navIconClass` (`Layout/sidebarNav.tsx`): grey, the open
  page in blue. `iconColor` on nav items no longer tints the sidebar.
- Stat cards (`Dashboard/StatCard.tsx`) draw every tone as the same neutral
  icon badge.
- Charts keep one hue per series (engine colours in `constants/providers.ts`,
  `Reports/charts/chartPalette.ts`): a chart needs distinct series to be read.
- `index.css` ("Palette in dark mode") holds the dark versions of the blue,
  violet, red, amber and emerald classes. Add a dark override there only for
  a class a component uses: rules in `index.css` are not removed when unused.

### 2.3 Semantic state colours

| State    | Light | Dark (via override) | Where |
| -------- | ----- | ------------------- | ----- |
| Success  | `text-emerald-700` | emerald-300 | text, numbers, a dot (`bg-emerald-500`) |
| Warning  | `text-amber-700`   | amber-300   | text, numbers, a dot (`bg-amber-500`) |
| Error    | `bg-red-50 text-red-700 border-red-200` | red tint, red-300 | error panels and text |
| Info     | `bg-blue-50 text-blue-700 border-blue-200` | blue tint, blue-300 | information panels and links |

Success and warning do not fill panels: use a neutral panel with the status
in its text.

---

## 3. Typography

The app uses the system font stack inherited from Tailwind defaults.

| Role            | Class                                  |
| --------------- | -------------------------------------- |
| Header title (h1, `App` header) | `text-lg sm:text-xl font-semibold text-gray-900` |
| In-page title (h2) | `text-2xl font-semibold text-gray-900` |
| Section title (h3) | `text-lg font-semibold text-gray-900` |
| Card label      | `text-sm font-medium text-gray-700`    |
| Body            | `text-sm text-gray-600`                |
| Helper / caption| `text-xs text-gray-500`                |
| Numeric stat    | `text-3xl font-semibold text-gray-900` |
| Section label   | `text-xs font-semibold uppercase tracking-wider text-gray-500` |

> Markdown prose (AI responses, Content Studio output) uses the
> `.prose-markdown` class, which has its own typographic scale in
> `index.css`. Extend `.prose-markdown` instead of re-styling markdown
> output.

---

## 4. Spacing and layout

- The grid uses Tailwind's default 4 px base.
- Standard card padding: `p-6` (24 px), `p-4` on dense lists.
- Standard gap between cards: `gap-4` to `gap-6`.
- Section margin between blocks: `mb-6 sm:mb-8`.
- Sidebar width: `w-64` (256 px), `w-16` (64 px) when collapsed to its
  icon rail on desktop; header height: `h-16` (64 px).
- Page content sits in `max-w-7xl mx-auto` with `p-4 sm:p-6 lg:p-8`
  around it.

Border radius: `rounded-lg` (8 px) is the default for cards, inputs,
buttons and modals. Icon badges use `rounded-xl`; pills use
`rounded-full`. Borders are 1 px (`border`) with the neutral border tokens.

---

## 5. Buttons

Use the `<Button>` component from `web/src/components/ui/Button.tsx` for new
buttons instead of hand-rolled class strings. Many existing views still
hand-roll their buttons; move them to `<Button>` when you work on them.

### 5.1 Variants

| Variant      | When to use | Visual |
| ------------ | ----------- | ------ |
| `primary` (default) | The main action of a page or form. Only **one** primary per visible group. | `bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300` |
| `secondary`  | Alternate actions of equal weight. | `bg-white text-gray-900 border border-gray-200 hover:bg-gray-50` |
| `ghost`      | Tertiary actions, cancel buttons, links inside dense rows. | `text-gray-600 hover:text-gray-900 hover:bg-gray-100` |
| `danger`     | Destructive primary actions inside confirmation dialogs. | `bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300` |
| `iconOnly`   | Square button hosting only an icon (toolbar / list-row actions). Always provide `aria-label`. | `text-gray-500 hover:text-gray-600 hover:bg-gray-100 rounded-md` |

Every variant gets `rounded-lg`, `transition-colors`, a
`focus-visible` ring and `disabled:opacity-50 disabled:cursor-not-allowed`.
`type` defaults to `"button"`.

### 5.2 Sizes

| Size | Padding | When to use |
| ---- | ------- | ----------- |
| `sm` | `px-3 py-1.5 text-sm` (`p-1.5` for `iconOnly`) | Dense rows, table cells, list-row actions. |
| `md` (default) | `px-4 py-2 text-sm` (`p-2` for `iconOnly`) | Standard page-level actions. |

### 5.3 Composition

Use `leadingIcon` instead of hand-placing icons:

```tsx
<Button
  leadingIcon={<PlusIcon className="w-4 h-4" />}
  onClick={() => setShowCreate(true)}
>
  New Persona
</Button>
```

For loading, swap the children for a loading label (`'Saving…'`) and pass
`disabled`; do not add custom spinners to primary buttons.

### 5.4 Anti-patterns

- Inline `className="px-4 py-2 bg-gray-900 text-white …"` strings.
- Mixing sizes in the same row.
- More than one primary button visible at once.
- `iconOnly` button without `aria-label` / `title`.

---

## 6. Icons

### 6.1 Source and style

The app ships its own outline icon set in `web/src/components/ui/Icons.tsx`,
Heroicons-style:

- 24 × 24 viewBox, `fill="none"`, `stroke="currentColor"`.
- `strokeLinecap="round"`, `strokeLinejoin="round"`, `strokeWidth={1.5}`.
- Default size `w-5 h-5`, set through the `className` prop.
- Colour comes from `currentColor`: set `text-*` on the parent.

Available icons (re-exported from `components/ui/index.ts`): `PauseIcon`,
`PlayIcon`, `PencilIcon`, `TrashIcon`, `PlusIcon`, `CloseIcon`,
`ChevronDownIcon`, `SearchIcon`, `LinkIcon`, `GlobeIcon`, `KeyIcon`,
`WarningIcon`, `CheckIcon`, `ArrowRightIcon`, `EyeIcon`, `CogIcon`,
`RefreshIcon`, `ClockIcon`, `CollectionIcon`. `ClipboardIcon` is a separate
file (`ui/ClipboardIcon.tsx`) used by copy buttons.

There is no right chevron: rotate `ChevronDownIcon` (`-rotate-90` for a
collapsed row, `rotate-180` for a "show less" toggle).

The sidebar's navigation (`Layout/sidebarNav.tsx`) draws its entry icons
with `StrokeIcon` and path data (the shared `*_PATHS` where one exists),
and uses `EyeIcon`, `PlayIcon`, `ClockIcon` and `CogIcon` from the shared
set; `Layout/Sidebar.tsx` adds `CloseIcon` and the rail toggle
(`CHEVRON_DOUBLE_LEFT_PATHS`, turned 180° while collapsed).

### 6.2 Adding a new icon

1. Pick or trace a Heroicons outline path.
2. Add its path data to `ui/iconPaths.ts` as a `*_PATHS` array (one `d`
   attribute per `<path>`). Every outline SVG in the app is drawn by
   `ui/StrokeIcon` from that file (props `paths`, `className`,
   `strokeWidth` 1.5 or 2, and optional `aria-hidden` / `role`); don't
   inline a new `<svg>`.
3. For a named icon, add a component to `Icons.tsx` (it renders through
   `StrokeIcon`; props `className` and `title`) and re-export it from
   `components/ui/index.ts`. A one-off glyph can use
   `<StrokeIcon paths={MY_PATHS} className="w-4 h-4" aria-hidden="true" />`
   directly.
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

- Without a `title`, an icon renders `aria-hidden`. With a `title`, it
  renders `role="img"` and a `<title>` element.
- When the icon is the only visible content (icon-only buttons, sidebar
  close, disclosure chevrons), the host element carries `aria-label` or
  `title`.
- Disclosure buttons that toggle a chevron set `aria-expanded`.

### 6.5 No emoji as UI

Emoji are not used as UI affordances: they render inconsistently across
operating systems, cannot be recoloured for dark mode or hover states, and
screen readers announce their unicode name instead of the action.

The exceptions are decorative section labels inside the About dialog
(`About/ArchitectureTab.tsx`, `About/LicensesTab.tsx`) and the `✓` suffix
inside a native `<option>` in `Brands/PromptEditor.tsx` (browsers do not
render components inside `<option>`). Treat these as the ceiling.

---

## 7. Components inventory

### 7.1 Pages

`App.tsx` maps each tab to a path (`TAB_TO_PATH`) and a header title
(`PAGE_TITLES`); `Layout/TabContent.tsx` renders the tab's view, and every
path under `/reports` goes to `Reports/ReportsRouter.tsx`. Pages rely on the
global overrides of §1.2 for dark mode.

| Route | Sidebar label | View |
| ----- | ------------- | ---- |
| `/` | Dashboard | `Layout/TabContent` (dashboard content: `Dashboard/StatCard`, `ProviderChart`, `BrandChart`, `AlertsPanel`, quick actions) |
| `/visibility` | Visibility | `Visibility/VisibilityDashboard` |
| `/brands` | Brand Mentions | `Brands/BrandsView` |
| `/citations` | Citations | `Citations/CitationsView` |
| `/prompt-insights` | Prompt Insights | `Insights/PromptInsights` |
| `/citation-gaps` | Citation Gaps | `Insights/CitationGaps` |
| `/recommendations` | Action Center | `Insights/Recommendations` |
| `/keyword-research` | Keyword Research | `KeywordResearch/KeywordResearchView` (research agent in `KeywordResearch/agent/`) |
| `/seo/*` | SEO (children: Overview, Domain Overview, Backlinks, Rank Tracking, Site Audit, Performance, Local SEO) | `Seo/SeoRouter`, overview `Seo/SeoHome`, pages listed in `Seo/seoPages.ts` |
| `/content-studio` | Content Studio | `ContentStudio/ContentStudioView` |
| `/reports/*` | Reports | `Reports/ReportsRouter`, landing page `Reports/ReportsLandingView` |
| `/searches` | Recent Searches | `Searches/SearchesView` |
| `/raw-responses` | Raw Responses | `RawResponses/RawResponsesExplorer` |
| `/execution` | Run Analysis | `Execution/ExecutionMonitor` |
| `/schedule` | Schedule | `Schedule/ScheduleManager` |
| `/settings/*` | Settings (children: one per section) | `Settings/SettingsView`, sections Keywords, Markets, Brand tracking, Personas, AI providers, Bedrock models, Alerts, Users, AI assistants (`Settings/settingsSections.ts`; `/settings/<section>`, `/settings` opens Keywords; Users and Bedrock models are Admin only) |

Reports (`ReportsRouter`): Executive Summary (`/reports/executive-summary`),
Brand Visibility Report (`/reports/visibility[/:keyword]`), Competitor
Benchmark (`/reports/benchmark`), AI Engines (`/reports/engines`), Sources
(`/reports/sources`), Sentiment (`/reports/sentiment`), Competitor Gap
Report (`/reports/competitor[/:competitor]`), Content Action Plan
(`/reports/content-action-plan`), Keyword Deep Dive
(`/reports/keyword[/:keyword]`) and SEO vs GEO (`/reports/seo-geo`). Custom reports (`Reports/customReport/`):
the builder at `/reports/custom/new` and `/reports/custom/:id/edit`, a saved
report at `/reports/custom/:id`.

Chrome and overlays:

| Component | Theming |
| --------- | ------- |
| `Layout/Sidebar` (`bg-white dark:bg-gray-800`) | explicit `dark:` variants |
| `App` header (print, theme toggle, about, sign out) | explicit `dark:` variants |
| `ui/Modal`, `ConfirmModal`, `AlertModal` (close on Escape) | explicit `dark:` variants on overlay and panel |
| `About/AboutModal` | explicit `dark:` variants |
| `main.tsx` `RootErrorFallback` | explicit `dark:` variants |
| `ErrorBoundary/ErrorBoundary` | global override |
| `ui/Spinner` | `currentColor` |
| `Onboarding/OnboardingModal`, `ProviderHealth/ProviderHealthBanner` | app-wide, hidden in print mode |

### 7.2 Primitives (`components/ui/`)

`ui/index.ts` re-exports `Button` and the icons; import everything else from
its own file.

| File | Purpose |
| ---- | ------- |
| `Button.tsx` | Canonical button: variants and sizes (§5). |
| `Icons.tsx`, `ClipboardIcon.tsx` | Shared SVG icons (§6). |
| `StrokeIcon.tsx`, `iconPaths.ts` | The 24×24 outline SVG every icon is drawn with, and the path data it draws (§6.2). |
| `Modal.tsx` | `Modal`, `ConfirmModal`, `AlertModal`. `Modal` sizes are `md`, `xl`, `4xl`, `5xl` and `6xl`; `layout="flush"` renders the children edge to edge (own header, scrolling body and footer) and `labelledBy` names the dialog from a heading inside them. Every dialog uses it, so all close on Escape. |
| `LoadOnScrollFooter.tsx` | End of a list that grows as the reader scrolls: an invisible marker (`useLoadOnScroll`, IntersectionObserver, 400 px ahead) asks for the next batch, a polite live "Loading more…", a "Load more" button for keyboard users and browsers without the observer, "Try again" after a failure (no automatic retry), and an end-of-list line. Used by Recent Searches, Citations and Brand Mentions. A cursor-paged list keeps its pages with `hooks/useContinuedPages.ts`: it appends each page after the first, drops repeated rows, ignores a page that answers an older query, and starts again when the first page changes (a new sort, filter, scope or market). |
| `ModalCloseFooter.tsx` | Bottom bar of a full-size detail dialog: a rule and a right-aligned Close button. |
| `Spinner.tsx` | Loading indicator (`sm` / `md` / `lg`). |
| `Skeleton.tsx` | First-load placeholders shaped like the content they stand in for, so nothing shifts when data arrives: `Skeleton` (one block), `SkeletonRegion` (the `<output aria-busy>` wrapper with the screen-reader label every skeleton layout goes in), `SkeletonLines`, `SkeletonTable`, `SkeletonCards`, `SkeletonPage` (the Suspense fallback of lazy tabs and reports). Show them only while there is no data yet; on refresh keep the old data. The `.skeleton` class in `index.css` carries the colour, dark tint and reduced-motion rule. |
| `CenteredState.tsx` | Centred view states: `CenteredLoading` (spinner above a label, for content of unknown size) and `CenteredEmpty` (illustration, message, hint). |
| `PageHeaderCard.tsx` | White card at the top of a view: title, description, and the view's controls (scope picker, persona filter, buttons) stacked under it. |
| `ErrorAlert.tsx` | Announced (`role="alert"`) red error box; renders nothing while the message is `null`. |
| `RefreshTextButton.tsx` | Grey "Refresh" text button of a panel header. |
| `useExportAction.ts` | Busy flag and click handler for an "Export to Excel" button; a failure is logged or handed to a callback. |
| `ThemeToggle.tsx` | Light / dark / system switcher. |
| `InfoTooltip.tsx` | "i" button with an explanation; used next to headings and KPI columns. The only tooltip component: it renders into `document.body` with fixed positioning (`tooltipPosition.ts`), so no table or scroll container can clip it or stop its text wrapping. Don't hand-roll another. |
| `Disclosure.tsx` | A heading that expands the content under it; collapsed on screen, always open in print (§1.4). |
| `KeywordScopeSelector.tsx`, `KeywordScopePicker.tsx`, `useKeywordScopeOptions.ts`, `reportScope.ts` | Choosing and encoding a keyword scope (all keywords, a keyword group, or selected keywords). |
| `PrintToPdfButton.tsx` | Opens the page in print mode (§1.4). |
| `MarkdownProcessor.tsx` | Renders AI markdown, sanitized with DOMPurify. |
| `chartTheme.ts` | `getChartTheme(isDark)` plus `themedLegend`, `themedTooltip`, `themedAxis` (§7.5). |
| `pagination.ts` | Client-side `paginate()` helper. |
| `DataTable.tsx` | The dense data table (§9): typed columns (`DataColumn`: header, `help` tooltip, `sortKey`, `numeric`), hidden caption, `aria-sort` sort buttons, sticky header past 15 rows, optional leading column and rows under a row (`renderAfter`, cells with `DATA_TABLE_CELL`). |
| `tableCells.tsx` | Cell contents: `Chip` (tones neutral / green / blue / indigo / purple / amber / red; search intents: informational blue, commercial purple, transactional green, navigational indigo, unknown neutral), `PositionBadge` (Google position: top 3 green, 4-10 blue, 11-20 amber), `ScoreChip` (0-100 score: under 30 green, under 70 amber, else red), `CompactNumber` (`1.2M` with the exact figure as tooltip), `UrlCell` (one-line link, full URL as tooltip, only http(s) is a link), `pageColumn`. |
| `numberFormat.ts` | `integerText`, `compactText`, `usdText`, `compactUsdText`, `decimalText`: thousands separators, compact from 10,000, `—` for unknown (never 0). |
| `TablePager.tsx` | Pager of a server-paged table: rows per page and range on the left, Previous / "Page n of m" / Next on the right; copes with an unknown total. |

### 7.3 Layout

`Layout/Sidebar.tsx` is the only navigation chrome: sections, items, count
badges and the "running" pulse on Run Analysis (entries in
`Layout/sidebarNav.tsx`). On desktop the button beside the title collapses
it to a 64 px icon rail (`aria-expanded`, `aria-controls="app-sidebar"`):
labels become `title` tooltips and stay in the link name (`lg:sr-only`),
section titles give way to a rule, count badges shrink to dots. The choice
is stored under `localStorage['sidebar-collapsed']` (guarded:
unavailable storage means expanded). `<main>` follows the width through
Tailwind's `peer` on the `<aside data-collapsed>`
(`lg:ml-64 lg:peer-data-[collapsed=true]:ml-16`), so the aside must stay
`<main>`'s preceding sibling. Every collapsed style is `lg:`-only: on mobile
the sidebar still slides out at full width. A new top-level feature gets
a sidebar entry, a `TAB_TO_PATH` / `PAGE_TITLES` entry in `App.tsx` and a
case in `Layout/TabContent.tsx`, not a new chrome component.

### 7.4 Feature components

Feature code lives in `components/<Feature>/`; import through the folder's
`index.ts` where it has one. Specs (`*.spec.tsx`) and fixtures
(`*-fixtures.ts(x)`) sit next to the file. ESLint caps files at 400 lines
(specs at 730), cyclomatic complexity at 12 and nesting depth at 3; split a
component into sub-components before it reaches them.

Reports compose their pages from `components/Reports/layout/`:
`ReportLayout`, `ReportSection` and `ReportSectionPlaceholder` (page and
section frames, loading / error / empty states via `sectionGate`:
`gateSection`, `pendingSectionPlaceholder`, and the `SectionFetchState` /
`ReportSlice` props every gated section takes, built by `reportSlices`),
`ReportCard` (`REPORT_CARD_CLASS`, `ReportCardHeader`), `ReportSectionNote`,
`ReportStatCard` / `ReportStatGrid`, `ReportTable` (print-friendly typed
columns, with `kpiColumn` for KPI columns whose tooltip holds the
definition and `emphasisColumn` for a highlighted figure; `brandColumns`
and `domainColumns` hold the shared brand and domain columns),
`KpiHeadline`, `RunKpiHeadline`, `VisibilityHeadlineSection`,
`TrendHeadlineSection`, `TrendPeriodTable`, `MoverColumn`,
`KpiDefinitionsSection` (the definitions every report ends with),
`PriorityBadge` and `ReportKeywordSelector`; `kpiSheets` holds the shared
Excel sheets of the report exports. Use them instead of building report
layout from scratch.

### 7.5 Charts

Chart.js canvases do **not** participate in the CSS override system, so
axis ticks, grid, legend and tooltip need explicit theme-aware colours.

- **Imperative charts** (the dashboard charts and every report chart) use
  `Dashboard/useThemedChart.ts`: it creates the `Chart`, passes the
  current `getChartTheme(isDark)` to a module-level configuration builder,
  rebuilds when the data or the theme changes and destroys the chart on
  unmount.
- **Declarative charts** (`react-chartjs-2`, in
  `Visibility/PersonaComparisonChart.tsx` and `Keywords/KeywordDetail.tsx`)
  read `isDark` from `useTheme()` and build their options with the
  `chartTheme.ts` helpers:

```tsx
import { useTheme } from '../../hooks/useTheme';
import { getChartTheme, themedAxis, themedLegend, themedTooltip } from '../ui/chartTheme';

export function MyChart() {
  const { isDark } = useTheme();
  const theme = getChartTheme(isDark);

  const options = {
    plugins: { legend: themedLegend(theme), tooltip: themedTooltip(theme) },
    scales: { x: themedAxis(theme), y: themedAxis(theme, { beginAtZero: true }) },
  };
  // ...
}
```

Dataset colours: saturated colours stay fixed across themes; neutral
(gray) series need a light and a dark variant, as in
`Dashboard/BrandChart.tsx` and `Reports/charts/chartPalette.ts`.

#### Report charts

The reports and the Visibility page draw their charts from one library,
`components/Reports/charts/` (KPI trend line, share-of-voice donut,
grouped engine bars, brand trend lines, sentiment split, top sources):

- **Layout.** Wrap each chart in `ChartPanel` (a titled card with an
  optional "i" tooltip beside the heading and a printed subtitle) and
  draw it with `ChartFigure` (a fixed-height canvas, kept on one printed
  page, with the figures in words as a screen-reader `figcaption`, and a
  plain sentence instead of an empty chart).
- **Colours** (`chartPalette.ts`): emerald for your brand, your domains
  and positive sentiment; amber for competitors and mixed sentiment; red
  for negative; indigo for domains that are not yours; gray for neutral
  sentiment and "Other brands" (with a light and a dark variant).
  Competitor lines take amber, orange, rose, violet and sky in turn.
- **Scales.** Charts draw the percentages and the visibility score on a
  shared 0–100 axis (`chartKpis.ts`, `chartOptions.ts`); net sentiment has
  its own −100…+100 chart in the Sentiment report. Counts and average
  position stay in tables.
- **Build the Chart.js configuration in a pure `*ChartConfiguration.ts`
  module** and keep the component to the canvas lifecycle, so the
  configuration is unit-tested without a canvas. Shared pieces:
  `lineChartConfiguration.ts` (line charts on the 0–100 axis, gaps for
  unknown values) and `chartSeries.ts` (series and their captions in words).

### 7.6 Images

User-content images (crawler screenshots, raw S3 images) usually carry
bright white backgrounds. Dim them in dark mode:

```tsx
<img
  src={screenshotUrl}
  alt="Screenshot of the cited page"
  className="w-full border border-gray-300 rounded shadow-lg dark:brightness-90 dark:contrast-95"
/>
```

Applied in `Citations/CitationDetailModal.tsx`, `Citations/CrawlHistory.tsx`
and `RawResponses/ImageViewer.tsx`.

Do NOT apply the filter to:

- **Profile photos** of real people (the About tab portraits).
- **Logos and favicons**; the sidebar mark inverts through Tailwind
  classes instead (`bg-gray-900 dark:bg-white`).
- **Decorative icons** – use the SVG icon set.

---

## 8. Forms

- Wrap form fields in `<form>` and submit via a `primary` button.
- Labels: `block text-sm font-medium text-gray-700 mb-1`, paired via
  `htmlFor` / `id`.
- Inputs / textareas / selects: `w-full p-2 border border-gray-200
  rounded-lg text-sm focus:ring-2 focus:ring-gray-900`. Dark-mode styling
  is applied globally.
- Helper text under inputs: `text-xs text-gray-500 mt-1`.
- Validation errors: `text-xs text-red-600 mt-1`.
- Cancel buttons sit to the right of the submit button and use the `ghost`
  variant.

---

## 9. Tables

- Header row: `bg-gray-50`; header cells `px-6 py-3 text-xs font-medium
  uppercase tracking-wider text-gray-500`.
- Body cells: `px-6 py-4`; row separators `divide-y divide-gray-200`.
- Dense data tables (SEO keywords, pages, backlinks) use `ui/DataTable`:
  `px-4` cells, a row hover (`hover:bg-gray-50`), numbers right-aligned in
  `tabular-nums` with thousands separators and `ui/numberFormat`'s compact
  form for large values (exact figure in the tooltip), URLs through
  `UrlCell`, positions as `PositionBadge`, 0-100 scores as `ScoreChip`,
  flags as `Chip`. The card scrolls sideways on narrow screens; past 15 rows
  it scrolls inside `max-h-[70vh]` under a sticky header. Loading is a
  `SkeletonTable` in the same bordered card; server paging goes under the
  table with `ui/TablePager`.
- A page of such tables opens with `PageHeaderCard` (title, description,
  the search form as its children); headline figures are
  `Reports/layout/ReportStatCard` tiles in a `ReportStatGrid`; result tabs
  are an underline `TabBar` across the top of a white card with a
  `TabPanel` under it.
- Sortable columns set `aria-sort` on the header cell.
- Expandable rows use `ChevronDownIcon` (rotated `-rotate-90` while
  collapsed) inside a button with `aria-expanded`.
- In reports, use `Reports/layout/ReportTable`.

---

## 10. Favicon and identity

- App favicon: `web/public/assets/favicon.ico` (16×16 ICO), linked from
  `web/index.html`.
- App name: "Citation Analysis Dashboard" (`web/index.html` `<title>`); the
  sidebar and the sign-in screen read "Citation Analysis".
- Logo mark in the sidebar: an inline bar-chart SVG (`strokeWidth={2}`,
  `text-white dark:text-gray-900`) inside a `w-8 h-8 rounded-lg
  bg-gray-900 dark:bg-white` square, so it stays high-contrast in both
  themes.
- About tab portraits (`web/public/assets/*.jpg`) render unchanged in both
  themes.

When replacing the favicon, add modern formats (`favicon.svg`,
`apple-touch-icon.png`) and reference them from `web/index.html`. Keep the
silhouette legible at 16×16.

---

## 11. Review checklist

None of these is enforced by lint; check them in review.

- [ ] No emoji as a button label or interactive icon. Use icons from
      `components/ui/Icons.tsx`.
- [ ] No unicode arrows (`▲▼◀▶`) for expand/collapse. Use a rotated
      `ChevronDownIcon`, with `aria-expanded` on the button.
- [ ] No hand-rolled `className="px-4 py-2 bg-gray-900 …"` button
      strings in new code. Use `<Button>`.
- [ ] No icon-only button without `aria-label` / `title`.
- [ ] No hard-coded hex colours. Use Tailwind tokens (chart palettes use
      the `rgb()` values of Tailwind tokens).
- [ ] No mixed sizes in the same button group / list row.
- [ ] No new `dark:` variants for classes covered by the global override
      (§1.2), neutrals and accents alike. If a class is missing there, add
      the override to `index.css`.
- [ ] No accent surface in an explicitly themed area (sidebar, header,
      modals) without checking that the global override matches the intent.
- [ ] No `dark:` variants forgotten on explicitly themed chrome.
- [ ] No emoji-as-key props (e.g. `icon: '🔍'` mapped in a switch) outside
      the About dialog. Take a `ReactNode` icon instead.
- [ ] New icons follow the stroke convention: 24 × 24 viewBox,
      `currentColor`, `strokeWidth={1.5}`.
- [ ] No two primary buttons in the same visible group.
- [ ] Screen-only controls carry `print-hidden`; cards and charts that must
      not split carry `avoid-break-inside`.
- [ ] New charts theme their chrome (§7.5); report charts go through
      `ChartPanel` / `ChartFigure` with a pure configuration module.

---

## 12. Where to put new design system code

```
web/src/components/ui/
├── Button.tsx                # button variants + sizes
├── Icons.tsx                 # shared icon set
├── ClipboardIcon.tsx         # copy-button glyph
├── Modal.tsx                 # Modal, ConfirmModal, AlertModal
├── Spinner.tsx               # loading
├── ThemeToggle.tsx           # theme switcher
├── InfoTooltip.tsx           # "i" explanations (+ tooltipPosition)
├── Disclosure.tsx            # collapsible heading, open in print
├── KeywordScopeSelector.tsx  # keyword scope controls (+ KeywordScopePicker, useKeywordScopeOptions, reportScope)
├── PrintToPdfButton.tsx      # print mode
├── MarkdownProcessor.tsx     # sanitized AI markdown
├── chartTheme.ts             # Chart.js theme helpers
├── pagination.ts
├── DataTable.tsx             # dense data table (+ tableCells, numberFormat, TablePager)
└── index.ts                  # re-exports Button and the icons
web/src/components/Reports/layout/   # report page building blocks
web/src/components/Reports/charts/   # report chart library
```

A generic primitive goes in `components/ui/` (re-export it from
`index.ts` only if it belongs with `Button` and the icons); a report
building block goes in `Reports/layout/` or `Reports/charts/`. Feature
folders consume primitives, they do not redefine them.
