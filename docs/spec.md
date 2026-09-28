Here's the complete, merged `docs/spec.md` — generic core, your M3 decisions baked in, DESIGN.md conflicts resolved (prose palette wins, dark-only v1, 768/1280 breakpoints, workbench model), and theme toggles removed throughout. Paste it over the empty file.

````markdown
# SPEC.md — Unfold

A **generic** interactive markdown explorer: drop in any well-structured `.md`
document and get an explorable site — reader, auto-generated navigation,
search, diagrams, and (when the document supports it) an architecture graph
and lifecycle stepper. It serves three reading speeds: **SKIM** (executive
mode, hero, graph), **READ** (the reader), **REFERENCE** (search, palette,
popovers, backlinks).

The bundled demo document is an architecture doc, but **no feature may depend
on that document's content**. Every feature activates from what the parsed
document provides (§1).

## 0. Sources of truth & precedence

| Artifact | Role |
|---|---|
| `*.md` loaded at runtime | The only content source. Never fork document content into app code. |
| `designs/<feature>/code.html` + `screen.png` | Visual source of truth per feature (§5.1). |
| `designs/architecture_explorer/DESIGN.md` | Design system: tokens, type, elevation, components, motion language. |
| `docs/spec.md` (this file) | Behavioral + technical source of truth. |

Precedence: behavior → this spec; visuals → design refs + DESIGN.md; conflicts
→ spec wins for behavior, refs win for visuals. For token *values*, the token
table in §5.2 is canonical (it resolves DESIGN.md's frontmatter/prose conflict).

- **Do not port ref HTML verbatim.** AI-generated refs typically inline styles
  and duplicate CSS. Extract tokens (§5), rebuild with the component system.
- The genericity rules in §1 are hard requirements, enforced by CI (§11).

## 1. The genericity contract (core principle)

**The document is data; the app is a renderer. Anything the document doesn't
provide, the UI hides — never fakes, never crashes.**

Three mechanisms, in priority order:

### 1.1 Capability detection
After parsing, the app computes a capability set. Views and UI affordances
render only when their capability is present:

| Capability | Detected when | Unlocks |
|---|---|---|
| `graph` | an explicit ` ```graph ` block exists, OR the derivation rule in §6.7 is met (cross-link density thresholds) | Graph view nav item + view |
| `stepper` | a ` ```steps ` block exists | Stepper view nav item + view |
| `glossary` | any candidate heading (§6.6) with ≥2 entries | Glossary chips + search group |
| `entities` | ≥3 file-path matches across the doc | File chips, popovers, backlinks |
| `mermaid` / `loop` / `terminal` | respective block kinds found | Renderers |

Hero stats, TOC, search, reader, progress: always available (Tier 0).

### 1.2 Conventions (optional, author-facing)
Documents opt into richer views via conventions — plain markdown, no app
knowledge required:

- ```` ```mermaid ```` — standard Mermaid, rendered inline.
- ```` ```loop ```` — comma/newline-separated labels → animated cycle diagram.
- ```` ```graph ```` — node/edge DSL → graph view (§6.7).
- ```` ```steps ```` — ordered steps DSL → stepper view (§6.8).
- A `## Glossary`-family section — term → definition mapping (§6.6).
- YAML frontmatter — optional `title`, `description`, `accent` (§6.2).

### 1.3 Graceful degradation
- A `graph`/`steps`/`loop` block that fails to parse renders as a plain code
  block with a subtle "unparsed block" tooltip. Never a crash, never blank.
- Missing H1 → title falls back to filename. No H2s → TOC shows the H1 only,
  metro rail hides. Low cross-link density → no graph capability.
- Documents of any size must work: 50 words and 50,000 words (§10 budgets).

### 1.4 Configuration (optional, deployer-facing)
`unfold.config.json` at repo root — all fields optional, zero-config works:

```json
{
  "docPath": "./document.md",
  "title": "override title",
  "accent": "#06b6d4",
  "features": { "graph": "auto", "stepper": "auto", "delight": true }
}
```

`"auto"` (default) = capability-detected; `"off"` forces hidden; `"on"` shows
the nav item with an empty state if data is missing.

## 2. Goals

1. Any markdown file in → beautiful interactive site out. Zero per-doc code.
2. Feel like a product: "mission control for documents" — per DESIGN.md:
   mechanical precision of developer mission control × explorable-essay
   pedagogy. Documents are navigable machines, not static manuals.
3. Fast: static build, no server, no SSR.
4. Accessible: full keyboard support, WCAG AA (dark theme), reduced-motion.

## 3. Non-goals (v1)

- No editing/authoring UI. Docs stay authored in text editors.
- No auth, backend, analytics, SEO work, multi-doc browsing (one doc per load).
- No remote-URL ingestion (`?doc=<url>`) — **deferred to v2** (CORS, security,
  redirects, auth, huge-document handling; see §15).
- No light theme — **deferred to v2** (§7.9).
- No CMS, no MDX (the doc must remain a plain `.md` readable on GitHub).
- No generic SaaS dashboard patterns (metric-card rows, "Trusted by", gradient
  tagline heroes).

## 4. Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Build | **Vite + React 18 + TypeScript (strict)** | SPA, total control, static hosting. (Not CRA — deprecated.) |
| MD parsing | **unified / remark-parse (mdast)** + `frontmatter` | Content-as-data requires an AST. |
| Rendering | Custom React components per block kind. No `dangerouslySetInnerHTML` (sanitized `<br>` excepted). | Component-level interactivity. |
| Graph | **React Flow** (lazy chunk) | Interactive nodes/edges. |
| Motion | **Framer Motion** | Layout/gesture animation, reduced-motion API. |
| Palette/search | **cmdk** + **minisearch** | Command palette; in-memory fuzzy search. |
| Code highlight | **Shiki**, `github-dark` theme | Accurate; single theme in v1. |
| Diagrams | **mermaid** (lazy, `dark` theme) for mermaid blocks; custom SVG for `loop` | No re-theming needed in v1 (dark only). |
| Delight | **canvas-confetti** (lazy) | Milestones. |
| Styling | Tailwind + CSS custom properties for tokens | Tokens from §5.2 / DESIGN.md. |
| Testing | Vitest + Testing Library; Playwright smoke optional | Parser is pure → highly testable. |

State: React context only (view, reading mode, active section). No state
library. Routing: hash-based. `#<slug>` = section deep-link; `#/graph`;
`#/stepper` (routes exist only when capable).

## 5. Design system

### 5.1 Design refs

| Ref | Defines |
|---|---|
| `designs/reader_view_core_architecture_doc/` | Reader view, hero, TOC |
| `designs/architecture_graph_canvas_node_panel/` | Graph canvas + node detail panel (both states) |
| `designs/lifecycle_stepper_request_walkthrough/` | Stepper |
| `designs/command_palette_cmd_k_quick_switcher/` | Cmd+K palette |
| `designs/architecture_explorer/DESIGN.md` | Tokens, elevation, components, layout model |

Not yet designed (implement from DESIGN.md + reader conventions): mobile
layouts, popover cards, Executive/Reference toggle, empty/loading/error
states. DESIGN.md is the authority for these.

### 5.2 Tokens — `src/styles/tokens.css`

**The prose palette in DESIGN.md is authoritative; where its frontmatter
`colors:` block disagrees, this table wins.** Regenerate the DESIGN.md
frontmatter to match. No hardcoded hex outside `tokens.css`.

```text
Canvas & surfaces
  --canvas              #090d16    viewport / graph canvas substrate
  --surface-1           #0f172a    panels, sidebar, code cards, Level 1
  --surface-2           #1e293b    popovers, elevated panels, Level 2
  --surface-interactive #243247    hover/pressed states
Borders
  --border-muted        #1e293b    primary 1px demarcation
  --border-strong       #334155    secondary dividers, inactive inputs
  --border-focus        #06b6d4    focus rings, selection
Accents (semantic ONLY — state, motion, emphasis; never body text)
  --primary             #06b6d4    active node, live execution, primary action
  --secondary           #6366f1    dependency transitions, pipeline segments
  --tertiary            #8b5cf6    terminal nodes, external egress, cached state
  --gradient            linear-gradient(135deg,#06b6d4 0%,#6366f1 50%,#8b5cf6 100%)
                                  live processing, metro traversal, progress bars
  --accent-wash         rgba(6,182,212,.10)   active-tag background
  --active-line         rgba(6,182,212,.08)   active code-line background
  --grid-line           rgba(51,65,85,.25)    canvas grid, 24px pitch
Status
  --error               #ef4444    --error-text  #f87171
Text
  --text-high           #f8fafc    headlines, active code, focal metrics
  --text-secondary      #cbd5e1    prose
  --text-muted          #94a3b8    metadata, breadcrumbs
  --text-subtle         #475569    disabled, line numbers
```

Type (from DESIGN.md): **Geist** display/headlines, **Inter** body,
**JetBrains Mono** code/identifiers/labels with `tnum` enabled on all mono
elements. Use the DESIGN.md scale names (`display-lg`, `headline-xl`,
`body-lg`, `code-md`, `label-caps`, …). `label-caps` renders uppercase with
letter-spacing. Inline code in prose: `code-md` in a subtle surface pill with
2px horizontal padding.

Radii: 4px base (`rounded`) for code blocks, buttons, chips, inputs, metro
nodes; 8px (`rounded-lg`) cards/drawers/modals; 12px (`rounded-xl`) top-level
viewports; pill (`rounded-full`) status dots and badges.

Elevation (exact values): L1 = flat, 1px `--border-muted`, no shadow.
L2 = surface-2, 1px `--border-strong`, `0 4px 20px -2px rgba(2,6,23,.6)`.
L3 (palette, overlays, active metro nodes) = surface-1, 1px `--border-focus`,
`0 0 16px -2px rgba(6,182,212,.25), 0 12px 32px -4px rgba(2,6,23,.8)`.
Modals/flyouts: `backdrop-filter: blur(12px)` over `--canvas` at 85%.
Nodes get a 1px inner hairline `inset 0 1px 0 0 rgba(255,255,255,.06)`.

### 5.3 Layout model (from DESIGN.md)

Two workbench states, shared shell:

- **Reader workbench** (`#/`): nav rail 260px + reading column (~70ch).
- **Graph workbench** (`#/graph`): nav rail 260px (collapsible) + fluid graph
  canvas + inspector panel 440px (§7.6).

Breakpoints (DESIGN.md, global): ≥1280px full workbenches; 768–1279px nav
rail becomes a drawer overlay, graph view splits 50/50; <768px single pane,
segmented tabs (Docs / Visual Graph when capable — **no Metrics tab**).
Gutters/margins step down to `gutter-mobile`/`margin-mobile` below 768px.

## 6. Content pipeline (the core of the app)

### 6.1 Loading
`fetch(docPath)` → on success parse; on 404 / `file://` → **drop screen**:
drag any `.md` onto the window or use the file picker. Parse errors → friendly
error card with the failure reason. Never a blank screen.

**A 200 response whose body is HTML (SPA fallback) is treated as not-found.**
A static host answers a request for a missing file with the app shell and
status 200, so a successful status alone does not mean "here is your document".
Either signal is sufficient to refuse: a `content-type` containing `text/html`,
or a body that begins `<!doctype html` / `<html` within its first 256 bytes.
Rendering the shell as a document would produce a confident, entirely fictional
zero-section reader — the worst possible failure, because it looks like success.
The drop screen for this case names the path and points at `docPath` in
`unfold.config.json` and at the document needing to be deployed alongside
`dist/`.

### 6.2 Pipeline
`read → frontmatter → remark-parse (mdast) → transform → Doc`.

Transform: split top-level by H2, nest H3s; classify each node into a `Block`;
walk text to extract entities; detect capabilities (§1.1); build indexes
(§6.6). Pure function: no DOM, no fetch, fully unit-testable.

Frontmatter (optional): `title` overrides first-H1; `description` feeds the
hero subtitle; `accent` overrides `--primary` at runtime (CSS custom property).

### 6.3 Data model

```ts
type Block =
  | { kind: 'prose';    node: ParagraphAST }
  | { kind: 'code';     lang: string; code: string }
  | { kind: 'table';    header: string[]; rows: string[][]; align: Align[] }
  | { kind: 'terminal'; code: string }        // auto-detected ASCII diagram
  | { kind: 'mermaid';  code: string }
  | { kind: 'loop';     labels: string[] }
  | { kind: 'graph';    spec: GraphSpec }     // §6.7
  | { kind: 'steps';    spec: StepSpec[] }    // §6.8
  | { kind: 'quote';    node: ParagraphAST }
  | { kind: 'list';     ordered: boolean; items: ListAST[] }
  | { kind: 'hr' }

type Section = {
  level: 2 | 3
  slug: string
  title: string
  blocks: Block[]
  children: Section[]
  files: FileRef[]; tests: TestRef[]
  wordCount: number
  linksTo: string[]   // slugs this section links to
}

type GlossaryEntry = { term: string; aliases: string[]; definition: string }

type Doc = {
  title: string; description?: string
  intro: Block[]
  sections: Section[]
  glossary?: GlossaryEntry[]
  graph?: { spec: GraphSpec; derived: boolean }   // derived → "Auto-generated map"
  steps?: StepSpec[]
  capabilities: CapabilitySet
}
```

### 6.4 Slugs — GitHub-parity (critical)
Documents are authored against GitHub's anchor behavior; the app must match the
`github-slugger` algorithm exactly: lowercase → drop every character GitHub drops
(punctuation and symbols) → replace each space with `-`. Two consequences the
plain-language summary gets wrong, and that this section now states
explicitly:

- **Underscores are retained** (`under_score` → `under_score`). They are not
  punctuation to GitHub.
- **A dropped character leaves the space that surrounded it.** Nothing is
  re-trimmed after removal, so `Known divergences & errata` →
  `known-divergences--errata` (two hyphens) and `🚀 Launch` → `-launch` (leading
  hyphen).

**Duplicates get `-1`, `-2` suffixes**, counted per base slug in document order.
Internal links `[x](#slug)` resolve in-app (scroll + flash), never 404.
Unresolvable internal links render as muted text with a tooltip, not as
broken navigation.

### 6.5 Entity extraction (generic, configurable)
Walk text runs, **never inside fenced code blocks**. Default patterns:

| Entity | Pattern shape | Becomes |
|---|---|---|
| File path | path segments + known source extension, from a configurable list (default: py, ts, tsx, js, jsx, go, rs, java, rb, sh, sql, json, yaml, yml, toml, css, html, md) | hoverable chip |
| `path::symbol` | detected path + `::` + identifier | chip with symbol subtitle |
| Test id | detected path + `::` + identifier starting with `test_` / `.test.` / `.spec.` | chip ("pinned by" context in popover) |
| Glossary term | any glossary term or alias, word-bounded, case-insensitive | dotted-underline chip |

Dedupe per section. The extension list and extra regexes are config-extensible
(§1.4) but the defaults must be language-agnostic.

**Inline code spans are scanned by the file family, glossary terms are not.**
A fenced block is sample text and is skipped wholesale, but backticked text in
prose (`` `src/parser.ts::parse` ``) is an author pointing at a real file, and
technical documents write paths that way far more often than in bare prose — so
the file-path, `path::symbol` and test-id patterns match inside `inlineCode` too.
Glossary-term and alias matching stays plain-prose only: a term in backticks is
a literal string the author is quoting, not a concept being referenced.

### 6.6 Derived indexes
- **Search** (minisearch): sections (title boosted), body text, file paths,
  glossary terms + aliases. Per-section plain text kept for ±45-char snippets.
- **Backlinks**: `filePath → [section slugs]` mentioning it.
- **Glossary**: candidate headings (case-insensitive, exact): `Glossary`,
  `Terms`, `Terminology`, `Definitions`, `Appendix: Terms`. Merge entries
  across candidates; dedupe by normalized term; each entry's definition is
  its first paragraph.
- **Aliases (explicit only — never inferred)**: inside a glossary entry, a
  paragraph beginning `Aliases:` or `Alias:` lists comma-separated aliases.
  Aliases are exact, word-bounded chip/search triggers; display case
  preserved, matching lowercased. Never merge two terms by similarity.
  Example:

  ```text
  ### Measurement Run
  One execution of the frozen prompt pack.
  Aliases: MR, measurement run
  ```

### 6.7 Graph data — explicit DSL first, derivation second

Explicit (preferred, authoritative):

````text
```graph
nodes:
  browser: Browser
  api: API server | FastAPI
  db: Database
edges:
  browser -> api: fetch JSON
  api -> db
  api -.-> cache
```
````

Line grammar: `id: Label [| subtitle]` under `nodes:`; `a -> b [| label]`
(`-.->` = dashed) under `edges:`. Shapes:

```ts
type GraphSpec = {
  nodes: { id: string; label: string; sub?: string }[]
  edges: { from: string; to: string; label?: string; dashed?: boolean }[]
}
```

Parse failure → plain code block (§1.3).

**Derivation rule** (no explicit block): derive a "Document map" ONLY when
BOTH thresholds hold — ≥3 valid internal cross-links AND ≥3 distinct H2
sections appear as link source or target. Constants
`DERIVED_GRAPH_MIN_LINKS = 3`, `DERIVED_GRAPH_MIN_SECTIONS = 3` live in one
constants file. Nodes = H2 sections; edges = internal links (H3 links resolve
to parent H2; self-links ignored). Derived graphs carry an
`Auto-generated map` chip. Below threshold: `graph` capability off, nav
hidden. `features.graph` config (`auto` | `on` | `off`) overrides.

### 6.8 Steps DSL

````text
```steps
1. Browser event — user clicks a tile
2. Fetch — client calls the API @2.4
3. Route — framework handler resolves
```
````

`N. Title — description [@slug]`; the `@slug` adds a "source section" link
(validated; missing slug renders without the link, logs a dev-mode warning).
Parse failure → plain code block.

### 6.9 ASCII diagram detection (generic)
Untagged fences classify as `terminal` when ≥2 lines contain box-drawing
chars, or ≥1 line matches `^\s*\+[-=+]+\+$`, or ≥2 arrow lines plus
pipe/box lines. Render as a terminal window per DESIGN.md: surface `#0a0f1d`,
1px `--border-muted`, 4px radius, 32px header strip with file-path styling,
line numbers in `--text-subtle`, traffic-light dots, scanline overlay,
animated gradient on arrows.

## 7. Views & features

### 7.1 Reader (default) — `#/`, `#<slug>`
Fixed header: menu (drawer below 1280px), doc title, search trigger with `⌘K`
prompt (label-caps), reading-mode toggle, view switcher (graph/stepper **only
when capable**). Content column ~70ch; heading anchor links; in-app internal
link navigation with flash highlight; Shiki code blocks in the DESIGN.md code
container (32px header strip: file path `code-sm` in `--text-muted`, copy
action; line numbers; language tag); scrollable tables. **Acceptance:** every
fixture doc (§11) renders with zero console errors; internal anchors resolve
or degrade per §6.4.

### 7.2 Hero
Title (frontmatter > H1 > filename), description if present, generic stats
(reading time, sections, words, diagrams/code blocks), jump chips per H2.
Canvas grid texture (24px pitch, `--grid-line`) permitted; ambient particles
suppressed under reduced motion.

### 7.3 Metro-map TOC
Vertical rail in the 260px nav column: glowing dots per H2, ticks per H3;
fills with scroll; active node pulses with the DESIGN.md active-node treatment
(`--primary` stroke, `--accent-wash` fill, glowing pulse marker); click
navigates. Scrollspy drives TOC + fill + now-reading chip (bottom-left).
<1280px: drawer + scrim. Zero H2s → rail hidden.

### 7.4 Search + Cmd+K palette
Cmd/Ctrl+K or `/`. Level-3 elevation styling (§5.2). Groups: Sections / Files
/ Glossary (group only when capable). Static actions: switch view (capable
views only), toggle reading mode. Keyboard-complete (↑↓, Enter, Esc); focus
trap; spring-in (signature motion); focus restored on close.

### 7.5 Entity popovers + backlinks
Hover/focus on file/symbol/test/glossary chips → glass card (Level 2, blur
per §5.2): description (from a generic descriptions map — config-extensible,
empty by default → card shows backlinks only), "Mentioned in §x, §y" (click =
navigate + flash). Esc/leave dismisses.

### 7.6 Graph view — `#/graph` (capability-gated)
Lazy React Flow on the `--canvas` grid. Renders `doc.graph`: explicit →
"Architecture"; derived → "Document map" + `Auto-generated map` chip.
Workbench: nav rail (collapsible) + canvas + inspector panel 440px. Node
click → panel slides in: section title, first prose block, file chips,
"Open section" → reader at slug. Nodes per DESIGN.md metro spec (shell
`--surface-1`, 1.5px `--border-strong`; active: `--primary` stroke +
cyan→indigo gradient fill wash; edges 2px `--border-muted`, dash-array
gradient glow on hover/trace). Fit-view, zoom, pan. 768–1279px: 50/50
canvas/panel; <768px: segmented tabs. **Acceptance:** works for explicit and
derived graphs; keyboard: focusable nodes, Enter opens panel, Esc closes.

### 7.7 Stepper — `#/stepper` (capability-gated)
Renders `doc.steps`: horizontal desktop / vertical mobile; prev/next + ←/→;
progress dots; per-step number, title, description, optional source-section
link. Deep-linkable per step. Nav item hidden when no `steps` block exists.

### 7.8 Reading modes
**Reference** (all) | **Executive**: per H2 → title + first prose block + all
tables + blockquotes; H3s → title + first paragraph; code/terminal/mermaid/
lists hidden; per-section "show all" override. Transition animates; persists
in localStorage. Verify the heuristic on fixtures, not a fixed ratio (§11).

### 7.9 Theme (v1: dark only)
v1 ships the DESIGN.md dark theme exclusively. Token architecture keeps a
`[data-theme]` hook; **no theme toggle in v1**. Light theme is a v2 design
task. AA verified and Lighthouse run on the dark theme.

### 7.10 Chrome & delight
Gradient progress bar (`--gradient`); back-to-top after 600px; now-reading
chip. Delight (confetti at milestones, end celebration, Konami) behind one
`features.delight` flag; suppressed under reduced motion.

## 8. Motion rules
Motion explains structure, never decorates. Three signature moments total:
palette spring-in, graph panel transition, stepper transition. Everything
else ≤250ms ease-out; scroll reveals 500–600ms, fire once. Ambient loops
(metro glow, scanline, particles) slow and low-opacity.
`prefers-reduced-motion: reduce` → animation/transition: none, content
instant, confetti/particles never load.

## 9. Accessibility
Skip-to-content; landmarks; title = doc title. Palette/drawer: focus trap,
Esc, focus restore. Stepper: arrow keys. Graph: focusable labeled nodes.
Popovers: keyboard-focusable, Esc. AA contrast on the dark theme (chips and
muted text are the usual failures). Visible `:focus-visible` rings
(`--border-focus` + 2px outer ring per DESIGN.md input focus spec).

## 10. Performance budgets
Initial JS ≤ 200KB gz; React Flow, mermaid, confetti lazy chunks. Parse +
indexes in-memory; docs up to ~100k words parse <300ms on a mid laptop —
beyond that, stay functional (no worker in v1, but no regression). Fonts:
self-hosted subsets of Geist, Inter, JetBrains Mono, `font-display: swap`.
Lighthouse (reader, dark): **a11y ≥ 95**, and the four named metrics below.

### 10.1 Amendment A14 — the performance gate is four metrics, not a composite

**Ratified at M4.9.** Lighthouse (reader, **desktop** preset, dark), three
runs, every metric gated on the **median of the three**, hard fail:

| Metric | Ceiling |
|---|---|
| First Contentful Paint | ≤ 2000ms |
| Largest Contentful Paint | ≤ 2500ms |
| Total Blocking Time | ≤ 400ms |
| Cumulative Layout Shift | ≤ 0.1 |

**The composite performance score is still computed and still recorded** in
`artifacts/lighthouse.json` and in the CI log, for trend. It is **no longer the
gate.**

**Why the composite was replaced.** The composite is a weighted blend in which
TBT carries weight 30 and LCP weight 25 out of 100, so a real TBT regression is
diluted by FCP and CLS passing, and a real CLS regression is diluted by all
three passing. During M4.6 the app scored a stable **86, 88 and 82** on three
consecutive runs of one build — a 6-point spread on an unchanged artifact —
while the thing actually wrong, TBT, moved between 0.46 and 0.65. A gate on that
number is a gate on the weather. The four ceilings have the property the
composite lacks: each is a **measured quantity with an absolute meaning**, and
each moves only when that quantity moves.

**What this does not do.** It does not make the app faster. M4.9 changed a
threshold, not a byte. The measured numbers at ratification were FCP
1.6–1.8s, LCP 2.0–2.5s, TBT ~348ms, CLS 0 — three of the four already inside
their ceilings, with **LCP the binding constraint** and TBT close behind.

**The a11y gate is unchanged and independent**: ≥ 95, on the **worst** of the
three runs rather than the median, because an accessibility score does not vary
with machine load and averaging a real finding away would be the wrong instinct.


## 11. Testing — fixture-based (this enforces genericity)

`testdocs/` holds representative documents; parser/index tests run against
**all** fixtures:

| Fixture | Exercises |
|---|---|
| `minimal.md` (~30 lines) | H1 + 2 sections, no code, no links — Tier 0 only, no capability flags |
| `kitchen-sink.md` | tables, code, terminal ASCII, mermaid, loop, explicit graph, steps, glossary + `Aliases:`, entities, frontmatter — all capabilities on |
| `crosslinked.md` | NO explicit graph; ≥3 cross-links across ≥3 H2s → derived "Document map" capability |
| `no-structure.md` | prose only, no H2s — TOC/hero/search still work, rail hidden |
| `edge-cases.md` | duplicate headings (`-1` slugs), CJK + emoji headings, nested code fences, HTML in MD, self-referencing links, empty table, malformed `graph`/`steps`/`loop` blocks |

Tests:
1. **Per-fixture golden snapshots**: section tree (slugs, block kinds,
   counts), capability sets. Parsing regressions turn red.
2. **Slug vectors**: duplicates, punctuation, Unicode (generic vectors only).
3. **Capability detection**: `minimal` → none; `crosslinked` → graph
   (derived); `kitchen-sink` → all; `no-structure` → Tier 0 only.
   **This test is the genericity contract.**
4. **Derivation thresholds**: boundary test — 2 links → off; 3 links +
   3 sections → on; explicit block always wins over derivation.
5. **DSL degradation**: malformed blocks → `code` blocks, no throw.
6. **Glossary**: candidates merged; aliases extracted from explicit lines
   only; similar-but-unrelated terms are NOT merged.
7. **Extraction**: fixture-based expected chips; dedupe; no matches inside
   code blocks; extension-list config respected.
8. **Search smoke** per fixture: title hit, body hit, file hit, alias hit.
9. Component tests: TOC renders fixture sections; palette opens via Cmd+K;
   view switcher hidden for `minimal`; mermaid renders in dark theme.

CI: `typecheck → vitest → build`. Optional Playwright: load `kitchen-sink`,
open palette, open graph, toggle executive mode.

## 12. Build & deploy
`npm run build` → static `dist/`. Netlify/GH Pages; set `base` if not at
root. `file://` → drop screen is the designed path. v1 ingestion is local
only: fetch(docPath) or file drop → parse → document model → interactive map.

## 13. Milestones & acceptance

| M | Scope | Done when |
|---|---|---|
| **M0 Pipeline** | Vite scaffold, tokens.css (§5.2), remark pipeline, Doc model, capability detection, fixtures + tests 1–5 | All fixtures parse; capability + threshold tests green; reader renders `minimal.md` and `kitchen-sink.md` plainly |
| **M1 Reader** | Terminal/loop/mermaid blocks, Shiki+copy, tables, hero, metro TOC, scrollspy, chip, progress, loader/drop | §7.1–7.3, 7.10 acceptance; breakpoints (1280/768) behave per §5.3; budgets hit on `kitchen-sink` |
| **M2 Search + entities** | Palette, minisearch, popovers, backlinks, glossary + alias chips | §7.4–7.5 criteria; palette keyboard-complete; alias test (§11.6) green; `minimal.md` shows no entity UI |
| **M3 Graph + stepper** | Lazy React Flow, DSL parsers (§6.7–6.8), derived doc-map with thresholds, stepper view, workbench layout | §7.6–7.7 criteria; explicit-vs-derived boundary tests green; all referenced slugs validate |
| **M4 Modes + polish** | Executive/Reference, mobile pass, a11y audit, motion pass, delight flag, perf pass | §7.8 heuristics verified on fixtures; reduced-motion audit clean; budgets hold |

## 14. Risks

| Risk | Mitigation |
|---|---|
| Subtle hardcoding to the demo doc | Capability + threshold tests + fixture suite (§11); review checks for demo-specific strings outside `testdocs/` |
| Doc edits break rendering | Golden per-fixture tests; error card fallback |
| Two sources of truth | Only the loaded MD holds prose; only config holds UI mappings; both validated |
| DESIGN.md frontmatter/prose divergence | §5.2 table is canonical; frontmatter regenerated to match |
| Ref HTML becomes copy-paste legacy | Tokens extracted once; refs never imported |
| Bundle creep | Budgets + lazy chunks (§10) |
| DSL creep | Grammars frozen at v1 (§6.7–6.8); new needs → new block kinds |

## 15. Resolved decisions (record)

| Question | Decision |
|---|---|
| Derived document map | Yes, conditional (§6.7 thresholds) |
| Explicit vs derived graph | Explicit wins |
| Cross-link density | Required for automatic derivation (3 links / 3 sections) |
| Derived-map labeling | "Auto-generated map" chip |
| Multiple glossary sections | Yes — merged across candidate headings (§6.6) |
| Glossary aliases | Explicit `Aliases:` lines only; never inferred |
| `?doc=<url>` remote ingestion | **Deferred to v2** (CORS/security/size) |
| Light theme | **Deferred to v2** (no DESIGN.md values; `[data-theme]` hook kept) |
| Layout model | Two workbenches (§5.3); DESIGN.md breakpoints global |
| Mobile tabs | Docs / Visual Graph when capable — no Metrics tab |

**v2 backlog:** light theme design, remote-doc URL ingestion, multi-document
browsing, themes for Shiki/mermaid beyond dark.

**No open questions for v1.**
````

Ready to use. Three notes:

1. **§5.2 is the canonical token table** — if you haven't fixed the DESIGN.md frontmatter yet, either fix it per that table or just leave it; the spec now explicitly says the table wins, so the build can't be corrupted by the old MD3 values.
2. **The threshold boundary test (§11.4)** is the one most agents will skip — call it out when you review M3.
3. Kick off with **M0 only**, inputs = `docs/spec.md` + `designs/` + one sample MD, then run the genericity check: load an unseen README, confirm nothing breaks and nothing demo-specific renders.