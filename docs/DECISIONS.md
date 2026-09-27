# DECISIONS.md

Ambiguities found while building P0 + M0, and the smallest decision taken for
each. One line per entry: **question / decision / why**. Spec §0 precedence:
behaviour → `docs/spec.md`; visuals → design refs. Where the two conflict, the
spec wins.

---

## Tokens & visual system

**DESIGN.md frontmatter carries Material-3 values that disagree with its own
prose palette** / Use the spec §5.2 table verbatim / Spec §5.2 says the table is
canonical and the frontmatter is stale.

**`tokens.css` also carries radii, elevation, spacing, type and motion, not just
the §5.2 colours** / Put every visual constant in that one file / The hard rule
is "no literal outside `tokens.css`"; splitting literals across two files would
break it.

**Tailwind is wired to CSS custom properties rather than to literal hex** /
`tailwind.config.js` maps `colors` to `var(--…)` / A Tailwind class that inlined
a hex value would be a literal outside `tokens.css`.

**Fonts ship as variable subsets via `@fontsource-variable/*`** / Self-hosted
woff2 subsets only / Spec §10 requires self-hosted subsets with `font-display:
swap`; `@fontsource` emits exactly that with no runtime font host.

---

## Pipeline

**`unfold.config.json` is parsed but never fetched by the pipeline** /
`parseConfig` is a pure string→config function; the app decides when to read the
file / The pipeline is a pure function of markdown text (spec §6.2); I/O belongs
to the loader.

**`Doc` carries `titleSource`, `stats`, `indexes` and `unresolvedLinks`, which
§6.3 does not list** / Added them, keeping every §6.3 field exactly as specified
/ Each is derivable-from-content data the UI cannot compute without re-walking
the AST (the §7.2 title fallback chain, hero stats, §6.6 indexes, §6.4
unresolvable links). Nothing is invented; all are functions of the source.

**A glossary definition is the entry's *first paragraph*, not all of them** /
Stop at the first prose block / Spec §6.6 says "each entry's definition is its
first paragraph" verbatim.

**An `Aliases:` line is detected per *line*, not per paragraph** / Split a
paragraph's plain text on newlines before looking for the prefix / A soft line
break is still one mdast paragraph, so the spec's own example (`Definition.`
newline `Aliases: …`) would otherwise be swallowed whole.

**Headings deeper than H3 are flattened to prose inside their section** / Keep
the words, drop the level / The data model has exactly two levels (§6.3); a
third would be invented structure.

**An H3 that appears before any H2 is promoted to the top level** / Promote /
The alternative is to drop the section, and dropping content is worse than
flattening it.

**A second H1 is a document boundary, not a section** / Its text is kept as prose
in the introduction / There is exactly one title slot (frontmatter > H1 >
filename, §7.2); a second H1 is content, not structure.

**`loop` blocks with fewer than two labels are a parse failure** / Require ≥2
labels, degrade to `code` otherwise / A one-label cycle is not a cycle; §1.3
degradation exists precisely for this.

**A `graph` block with a `nodes:` section and an empty `edges:` section is
valid** / Accept it as a single-node graph / The §6.7 grammar makes edges
optional in effect; inventing a "must have an edge" rule would reject a
legitimate graph.

**`steps` accepts both `[@slug]` and a bare trailing `@slug`** / Accept both /
§6.8 states the grammar as `[@slug]` but its own worked example writes `@2.4`
bare. Supporting both costs one regex and honours either authoring style.

**A `steps` `@slug` that does not resolve is not a parse failure** / Keep the
step, drop the link, warn / §6.8 says exactly this: "missing slug renders without
the link, logs a dev-mode warning".

**Test ids require a `::symbol`; a bare `a.test.ts` is an ordinary file path** /
Require the symbol / §6.5's row reads "detected path + `::` + identifier". Test
-ness comes from either the identifier (`test_`) or the path
(`.test.`/`.spec.`).

**URLs are stripped before path matching** / Remove `scheme://…` spans first /
Otherwise `https://example.com/guide/intro.md` invents a local file chip — a
false positive, which §1.1 exists to prevent.


---

## Slugs (§6.4)

**The spec's prose rule and GitHub's real algorithm disagree about `_`** / Keep
underscores / §6.4's stated intent is GitHub parity, and `github-slugger`'s
removal set keeps `_`; the prose summary is the approximation.

**A dropped character leaves the space that surrounded it** / Do not re-trim
after removal / GitHub does not, which is why `🚀 Launch` → `-launch`. The
required vector in the brief depends on this.

**Runs of spaces become runs of hyphens** / No collapsing / `Known divergences &
errata` → `known-divergences--errata` is a required vector.

**Slug state lives in a `Slugger` instance, one per document** / Instance
counters, not module state / Two documents parsed in one process must not share
duplicate counters.

---

## Testing

**The genericity greps (`hex outside tokens.css`, demo strings in `src/`) are run
by hand, not in CI** / Out of scope for M0 / They belong with the M1 component
work, when there is UI to grep. Logged here so the omission is deliberate and
visible.

**Warnings are collected in a swappable sink rather than logged directly** /
`setWarningSink` / §1.3 requires a dev-mode warning; tests must be able to assert
on it without console noise.

**Table cells are scanned for entities; fenced and inline code are not** / Cells
are prose islands / §6.5 only forbids scanning *code blocks*; a path in a table
cell is a mention, a path in a fence is sample text.

**A test id's path counts toward the document-wide `entities` threshold** / Count
both `files` and `tests` paths / §1.1 says "≥3 file-path matches across the doc"
without exempting tests.

**A `graph` or `steps` block above the first H2 still enables its capability** /
Scan the introduction too / The document provided the block; where it sits in the
outline is irrelevant to whether the feature has data.

**Link hrefs are matched case-insensitively and normalised to the canonical
slug** / Lowercase the href, look it up, rewrite / GitHub anchors are
case-insensitive, and `linksTo` must be resolvable for §6.4 to hold.

**`edges:` lines use `a -> b | label`, not `a -> b: label`** / `|` only / §6.7's
grammar is `a -> b [| label]`.

---

## Ratified amendments (M1 kickoff)

**A1 — §6.4 slug algorithm** / The spec's prose summary was replaced with the
`github-slugger` algorithm, stating explicitly that underscores are retained and
that a dropped character leaves its surrounding space / Docs only; the code
already did this. The prose summary and the real algorithm disagreed on `_`, and
§6.4's stated intent is GitHub parity.

**A2 — §6.5 inline code spans** / Fenced blocks are still skipped wholesale, but
the file family (path, `path::symbol`, test id) now also matches inside
`inlineCode`; glossary terms and custom config patterns stay prose-only /
Technical documents write paths in backticks far more often than in bare prose,
so the old rule found almost nothing: `entities` fired on 7 of 238 real-world
READMEs. A backticked term, by contrast, is a literal the author is quoting, not
a concept being referenced. `extractEntities` now takes `{ prose, inline }`
instead of a flat run list.

---

## M1 — reader

**`gray-matter` was removed; frontmatter is split in-house and read with
`js-yaml`** / A dozen-line `---` splitter plus `js-yaml` / The CommonJS default
export of `gray-matter` did not survive the browser build. In a real page the
parse threw, the pipeline's catch fell back to the raw source, and the YAML
block rendered as visible document text with the title silently dropping to the
H1. Every unit test passed, because they run in Node. Only booting the *built*
bundle in a DOM caught it. `js-yaml` is pure JS and behaves identically
everywhere.

**`unfold.config.json` stays at the repo root and is copied into the build by a
small Vite plugin** / A 12-line plugin in `vite.config.ts` / §1.4 names the repo
root, and duplicating the file under `public/` would create two sources of
truth for a file that changes.

**Table cells render as plain text** / §6.3 models a cell as `string`, so
inline formatting inside a cell has no AST to preserve / Changing the data model
to keep cell ASTs is a pipeline change with a spec amendment behind it. The text
itself is always right, which is what the fixture asserts.

**`graph` and `steps` blocks render as their source in the reader** / Degrade
per §1.3 / Their views belong to M3, and the brief forbids scaffolding them.
Showing the DSL keeps the content visible and invents no UI.

**Raw HTML renders as source, never as live markup** / A `<pre>` block / §4
allows `dangerouslySetInnerHTML` only for a sanitised `<br>`. Rendering document
HTML would be an injection surface, so `<details>` in `edge-cases.md` shows as
text.

**Scrollspy uses explicit geometry, not IntersectionObserver** / A scroll
listener plus a 96px line, with the bottom-of-document case handled directly /
The brief calls this out: at the end of a page the last section can be shorter
than the viewport and never reach an observer's trigger line, so the last H2
must be assigned explicitly. `App.test.tsx` locks the boundary down.

**The `devDependencies`/`dependencies` allowlist lives in the test, not in
config** / `genericity.test.ts` / A dependency check that reads its own
allowlist from `package.json` would be circular.

**Mermaid carries `data-theme="dark"` in every render state** / One attribute on
the figure, not per branch / The §11.9 requirement is that mermaid renders in
the dark theme; making the theme a property of the block rather than of a
branch means the pending and failed states cannot drift.

**A denylist term must be *identifying*** / "Table of contents" was removed from
`genericity-denylist.json` / It is ordinary UI vocabulary, and a guard that
fires on ordinary words trains people to ignore it. The JSON file now says so.

---

## M1.9 — preview-mode defects

**A 200 response whose body is HTML is treated as not-found (A5)** / Rejected in
the loader, before parsing / A static host answers a missing file with the app
shell and status 200, so a wrong `docPath` produced a confident, entirely
fictional zero-section reader titled from the filename — a failure that looks
like success. Either signal suffices: a `text/html` content type, or a body
beginning `<!doctype html`/`<html` within 256 bytes. The header wins even when
the body is real markdown, which means a host that serves `.md` as `text/html`
is refused: a false negative, which §1.1 prefers over a fictional document.

**The build copies `testdocs/` into `dist/` when the configured `docPath` points
there** / A `closeBundle` step, conditional on the config / The committed config
references `./testdocs/kitchen-sink.md`, which did not exist in `dist/`, so even
the *correct* path hit the SPA fallback. The deployable unit is `dist/` plus the
documents it is configured to read; `budget.test.ts` now asserts the configured
path exists in `dist/` and is byte-identical to the source of truth.

**`ui-smoke` fetches over HTTP from a real static server** / An in-process
`node:http` server with SPA fallback, a path-traversal guard and a second mount
for documents outside `dist/` / It previously booted `dist/` in jsdom but handed
the document over through a `fetch` stub, which is exactly why A5 escaped 545
tests: a stub cannot reproduce a static host answering a miss with the app
shell. It now includes a deliberately missing `docPath`, and asserts the shell
is refused rather than rendered. Verified by disabling A5: the smoke test
reproduces the original defect (`title: Nope`, 0 sections) and fails.

**The rail is absent, so the grid must be** / `.app-body[data-rail='false']` /
When a document has no H2s the TOC renders nothing, but the two-column grid
still reserved the 260px rail column — the content fell into it and the main
area stayed empty. Declared at the top level rather than inside a media query
so the collapse holds at every breakpoint.

**The project README is `docs/README.md`** / The root `README.md` is a read-only
demo document, the same class of data as `ARCHITECTURE.md` / Overwriting it with
project documentation would destroy demo data and put words in the reader's
corpus that the app is supposed to treat as arbitrary input.

**The duration check walks declarations, not raw text** / PostCSS `walkDecls` /
A regex over the stylesheet matched the "H2s" in a comment as a 2-second
duration. The rule is about CSS values; prose in comments is not a value.

---

## M2 — search, palette, entities

**A3: a table cell is a list of inline runs, not a string** / `header: InlineRow`,
`rows: InlineRow[]`, where an `InlineRun` is `InlineNode[]` — the same
`PhrasingContent` the prose renderer walks / The spec's §6.3 `rows: string[][]`
made a cell unrenderable as prose: a backticked path in a cell and a bare path in
a cell were indistinguishable, so §6.5's inline-code rule (A2) could not reach a
cell at all, and §7.5's chips had nothing to attach to. One cell type fixes
prose, chips and extraction at once. `html` children are dropped from a cell
because `PhrasingContent` has no slot for them and raw HTML is rendered as source
anyway (§4).

**Entity extraction walks a cell's runs instead of pushing its text into both run
sets** / `collectProseRuns` / `collectInlineRuns` per cell / The old code pushed
every cell's flat text into *both* the prose and the inline set, which asserted
"this text is simultaneously a plain-prose mention and a backticked one" — a lie
the renderer then had to undo. The file family still reads both sets, so no
entity is lost; only the fiction is. `entities.test.ts` asserts the real split.

**The golden snapshots now record table cell text** / `sectionTree` gained a
`cells` field / Without it A3 was invisible to §11.1: the snapshots recorded
block *counts* only, so a cell silently losing its content, or a backticked cell
degenerating to a bare one, would have left every snapshot green.

**A3's cell type is nested two deep, deliberately** / `InlineRow = InlineRun[]` /
A row holds cells and a cell holds runs, so `header` is one `InlineRow` and
`rows` is `InlineRow[]`. A flat `InlineNode[][]` reads as "rows of runs" and
silently drops a dimension, which is what the first attempt did.

**The renderer reuses `extractEntities` for chip matching instead of its own
regexes** / Patterns recovered as offsets / §6.5's definition of "a file path"
must have exactly one owner. The renderer asks the pipeline which spans match
and only recovers their offsets, so a chip can never appear on a string the
extractor never recorded — the "fictional entity" failure §1.1 exists to prevent.
The first implementation carried its own patterns and the two would have drifted.

**`InlineContext.fileExtensions` is required, not optional** / No default /
`extractEntities` treats an empty extension list as "nothing is a file", so an
optional field that defaulted to `[]` produced a page with glossary chips and
*zero* file chips — a failure that looks like "this document has no entities"
rather than a bug. The field is required so the compiler catches the omission;
the test suite caught it here.

**A `body` search record is a hit, not a place, so it joins the section group**
/ `groupOf` maps `body` to `section`, deduped by slug / §6.6 indexes one `body`
record per section so prose is findable at all. Rendering those as their own
rows showed the same place twice; dropping them made body text unsearchable
altogether. They collapse onto the section's row, and whichever record MiniSearch
ranked first supplies the snippet.

**The introduction is indexed under the slug `intro`** / `INTRO_SLUG`, with a
real `#intro` anchor in the reader / Its `body` record previously carried an
empty slug, so a hit on the introduction resolved to nowhere. §6.3 gives the
introduction no heading and therefore no slug of its own, but it is real content
with a real place on the page, and `#intro` is a better answer than dropping the
record.

**A palette result navigates through `navigate()`, not the raw `onNavigate`
callback** / The callback only flashes and scrolls / The hash is what makes a
result linkable and what the back button reads. Calling the callback directly
produced a palette that scrolled correctly and never touched the URL — invisible
in jsdom until a test asserted on `location.hash`.

**cmdk renders with `shouldFilter={false}`** / The rows are already filtered by
MiniSearch / cmdk's own `command-score` pass would re-filter a ranked list and
silently drop rows the index deliberately put there, including fuzzy and prefix
matches. The app's index is the single authority for what matches.

**A popover is portalled to `<body>` and positioned `fixed`** / One code path for
prose, lists and table cells / A chip in a table cell sits inside the reader's
`overflow-x: auto` wrapper, which clips an absolutely positioned descendant. A
portalled fixed element is positioned against the viewport and clipped by nothing,
so the popover does not break in exactly the place a technical document puts
most of its paths.

**An empty popover says "Not mentioned anywhere else"** / Rather than rendering
an empty card / With the descriptions map empty by default (§7.5), a file
mentioned once would otherwise open a blank box over the reader's text. An empty
card is the clearest possible claim that the document contains nothing more to
say, and it is false.

---

## M2.PW — the Playwright verification layer

**Playwright is pinned to 1.61.1, the newest release that still supports Node 18**
/ 1.61.1, not 1.62+ / `@playwright/test@1.62.0` declares `engines.node >= 20` and
this project's Node is 18.20.8. The brief says not to upgrade Node unilaterally,
so the newest *compatible* version is the correct answer rather than a reason to
stop. Revisit at the Node bump, not before.

**Lighthouse is pinned to 12.8.2 and run through `npx`, not a declared
dependency** / `npx --yes lighthouse@12.8.2` / The M2 brief authorises exactly
three new packages, and Lighthouse brings a large tree. Lighthouse 13 pulls in
`yargs` / `cliui` / `string-width` versions declaring `engines.node >= 20`, so
12.8.2 is the newest release that runs on this Node. Same rule as Playwright:
newest *compatible*, and a note to revisit at the Node bump.

**The test host's document is chosen over HTTP, not through a module-level
setter** / `GET /__set-doc-path?docPath=…` / Playwright loads `global-setup.ts`
and the spec files through *different module registries*, so a `servedDocPath`
variable set by a test is not the variable the running server reads. The first
three scenarios therefore silently served the default document — one of them
asserted a drop screen and got a fully rendered reader. A request crosses the
process boundary explicitly, and the host sends `cache-control: no-store` so
Chromium cannot serve scenario 2's document to scenario 3.

**cmdk's list DOM is repaired after mount, attributes only** / `role` attributes
on its wrapper `div`s / `Command.List` renders `role="listbox"` and `Command.Item`
renders `role="option"`, but cmdk inserts un-roled `div`s between them, which
breaks ARIA ownership (`aria-required-children`, critical — a listbox announced
as empty). `role="presentation"` does *not* satisfy the rule: axe rejects a
presentation child of a listbox too. So the sizing wrapper becomes a `group` and
the group wrappers become `presentation`, leaving `listbox > group > option`.
Restructuring the nodes instead is not an option: the rows are children of the
wrapper, so removing it takes the list with it, and React throws on the next
render.

**cmdk's list also needs `--cmdk-list-height`, and we do not provide it** /
Deliberate / The sizing wrapper exists only to publish that CSS variable, which
this app's stylesheet does not read. Dropping it is safe: cmdk guards its mount
effect on the wrapper being present and no-ops its scroll path without it.

**The budget test builds with `NODE_ENV=production` explicitly** / Vitest sets
`NODE_ENV=test` for every child / It had been measuring a **test-mode** bundle
since M0: Vite substitutes `process.env.NODE_ENV` at build time, so the dev
branches survive and the tree-shaking that makes the shipped bundle small never
happens. Same application, 681KB raw / 204.8KB gz in test mode against 418KB raw
/ 132.4KB gz in production. It only surfaced when M2's palette, chips and popovers
pushed the inflated figure past 200KB — the budget had been green against a
number nobody ships.

**Reference links (`[label][ref]`) resolve from the document's definitions, and
an unresolved one keeps its label** / `Doc.linkDefinitions` / The stranger round
found it: a `linkReference` node carries no `value`, so it fell through to the
default branch and rendered as *nothing* — ``See [`contributing.md`][ref]`` came
out as "See  in…", deleting the author's text and any chip inside it. Reference
links are common in exactly the READMEs this app is pointed at. Definitions live
on the mdast root, out of the node tree, so they are carried on the `Doc`; an
unresolved reference degrades to its label, which is the same rule §6.4 sets for
internal links and the only one that does not drop words.

**A link's children render with the context** / `childrenOf(node, context)` in the
external-link branch too / The branch dropped it, so a file path inside
`See [src/a.ts](https://…)` got no chip and a nested `#slug` link inside an
external link silently stopped resolving. The internal-link branch passed it; the
external branch simply did not.

**`color-contrast` is a known a11y finding owned by M4.3, and the axe gate names
it rather than hiding it** / `KNOWN_OWNED_BY_M4_3` in `tests/e2e/palette.spec.ts` /
Plan §9 assigns "AA on chips + muted text (the usual failures)" to M4.3, and
fixing it means changing `--text-muted` / `--text-subtle` design tokens for the
whole system. The Playwright scan fails on *any other* audit and prints the known
one, so the debt is visible and counted rather than absent. Lighthouse — the
threshold the spec actually states — scores 96 and passes.

**`landmark-unique` on table scrollers was fixed here, not deferred** / Each
`role="region"` is named after its own header row / Two regions both called
"Table" is a real defect (a screen-reader user cannot tell them apart) and the
fix is three lines and derived from the document. It was the other M4.3-adjacent
finding the axe scan surfaced, and unlike contrast it needed no token change.
