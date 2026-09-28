# Unfold

**A generic interactive markdown explorer.** Point it at a well-structured `.md`
file and get a reader: generated navigation, reading-time hero, metro-map table of
contents, search, glossary chips — and, only when the document actually provides
the data, a graph view, a stepper, and inline diagrams.

> **The document is data. The app is a renderer.** Anything the document does not
> provide, Unfold hides rather than fakes. No feature is hardcoded to a particular
> document, and `src/test/genericity.test.ts` fails the build if a term from the
> bundled demo ever appears in app code.

```bash
npm install
npm run dev      # http://localhost:5173 — reads ./unfold.config.json
```

Then drop any `.md` file onto the window, or point `docPath` at one.

---

## Contents

- [Getting a document in](#getting-a-document-in) · [Configuration](#configuration)
- [Authoring](#authoring) — [blocks](#the-blocks-and-what-each-one-buys-you), [`graph`](#graph--the-architecture-map), [`steps`](#steps--the-lifecycle), [ASCII diagrams](#ascii-diagrams)
- [Using it](#using-it) — [keyboard](#keyboard), [reading modes](#reading-modes)
- [Deploying](#deploying) — [Vercel](#vercel), [any static host](#any-static-host), [analytics](#analytics)
- [Commands](#commands) · [Quality gates](#quality-gates) · [What's in the box](#whats-in-the-box) · [v1 limits](#v1-limits)

---

## Getting a document in

`#/` **is** the front door, and `#/welcome` is the same view, permanently
linkable. Arriving at the root loads nothing: the configured document is one click
away, behind **Open the bundled document**. You are asked, rather than served a
document you did not ask for.

Two things still open a document directly, because both are requests for one:

- A **deep link** — `#/graph`, `#/stepper/2`, `#some-section`. Someone sent you a
  link to a place inside a document; you land in it.
- A **reload** while reading. Unfold remembers, per tab, that you have a document
  open, so refreshing at the top of a long document does not dump you back on the
  front door.

- **Drop** any `.md` onto the window, or use the file picker. The picker button is
  the keyboard path and lives *inside* the drop zone: a drag target is unreachable
  by keyboard, so the button is the contract and the dashed card is the affordance.
- If a `docPath` is configured, `#/welcome` also offers **Open the bundled
  document**; if a document is already in memory it is named as *Reading: …*.
- Dropping onto a document that is already loaded replaces it.

Opening `dist/index.html` from `file://` works too — that is the zero-setup path,
because the host page itself catches the drop.

## Configuration

`unfold.config.json` at the repository root, copied into `dist/` by the build.
**Every field is optional and zero-config works**: with no file at all the app falls
back to `./document.md`, and a `docPath` that is not found drops you onto a screen
where you can pick a file. Invalid JSON is never fatal — it logs one warning and
runs on defaults.

```json
{
  "docPath": "./testdocs/kitchen-sink.md",
  "features": { "graph": "auto", "stepper": "auto", "diagrams": "auto" }
}
```

| Field | Type | Default | Effect |
|---|---|---|---|
| `docPath` | path or URL | `./document.md` | The document to read. Relative paths resolve against the deployed root. |
| `title` | string | the document's own | Overrides the parsed title (frontmatter → H1 → filename, and this beats all three). |
| `accent` | any CSS colour | `--primary` | Overrides the accent at runtime. |
| `features.graph` | `"auto"` \| `"off"` \| `"on"` | `"auto"` | `"auto"` = capability-detected; `"off"` hides the graph view; `"on"` shows the nav item with an empty state if the document has no graph. |
| `features.stepper` | `"auto"` \| `"off"` \| `"on"` | `"auto"` | Same, for the stepper. |
| `features.diagrams` | `"auto"` \| `"terminal"` | `"auto"` | How an untagged ASCII fence is presented. `"auto"` parses it and renders a real diagram as SVG, keeping the terminal window for a fence the parser will not vouch for; `"terminal"` never parses. The escape hatch. |
| `fileExtensions` | string[] | a built-in list | Which extensions count as file paths for entity chips. |
| `entityPatterns` | `{name, pattern}[]` | `[]` | Extra regexes, each with a global flag. An invalid pattern is warned about and skipped, never fatal. |
| `descriptions` | `{path: string}` | `{}` | Text for an entity popover. Empty by default, so a popover shows backlinks only. |

## Authoring

Unfold reads **plain markdown that still reads correctly on GitHub**. Everything
below is an opt-in convention in a fenced code block or a heading; there is no
frontmatter required, no custom syntax to learn, and nothing that breaks if you
paste the file somewhere else.

### The blocks, and what each one buys you

| You write | You get |
|---|---|
| ` ```mermaid ` | A rendered diagram. Standard Mermaid, dark theme. |
| ` ```loop ` | An animated cycle diagram. Comma- or newline-separated labels. |
| ` ```graph ` | The **graph view** — an interactive architecture map. In the reader, a read-only mini-canvas with a link out to the full view. |
| ` ```steps ` | The **stepper view** — a deep-linkable lifecycle. In the reader, the same stepper, inline. |
| An untagged fence that draws boxes | A **diagram**: parsed and rendered as SVG, in the author's own layout. If it turns out not to be a diagram, a terminal window. |
| A `## Glossary` section (or anything matching a glossary heading) | Glossary chips in the prose, and a Glossary group in the palette. |
| A table | A horizontally scrollable, keyboard-reachable region. |
| A `src/…`, `*.ts`, `test.ts::name` mention in prose or in backticks | An entity chip with backlinks. |
| YAML frontmatter with `title` / `description` | Overrides the parsed title. |

**A view appears only if the document provides what it needs.** A document with no
`graph` block and too few cross-links has no graph view — not a broken one.

A block that fails to parse degrades to a readable code block with a tooltip. Never
an exception, never a blank space.

### `graph` — the architecture map

````
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
````

`node-id: Label | subtitle` and `from -> to | edge label`, with `-.->` for a
dashed (back) edge. The graph renders as either an explicit **Architecture** or,
when there is no block and enough internal cross-links, a derived **Document map**
labelled *Auto-generated map*.

### `steps` — the lifecycle

````
```steps
1. Submit — the shell posts a query [@runtime-shape]
2. Enrich — the worker resolves entities
```
````

`N. Title — description [@section-slug]`, where `[@slug]` becomes a link to that
heading. Each step is deep-linkable (`#/stepper/2`).

### ASCII diagrams

An untagged fence that draws boxes is treated as a **diagram candidate** and parsed:

```
+------------------+        +-----------------+
| Client shell     | -----> | Ingest worker   |
+------------------+        +-----------------+
        |                            |
        v                            v
+------------------+        +-----------------+
| Query planner    | <----- | Index store     |
+------------------+        +-----------------+
```

The result is drawn **in the layout the ASCII already had** — the columns above are
the columns on screen. Unicode box-drawing (`┌ ─ │ ▼ ◀ ▶`) works identically and
normalises to the same roles without moving a cell.

The parser is deliberately conservative: it needs at least two boxes *and* at least
one connector whose both ends reach a real box, and anything it cannot vouch for
stays a terminal window rather than becoming a wrong diagram. Set
`features.diagrams: "terminal"` to turn the whole thing off.

## Using it

### Keyboard

| Key | Does |
|---|---|
| `⌘K` / `Ctrl+K`, or `/` | Open the palette. Type to search sections, files and glossary terms; arrows and `Enter` to choose, `Esc` to close. |
| `Tab` | A skip link is the very first stop — the header, the rail and the chrome are all one `Tab` away from bypassable. |
| `←` `→` | Previous / next step, anywhere in the stepper. |
| `Enter` on a graph node | Opens the inspector; `Esc` returns focus to the node. |
| `Esc` | Closes the palette, the drawer, a popover or the graph panel — whichever is open. |

### Reading modes

**Two modes**, in the header and in the palette. *Reference* is the whole
document. *Executive* gives each section its title, its lead paragraph, its tables
and its blockquotes — code, diagrams and lists are hidden behind a per-section
**Show all**. The mode is remembered between visits, and nothing is lost: turning it
back off restores the document exactly.

The layout adapts at 1280px and 768px. On a phone the nav rail becomes a drawer,
the pane switch moves to its own row, and every control is at least 44px. **Reduced
motion is honoured throughout** — the three signature animations become instant and
the ambient loops stop.

## Deploying

**A deployment is `dist/` *plus the documents it is configured to read*.** The build
copies the configured document into `dist/` and emits `<link rel="preload">` hints
for the config and the document, so the first render is not two round trips behind.
If `docPath` 404s, Unfold treats an HTML response as *not found* rather than
rendering its own shell as content, and shows a drop screen naming the path to fix.

### Vercel

```bash
npm run build     # dist/ is the output directory
```

Point the project at the repo root; the framework preset is Vite. The config and
the document are copied into `dist/` at build time, so the document ships with the
bundle and needs no separate hosting.

### Any static host

```bash
npm run build
npx serve dist            # or python3 -m http.server -d dist
```

Host `dist/` as the root. If you deploy under a sub-path, set the bundler `base` and
rewrite asset paths to match; the app's own routing is hash-based (`#/…`), so it
needs no server rewrite rules.

### Analytics

Web analytics is **on**, using
[Vercel Web Analytics](https://vercel.com/docs/analytics) (`@vercel/analytics`):
page views, the referrer, and coarse browser/device metadata. It is deliberately
boring about privacy:

- **No cookies, no cross-site identifier, no fingerprinting, no PII.**
- **Nothing about the document.** The app never sends the markdown a reader is
  looking at, a config path, or a query string.
- The script is deferred, so it never blocks first paint, and it is not in the
  preload graph.

`src/test/analytics.test.tsx` and `tests/e2e/analytics.spec.ts` assert those claims
rather than promising them, including that the cookie jar stays empty.

**To remove it:** delete the single `<Analytics mode="production" />` element in
`src/app/App.tsx` and drop the dependency. There is deliberately no config flag for
this — the honest way not to send analytics is not to ship the code that sends it.
Note that `/_vercel/insights/script.js` is served by the Vercel platform, not by
this repository; the dev server and the test harness both answer it locally so that
a correct request does not read as a 404.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built artifact — **this is a deployment** |
| `npm test` | Vitest, once |
| `npm run ci` | **typecheck → vitest → build → ui-smoke → e2e → Lighthouse** — what CI runs |
| `npm run test:e2e` | Playwright against the built artifact |
| `npm run lighthouse` | The performance gate: a11y ≥ 95 (worst of 3), and FCP ≤ 2s · LCP ≤ 2.5s · TBT ≤ 400ms · CLS ≤ 0.1 (median of 3) |
| `npm run ui-smoke [-- --stranger]` | Boot the **built** bundle over HTTP and report console errors |
| `npm run diagrams:coverage [-- --shots]` | Parse every terminal-candidate fence in `testdocs/` and report how many are real diagrams; `--shots` also screenshots each one as the served app renders it |
| `npm run print-doc -- <file>` | Print a parsed document as JSON (dev only) |
| `npm run stranger-test` | Parse every `node_modules` README (dev only) |
| `npm run profile:perf` | Profile the mount, median of 3 at 4× CPU throttle |

## Quality gates

These run in `npm run ci`, and they are budgets rather than aspirations:

| Gate | Threshold | Enforced by |
|---|---|---|
| Entry bundle | ≤ 200KB gzipped | `src/test/budget.test.ts` (it builds, then measures) |
| Dependencies | every one justified in writing | `src/test/genericity.test.ts` |
| Genericity | no demo-document term may appear in app code | `src/test/genericity.test.ts` + a denylist |
| Accessibility | Lighthouse a11y ≥ 95 **and** zero axe violations on whole pages, at desktop and phone width | `npm run lighthouse`, `tests/e2e/a11y.spec.ts` |
| Performance | FCP ≤ 2s · LCP ≤ 2.5s · TBT ≤ 400ms · CLS ≤ 0.1 (median of 3) | `npm run lighthouse` |
| Motion | exactly three signature moments, everything else ≤ 250ms, ambient loops slow, all neutralised under reduced motion | `src/test/motion.test.ts` |
| CLS in the reader | 0.000 | `tests/e2e/cls.spec.ts` |
| Console | no errors or warnings on any page | every Playwright scenario |

## What's in the box

- **Reader** — hero with reading time and jump chips, metro-map contents rail,
  scroll spy, progress bar, in-document links that flash where they land.
- **Search** — the `⌘K` palette over sections, file paths and glossary aliases, with
  highlighted matches and a snippet window.
- **Entity chips** — file paths, `path::symbol` and test ids become chips with
  backlinks. The description comes from `descriptions` in your config; a chip with no
  description shows its backlinks only.
- **Graph workbench** — React Flow on a grid canvas, with an inspector that slides in
  and an "Open section" that returns you to the reader. Below 1280px it overlays
  rather than reflowing, so the canvas never jumps.
- **Stepper** — a deep-linkable lifecycle, vertical on a phone.
- **Diagrams** — Mermaid, cycle loops, an inline read-only graph canvas, an inline
  stepper, and parsed ASCII art drawn as SVG.
- **Code** — Shiki highlighting in the `github-dark` theme, lazily, with a copy
  button and a language label.

## v1 limits

These are decisions, not gaps in anyone's attention:

- **Dark theme only.** A light theme is a design task, not a toggle.
- **No remote-URL ingestion.** `docPath` is something the app can fetch from its own
  origin, or a file you drop. Fetching an arbitrary URL means CORS, SSRF and a size
  story.
- **No editing.** Documents are read, never written.
- **One document per load.** No doc switcher, no multi-document navigation.
- **No MDX, no CMS, no auth, no server.** The document stays a plain `.md` that
  reads correctly on GitHub, which is the point.
- **Initial JS budget 200KB gzipped**, with the heavy renderers — React Flow,
  mermaid, Shiki — in separate lazy chunks.
- **A11y gate: Lighthouse ≥ 95 and zero axe violations on whole pages** at both
  desktop and phone widths.
- **Perf gate: four named metrics, not a score** — FCP ≤ 2.0s, LCP ≤ 2.5s,
  TBT ≤ 400ms, CLS ≤ 0.1.

---

### Notes for anyone reading this repository

- **`ARCHITECTURE.md` at the root is a demo document**, not project documentation.
  It is the same class of data as `testdocs/*.md` and exists so Unfold has a large,
  link-dense document to render; `src/test/genericity.test.ts` reads it.
- **`docs/` and `designs/` are local-only** and are not in this repository. The spec,
  the decision log, the milestone plan and the design screenshots the work was
  reviewed against live on the machine that built the thing. The section numbers the
  code comments cite (`§6.9`, `§7.8`, `§9`, `§10.1`, and so on) are that spec's
  numbering and still line up.
