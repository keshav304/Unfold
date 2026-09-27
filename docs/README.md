# Unfold

A generic interactive markdown explorer. Drop in any well-structured `.md`
document and get a reader: auto-generated navigation, hero statistics, a
metro-map table of contents, and — only when the document actually provides the
data — a graph view, a stepper, a glossary and entity chips.

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

## Deployment

```bash
npm run build    # → dist/
npm run preview  # serves dist/ exactly as a static host would
```

**A deployment is `dist/` *plus the documents it is configured to read*.** The
build copies `unfold.config.json` into `dist/`, and copies `testdocs/` into
`dist/testdocs/` when the configured `docPath` points there, so the relative
`docPath` resolves unchanged on the host. If you point `docPath` at your own
document, put that file into `dist/` yourself or host it elsewhere and set an
absolute URL.

> A static host answers a request for a missing file with the app shell and
> **status 200**. The loader treats any HTML response as *not found* rather than
> rendering our own page as content (spec §6.1, amendment A5), and shows the
> drop screen naming the path to fix.

Opening `dist/index.html` from `file://` is the designed third option: drag any
`.md` onto the window.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built artifact |
| `npm test` | Vitest, once |
| `npm run ci` | **typecheck → vitest → build** — what CI runs |
| `npm run print-doc -- <file>` | Print a parsed document as JSON (dev only) |
| `npm run stranger-test` | Parse every `node_modules` README (dev only) |
| `npm run ui-smoke [-- --stranger]` | Boot the **built** bundle over HTTP and report console errors |

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
