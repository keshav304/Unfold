# Unfold

A generic interactive markdown explorer. Drop in any well-structured `.md`
document and get a reader: auto-generated navigation, hero statistics, a
metro-map table of contents, and — only when the document actually provides the
data — a graph view, a stepper, a glossary and entity chips.

## Getting a document in

`#/` **is** the front door, and `#/welcome` is the same view, permanently
linkable. Arriving at the root does not load anything: the configured document
is one click away, behind **Open the bundled document**. You are asked, rather
than served a document you did not ask for.

Two things still open a document directly, because both are requests for one:

- A **deep link** — `#/graph`, `#/stepper/2`, `#some-section`. Someone sent you
  a link to a place inside a document; you land in it.
- A **reload** while reading. Unfold remembers, per tab, that you have a
  document open, so refreshing at the top of a long document does not dump you
  back on the front door.

The drop handler is app-wide either way: dropping onto a document that is
already loaded replaces it.

- **Drop** any `.md`/`.mdx` onto the window, or use the file picker.
- The file picker button is the keyboard path and lives *inside* the drop zone.
  A drag target is unreachable by keyboard, so the button is the contract and
  the dashed card is only the affordance.
- If a `docPath` is configured, `#/welcome` also offers **Open the bundled
  document**; if a document is already in memory it is named as
  *Reading: …*.

> **Note on this file's location.** The repository root `README.md` is a
> *read-only demo document* (the same class of data as `ARCHITECTURE.md`), not
> the project's README, so the project README lives here. Nothing in `src/` may
> depend on either file.

**The document is data; the app is a renderer. Anything the document does not
provide, the app hides.** No feature is hardcoded to a particular document, and
three CI checks enforce that (`src/test/genericity.test.ts`).

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173 — reads ./unfold.config.json
```

`unfold.config.json` at the repo root is the only configuration, and every field
is optional:

```json
{
  "docPath": "./testdocs/kitchen-sink.md",
  "features": { "graph": "auto", "stepper": "auto" }
}
```

`"auto"` (the default) means capability-detected, `"off"` forces a view hidden,
`"on"` shows the nav item with an empty state. See `docs/spec.md` §1.4.

A deployment is `dist/` *plus the documents it is configured to read*. See
[Deploying](#deploying) for the full contract — what a host must do, and what
happens when `docPath` 404s.

Opening `dist/index.html` from `file://` is the designed third option: drag any
`.md` onto the window.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built artifact — **this is a deployment** |
| `npm test` | Vitest, once |
| `npm run ci` | **typecheck → vitest → build → ui-smoke → e2e → Lighthouse** — what CI runs |
| `npm run test:e2e` | Playwright against the built artifact |
| `npm run lighthouse` | The §10 gate: a11y ≥ 95 (worst of 3), and FCP ≤ 2s · LCP ≤ 2.5s · TBT ≤ 400ms · CLS ≤ 0.1 (median of 3) |
| `npm run print-doc -- <file>` | Print a parsed document as JSON (dev only) |
| `npm run stranger-test` | Parse every `node_modules` README (dev only) |
| `npm run ui-smoke [-- --stranger]` | Boot the **built** bundle over HTTP and report console errors |

## The zero-setup path

```bash
npm run build
npm run preview
# then drag any .md file onto the window
```

A static host cannot do this, because it is the host page that has to catch the
drop. Against a real host, the document is whatever `docPath` says:

```bash
npm run build
npx serve dist            # or python3 -m http.server -d dist
```

Open it, and the app fetches the configured document. If that 404s you get a
drop screen naming the path to fix, not a blank page.

---

## Configuration — every field, and what happens without it

`unfold.config.json` at the repository root, copied into `dist/` by the build.
**Every field is optional and zero-config works**: with no file at all the app
falls back to `./document.md`, and a `docPath` that is not found drops you onto
a screen where you can pick a file.

| Field | Type | Default | Effect |
|---|---|---|---|
| `docPath` | path or URL | `./document.md` | The document to read. Relative paths resolve against the deployed root. |
| `title` | string | the document's own | Overrides the parsed title. §7.2's chain is frontmatter → H1 → filename, and this beats all three. |
| `accent` | any CSS colour | `--primary` | Overrides the accent at runtime. |
| `features.graph` | `"auto"` \| `"off"` \| `"on"` | `"auto"` | `"auto"` = capability-detected; `"off"` hides the graph view; `"on"` shows the nav item with an empty state if the document has no graph. |
| `features.stepper` | `"auto"` \| `"off"` \| `"on"` | `"auto"` | Same, for the stepper. |
| `features.delight` | boolean | `true` | Confetti at reading milestones. `false` means the confetti chunk is **never requested**, not merely never drawn. |
| `features.diagrams` | `"auto"` \| `"terminal"` | `"auto"` | How an untagged ASCII fence is presented. `"auto"` parses it and renders a real diagram as SVG, keeping the terminal window for a fence the parser will not vouch for; `"terminal"` never parses, so every candidate renders as the terminal window it always did. The escape hatch. |
| `fileExtensions` | string[] | a built-in list | Which extensions count as file paths for entity chips. |
| `entityPatterns` | `{name, pattern}[]` | `[]` | Extra regexes, each with a global flag. An invalid pattern is warned about and skipped, never fatal. |
| `descriptions` | `{path: string}` | `{}` | Text for an entity popover. Empty by default, so a popover shows backlinks only. |

Invalid JSON is **never** fatal: the app logs one warning and runs on defaults.

```json
{
  "docPath": "./docs/architecture.md",
  "features": { "graph": "auto", "stepper": "off", "delight": true },
  "descriptions": { "src/app/App.tsx": "The shell. Owns the header, routing and chrome." }
}
```

---

## Authoring — how to get the rich views

Unfold reads **plain markdown that still reads correctly on GitHub**. Everything
below is an opt-in convention in a fenced code block or a heading; there is no
frontmatter required, no custom syntax to learn, and nothing that breaks if you
paste the file somewhere else.

### The blocks, and what each one buys you

| You write | You get |
|---|---|
| ` ```mermaid ` | A rendered diagram. Standard Mermaid, dark theme. |
| ` ```loop ` | An animated cycle diagram. Comma- or newline-separated labels. |
| ` ```graph ` | The **graph view** — an interactive architecture map. A small DSL, below. In the reader, a read-only mini-canvas with a link out to the full view. |
| ` ```steps ` | The **stepper view** — a deep-linkable lifecycle. Also a small DSL, below. In the reader, the same stepper, inline. |
| An untagged fence that draws boxes | A **diagram**: parsed and rendered as SVG, in the author's own layout. If it turns out not to be a diagram, a terminal window. |
| A `## Glossary` section (or anything matching a glossary heading) | Glossary chips in the prose, and a Glossary group in the palette. |
| A table | A horizontally scrollable, keyboard-reachable region. |
| A `src/…`, `*.ts`, `test.ts::name` mention in prose or in backticks | An entity chip with backlinks. |
| YAML frontmatter with `title` / `description` | Overrides the parsed title. |

**A view appears only if the document provides what it needs.** A document with
no `graph` block and too few cross-links has no graph view — not a broken one.
That is the whole design rule: *the document is data, the app is a renderer, and
anything the document does not provide is hidden rather than faked.*

### `graph` — the architecture map

```
```graph
nodes:
  shell: Client shell | entry point
  ingest: Ingest worker
  store: Index store | durable

edges:
  shell -> ingest | post
  ingest -> store | write
  store -.-> shell | backfill
```
```

`node-id: Label | subtitle` and `from -> to | edge label`, with `-.->` for a
dashed (back) edge. The graph renders as either an explicit **Architecture** or,
when there is no block and enough internal cross-links, a derived
**Document map** labelled *Auto-generated map*. A malformed block degrades to a
readable code block with a tooltip — never an exception, never a blank space.

### `steps` — the lifecycle

```
```steps
1. Submit — the shell posts a query [@runtime-shape]
2. Enrich — the worker resolves entities
```
```

`N. Title — description [@section-slug]`, where the `[@slug]` becomes a link to
that heading. Each step is deep-linkable (`#/stepper/2`).

### Glossary and aliases

Any `##`-level heading that reads as a glossary becomes one. The **first
paragraph** under a term is its definition, and an explicit `Aliases:` line adds
search keys:

```markdown
## Measurement Run

One execution of the pipeline, end to end.
Aliases: MR, run
```

Aliases are **never inferred** — only an explicit `Aliases:` line counts, so a
search for `MR` finds "Measurement Run" and a search for a word that merely
appears near it does not.

### What a document cannot ask for

- **A light theme.** Not per-document, not per-config. v1 is dark, and the
  tokens file says so once.
- **A remote URL.** `docPath` is a path the app can fetch from its own origin,
  or a file you drop. See [v1 limits](#v1-limits) for why.
- **Editing.** Documents are read, never written.
- **More than one document per load.** No doc switcher, no multi-doc navigation.

---

## Deploying

**A deployment is `dist/` plus the documents it is configured to read.** Nothing
else — no server, no database, no build step on the host.

```bash
npm run build
# upload dist/ to Netlify, GitHub Pages, S3, or anything that serves files
```

Three things the host must do, all of which every major static host does by
default:

1. **Compress.** `br` or `gzip` on text responses. This is not a nicety: the
   entry chunk is 136KB gzipped and 439KB raw, and the difference is most of
   the load time.
2. **Send correct MIME types** for `.js`, `.css`, `.woff2` and `.json`.
3. **Cache the hashed assets** in `/assets/*` forever, and do not cache
   `index.html`.

If your host is not at the domain root, set Vite's `base` and rebuild:

```ts
// vite.config.ts
export default defineConfig({ base: '/my-app/', plugins: [react(), shipDeployable()] })
```

If your document lives outside the app's directory, put it wherever you like and
point `docPath` at an absolute URL.

> A static host answers a request for a missing file with the app shell and
> **status 200**. Unfold treats any HTML response as *not found* rather than
> rendering its own page as content, and shows a drop screen naming the path to
> fix.

*Documented but not yet exercised on a real host; expect to debug these on
first deploy.* Deployment is not a release criterion.

---

## Using it

| Key | Does |
|---|---|
| `⌘K` / `Ctrl+K`, or `/` | Open the palette. Type to search sections, files and glossary terms; arrows and `Enter` to choose, `Esc` to close. |
| `Tab` | A skip link is the very first stop — the header, the rail and the chrome are all one `Tab` away from bypassable. |
| `←` `→` | Previous / next step, anywhere in the stepper. |
| `Enter` on a graph node | Opens the inspector; `Esc` returns focus to the node. |
| `Esc` | Closes the palette, the drawer, a popover or the graph panel — whichever is open. |
| `↑ ↑ ↓ ↓ ← → ← → b a` | There is confetti. It is off under `prefers-reduced-motion`, and `features.delight: false` stops the code being downloaded at all. |

**Two reading modes**, in the header and in the palette. *Reference* is the
whole document. *Executive* gives each section its title, its lead paragraph, its
tables and its blockquotes — code, diagrams and lists are hidden behind a
per-section **Show all**. The mode is remembered between visits, and nothing is
lost: turning it back off restores the document exactly.

The layout adapts at 1280px and 768px. On a phone the nav rail becomes a
drawer, the pane switch moves to its own row, and every control is at least
44px. **Reduced motion is honoured throughout** — the three signature animations
become instant, and the ambient loops and confetti do not run at all.

---

## What is in the box

- **Reader** — hero with reading time and jump chips, metro-map contents rail,
  scroll spy, progress bar, in-document links that flash where they land.
- **Search** — the `⌘K` palette over sections, file paths and glossary aliases,
  with highlighted matches and a snippet window.
- **Entity chips** — file paths, `path::symbol` and test ids become chips with
  backlinks. The description comes from `descriptions` in your config; a chip
  with no description shows its backlinks only.
- **Graph workbench** — React Flow on a grid canvas, with an inspector that
  slides in and an "Open section" that returns you to the reader. Below 1280px
  it overlays rather than reflowing, so the canvas never jumps.
- **Stepper** — a deep-linkable lifecycle, vertical on a phone.
- **Delight** — confetti at 25/50/75% of the document, an end-of-document
  celebration, and a code.

## v1 limits

These are decisions, not gaps in anyone's attention:

- **Dark theme only.** A light theme is a design task, not a toggle.
- **No remote-URL ingestion.** `docPath` is something the app can fetch from its
  own origin, or a file you drop. Fetching an arbitrary URL means CORS, SSRF and
  a size story.
- **No editing.** Documents are read, never written.
- **One document per load.** No doc switcher, no multi-document navigation.
- **No MDX, no CMS, no auth, no analytics, no server.** The document stays a
  plain `.md` that reads correctly on GitHub, which is the point.
- **Initial JS budget 200KB gzipped** (§10, enforced in CI), with the heavy
  renderers — React Flow, mermaid, Shiki, confetti — in separate lazy chunks.
- **A11y gate: Lighthouse ≥ 95 and zero axe violations on whole pages** at both
  desktop and phone widths.
- **Perf gate: four named metrics, not a score** — FCP ≤ 2.0s, LCP ≤ 2.5s,
  TBT ≤ 400ms, CLS ≤ 0.1, each the median of three Lighthouse runs on the
  desktop preset, each a hard fail. The composite performance score is still
  computed and recorded in `artifacts/lighthouse.json`, for trend. It is not
  the gate, because a composite lets a fast FCP buy off a layout shift.

## Project layout

```
src/pipeline/   markdown → Doc. Pure, no DOM, no React. The genericity lives here.
src/app/        the reader: shell, routing, block renderers, TOC, chrome.
src/styles/     tokens.css is the only file allowed to contain a colour literal.
src/test/       cross-cutting tests: genericity greps, budgets, breakpoints.
testdocs/       the fixtures. The source of truth for what the pipeline must handle.
scripts/        disposable dev tooling, not part of the app bundle.
```

`testdocs/` is authored data, not demo content: `minimal`, `kitchen-sink`,
`crosslinked`, `no-structure` and `edge-cases` between them exercise every block
kind, every capability boundary and every degradation path. CI asserts the
capability matrix for all five, so changing a fixture to make a feature appear is
a visible diff rather than a silent one.

## Design system

`src/styles/tokens.css` is the single source of colour, radius, elevation, type,
spacing and motion. No hex, `rgb()` or shadow literal may appear anywhere else —
`src/test/genericity.test.ts` fails the build if one does. Tailwind is wired to
the same custom properties, so a Tailwind class cannot smuggle a literal in
either.

## Further reading

`docs/spec.md` is the behavioural contract; `docs/plan.md` is the milestone
plan; `docs/DECISIONS.md` records every ambiguity that was resolved along the
way, and why.

## Status

P0 (bootstrap), M0 (content pipeline) and M1 (reader) are complete. M2 (search,
palette, entities), M3 (graph, stepper, workbench) and M4 (modes, mobile, a11y,
motion, release) are not started.
