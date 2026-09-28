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

**`--text-subtle` is INACTIVE/DECORATIVE ONLY; all nine current uses move to
`--text-muted`, and no intermediate token is minted** / Decided at G3, applied in
M4.3 / The value is the spec §5.2 canonical `#475569` and does not change; only
the usage contract does.

*Why the token, not component CSS.* The nine uses are not nine independent
judgement calls — they are one misreading of what the token means, repeated.
`tokens.css` said "disabled, line numbers" and every later use took "line numbers"
as licence to reach for it for anything faint. A per-component fix would leave
the same trap armed for the next contributor.

*The measurements* (computed, not estimated, across the four surfaces the app
uses): `--text-subtle` gives 2.56:1 on `--canvas`, 2.36:1 on `--surface-1`,
2.52:1 on `--code-surface` and 1.93:1 on `--surface-2`. AA requires 4.5:1, and
every size in the scale — `--text-code-sm` 11px, `--text-body-lg` 14px,
`--text-label-caps` 10px — is normal text, so the 3:1 large-text allowance is
never available. `--text-muted` gives 7.58 / 6.96 / 7.45 / 5.71:1 on the same
four, clearing AA everywhere with headroom, including on the popover surface.
There is therefore **no compliance argument for an intermediate value**, and
`aria-hidden` is not an exemption: contrast applies to visible text whether or not
it is in the accessibility tree, which is why the `⌘K` hint was flagged.

*Why not mint `--text-faint` (~#7d8ba1).* The only reason to would be to keep
four legible steps, and the one place the lost step mattered is the TOC, where
H2 `--text-muted` sat one step above H3 `--text-subtle`. That hierarchy never
depended on colour: H2 is 16px Inter, H3 is 11px mono with an 8px indent and a
tick, and each has its own active treatment (H2 → `--text-high`, H3 →
`--primary`). Collapsing the colour step costs nothing a reader can perceive and
buys a five-name scale becoming a four-name one, with a three-step legible ramp
that is easier to apply correctly than a four-step one. A new name plus a new
value chosen by eye, for no compliance gain, is the more expensive option.

*The migration, so M4.3 is mechanical* — every use of `--text-subtle` in
`src/styles/reader.css`, all of which are informational:

| Site | What it is |
|---|---|
| `.app-search__kbd` | the `⌘K` hint in the header |
| `.hero-stat dt` | the READ / SECTIONS / WORDS stat labels |
| `.toc-head__label` | the rail's `CONTENTS` label |
| `.toc-child` | H3 entries in the rail — real navigation |
| `.toc-now-reading .t-label-caps` | the `NOW READING` label |
| `.inline-link--unresolved` | §6.4's "muted" unresolvable internal link |
| `.code-line-number` | code line numbers |
| `.terminal-line-number` | terminal line numbers |
| `.palette-input::placeholder` | the palette's search placeholder |

`.inline-link--unresolved` is the one that makes the case: §6.4 says an
unresolvable link renders as *muted* text, and the code was using a token
darker than the one the spec's own word denotes.

*Definition of done for M4.3, so this cannot regress:* the migration, **plus**
deleting `KNOWN_OWNED_BY_M4_3` from `tests/e2e/palette.spec.ts` so the axe gate
returns to zero violations, **plus** a `tokens.test.ts` guard that fails if
`--text-subtle` appears in any stylesheet rule outside an explicit
inactive/decorative allowlist. The guard is what makes the decision executable
rather than advisory; it ships with the migration because shipping it first would
simply fail.

**The axe gate names `color-contrast` rather than hiding it, until the fix lands**
/ `KNOWN_OWNED_BY_M4_3` in `tests/e2e/palette.spec.ts` / The Playwright scan
fails on *any* other audit and prints the known one, so the debt is counted and
visible instead of absent. Lighthouse — the threshold the spec actually states —
scores 96 and passes, so the G2 item is retired either way. The line is deleted by
M4.3, at which point the gate is zero-violation.

**`landmark-unique` on table scrollers was fixed here, not deferred** / Each
`role="region"` is named after its own header row / Two regions both called
"Table" is a real defect (a screen-reader user cannot tell them apart) and the
fix is three lines and derived from the document. It was the other M4.3-adjacent
finding the axe scan surfaced, and unlike contrast it needed no token change.

---

## M3 — graph, stepper, workbench

**The stepper's per-step hash is `#/stepper/<n>`, 1-based** / `#/stepper` and
`#/stepper/3` / §7.7 requires the stepper to be "deep-linkable per step" and
says nothing about the format. A second segment after the view is the only shape
that leaves `#<slug>` (§7.1) and `#/graph` untouched, and 1-based because the
steps' own numbering is 1-based (§6.8) — a reader who sees "Step 3" types 3. A
`0` or a non-number is not a step: `/stepper/abc` degrades to the reader like any
unknown hash rather than being read as step 1, which would show the wrong step
for a bad link. A number past the end is **clamped** to the last step rather than
rejected, because a stale deep link is a link that has outlived its document and
the nearest real step is a better answer than an error (§1.3).

**A graph node's section is its id, matched against the document's slugs** /
Case-insensitive, exact; no fuzzy matching / §7.6 says the panel shows "section
title, first prose block, file chips" and "Open section" goes to the reader "at
that slug" — but the two modes answer differently, and pretending otherwise
would be the fiction §1.1 forbids. A **derived** map's node ids *are* the H2
slugs the pipeline derived them from, so the mapping is total. An **explicit**
graph's ids are whatever the author typed (`browser`, `api`, `db`), and §6.7 has
no syntax for pointing a node at a section, so it resolves only when the author
used a slug. A node that resolves to nothing keeps its panel with the graph's own
label and subtitle, its "Open section" **disabled rather than hidden**, and a
dev-mode warning naming the ids. Hiding the button would leave a panel with no
way onward and no explanation; fuzzy matching (`runtime` → "Runtime shape") would
present a guess as a link.

**The graph layout is a view concern and lives outside the pipeline** / Layered
left-to-right by longest path, in `src/app/graph/layout.ts` / The §6.7 DSL
carries no coordinates, so *something* has to place the nodes, and the pipeline's
job ended when it decided the graph exists and what is in it. M3.3's rule that
the view consumes `doc.graph` and recomputes nothing is about the *derivation* —
thresholds, linksTo, H3→parent-H2. Placement is presentation, and keeping it in
the pipeline would have meant putting a canvas geometry in a `Doc` that is
supposed to be a function of the markdown alone. It is a pure function, so it is
tested without a browser.

**Cyclic graphs are broken before layering, not merely survived** / Back edges
are found by an explicit-stack DFS and removed; the longest path runs on the
remaining DAG / §6.7's grammar permits cycles and the kitchen-sink fixture has
one (`planner -.-> shell` closes a four-node loop). A layered layout needs a
partial order and a cyclic graph has none. The first version used an on-stack
guard, which made the walk terminate — and put every node of a cycle in the same
column, so the loop rendered as a vertical stack with the tracks looping around
each box. The termination test was green; the screenshot was not. Removing the
back edges makes the chain the map and the dashed edge the return curve it is,
and the test now asserts the *shape* (columns 0,1,2,3) rather than only that the
call returns.

**The inspector column is reserved at every width** / The panel animates inside
its column; the grid template never changes / M3.5's trap (c). A conditional
column would reflow the grid when the panel opened, React Flow would re-measure,
and the reader's viewport would jump under the cursor. The cost is a visible
440px band when nothing is selected at ≥1280 — accepted, because the alternative
is a canvas that moves every time a reader clicks a node, and the band is empty
canvas rather than a broken one. At 768–1279 the split is the 50/50 §5.3
specifies, and the same argument applies.

**The `<768px` control is a button group with `aria-pressed`, not a `tablist`** /
Each button navigates to a view, and `<main>` keeps its landmark / §5.3 calls
these "segmented tabs", and they look like tabs. A real tab must own a
`tabpanel`, and the element being switched is `<main>` — giving that a
`tabpanel` role strips the `main` landmark §9 requires, and axe flags the
mismatch. So the label was taken as a description of the *shape*, not of the
semantics: two buttons that show one region, neither of which navigates… except
that they do, which is the other half of this decision. **Each button navigates**
(`goTo('reader')` / `goTo('graph')`). An earlier version held a `mobilePane` in
component state beside the route, on the reasoning that a pane switch is
presentation; the Playwright run found the Docs button setting the pane while the
reader was never rendered. Two sources of truth for one fact, and the route won.
The pane *is* a different view, so it gets a route, and the back button and the
address bar now agree with the screen.

**The header's view switcher is hidden below 768px** / The segmented control is
the navigation there / §5.3 gives the narrow layout its own navigation, so the
switcher was a second control doing the same job — and keeping both pushed the
header past the viewport ("READER / G…" cut off at 375px in the M3 screenshot).
This is part of *defining* the segmented control rather than the M4.2 chrome
pass, which owns the title stubbing and is untouched.

**The stepper is a `tablist` of progress dots over one `tabpanel`** / Chosen
over a plain button group / The dots *are* the steps and the body *is* the panel,
which is the relationship `tablist`/`tab`/`tabpanel` already names, and it gives
§7.7's arrow-key behaviour without a bespoke key handler. Roving tabindex (one
Tab stop, arrows within) is what a screen-reader user expects from a tablist.
Focus then has to follow the control the reader is using: arrows *on a dot* keep
focus on the dots, while ←/→ anywhere else move the panel into focus, because
that is where the new step is being read. The Playwright walk found the first
version stealing focus to the panel in both cases.

**The step title is the view's `h1`** / Not an `h2` / The stepper view has no
document H1 of its own — the reader's H1 lives in the reader — and axe is right
that a page with no top-level heading announces its structure from the wrong
starting point. Found by the axe gate, not by reading the code.

**Pipeline warnings echo only in development builds** / `echoToConsole` defaults
to `import.meta.env.DEV`, and `useDocument` restores that default rather than
forcing it on / §1.3 asks for a "development-mode warning". A production build
that prints one is not being helpful, it is violating the spec — and it fails the
e2e console-noise gate, which is how M3's own graph warning was caught shipping.
`useDocument` had been setting the echo back to `true` after parsing, which
forced it on for every *later* warning including the view layer's.

**A `definition` node produces no block** / `classifyNode` returns `null` for
it / mdast lifts reference definitions onto the root, but the section splitter
still hands them to the classifier, and the default branch turned each into an
`html` block with an empty value. The reader therefore rendered one empty `<pre>`
per reference link: a document with three reference links gained three blank
boxes. Found by the M3.0a fixture that exists to prove reference links work.
§1.3 applied correctly is "absent, not rendered as a gap" — and the definitions
themselves are still collected onto the `Doc`, so the links they resolve keep
working.

**jsdom keeps one `window` per test file, so tests that navigate reset the hash
in `beforeEach`** / The App seeds its route from `location.hash` / A test that
writes a hash silently decides the starting view of every test after it, and the
failure then reads as a mystery several cases away from the cause. This cost two
M3 debugging detours before it was written down.

---

## R11 — the G4 refinements

**The inspector is a reserved column at ≥1280 and an overlay below it** /
Refined at G4/R11a, superseding the flat "reserve the column everywhere" rule /
The reservation is kept exactly where DESIGN.md specifies the three-pane
workbench, because there the 440px band reads as part of the instrument and
removing it would mean the canvas resized every time a node was clicked — the
jump trap (c) exists to prevent. Below 1280 the same reservation is the wrong
trade: 440px is 37% of a 1024px viewport spent on an empty band, and at 768px it
leaves the canvas 328px, which cannot show a five-node graph. So at 768–1279 the
panel becomes an **absolutely positioned overlay**, capped at 60% so the canvas
stays readable behind it, and below 768 it becomes a full-width bottom sheet.

Worth being precise about: the overlay does not weaken trap (c). The trap is
"opening the panel must not move the canvas", and an absolutely positioned panel
does not participate in the grid at all, so the canvas keeps its exact width
whether the panel is open or closed — the same guarantee, obtained by a
different mechanism at each breakpoint. The panel's slide also changes direction
with the mechanism: a short fade-and-slide on desktop, a drawer from the right
edge on tablet, a sheet from the bottom on mobile. One signature moment (§8),
three keyframes, because the motion is supposed to explain *where the thing came
from*.

**`--text-subtle` stays; its contract is narrowed and then enforced** / The G3
recommendation, approved at G4 and applied / The token and its §5.2 value
(`#475569`) are unchanged, and no intermediate token was minted — the measured
figures in the G3 entry still stand (2.56 / 2.36 / 2.52 / 1.93:1 against a 4.5:1
requirement, with every size in the scale being normal text). All eleven
informational declarations moved to `--text-muted`: the `⌘K` hint, the hero stat
labels, `CONTENTS`, the TOC's H3 children, `NOW READING`, the §6.4 unresolvable
link and its underline, code and terminal line numbers, and the palette
placeholder. Exactly one use remains — `.stepper-button:disabled`, which WCAG
1.4.3 exempts as part of an inactive component, and which is the first entry in
`TEXT_SUBTLE_ALLOWLIST` in `tokens.test.ts` with its exemption quoted.

**The contrast gate is now zero-violation, and the allowlist was deleted rather
than emptied** / `KNOWN_OWNED_BY_M4_3` is gone from both e2e specs / A named
allowlist entry that is no longer needed is a hole in the gate with a comment
attached to it, and the next person to widen a threshold will find the pattern.
Both specs now assert `violations(page) === []` on the reader, the graph view
(panel open and closed) and the stepper.

`page-has-heading-one` on the stepper is the finding this gates most visibly, and
it is worth recording *how* it was handled: it was found while the allowlist still
existed, which is precisely when an allowlist is most likely to be widened to
absorb a new audit. It was fixed instead — the step title is the view's `h1`,
because the reader's H1 lives in the reader and a view that has no top-level
heading announces its structure from the wrong starting point.

---

## M4 — modes, mobile, a11y, motion, delight, perf, release

**§7.8's rule is an allowlist, not the denylist it also states** / Positive
statement implemented; `loop`, `graph`, `steps`, `hr` and `html` follow /
§7.8 describes executive mode twice: once positively ("per H2 → title + first
prose block + all tables + blockquotes; H3s → title + first paragraph") and once
as a denylist ("code/terminal/mermaid/lists hidden"). The two agree on the kinds
the denylist names and are silent about five more, so the choice decides what
happens to a `loop` diagram, a `graph`/`steps` DSL block, a thematic break and a
raw-HTML block. The positive statement is the one that is *implementable* — a
denylist needs a decision for every kind nobody thought of, and the next one
added would be visible by default. So `filterBlocksForMode` keeps the listed
kinds and drops the rest, and the denylist falls out of it as a corollary rather
than as a second rule to keep in sync. On the merits the allowlist is also
right: `html` is raw markup rendered as source and `graph`/`steps` render as
code blocks in the reader (the M3 note in `BlockView.tsx` says so), so all three
are exactly what an executive reader does not want, and a `loop` is a diagram
whose caption is the paragraph above it.

**"First prose block", not "first block"** / The lead paragraph is found by
kind / §7.8's wording is precise and the difference is not academic: a section
that opens with a table would lose its lead paragraph under `blocks[0]`, and
the lead paragraph is the one thing §7.8 exists to guarantee a skimming reader
sees. No fixture would have caught it — `kitchen-sink`'s sections all open with
prose — so the case is asserted on a purpose-built document in
`reading-mode.test.ts` instead.

**H3s do not inherit the H2 table/blockquote allowance** / Title + first
paragraph, full stop / The spec states the H2 rule and the H3 rule separately
and the H3 rule is the shorter one. Extending "all tables + blockquotes" down to
H3s would have been a reasonable reading of the intent and is not what the text
says; the cost of guessing here is a document whose glossary terms lose the
definitions formatted as tables, which is the opposite of a summary.

**The introduction is never reduced** / §7.8's rule is stated per H2, and the
introduction has no H2 / This is the decision that makes `no-structure.md`
render identically in both modes, which the M4 brief requires — but it is not
required *because* the intro is exempt, it falls out of it. The intro is the
prose before the first H2; a rule that acts on sections has nothing to act on in
a document that has none. Filtering it would have made "a document with no
headings" the one document the mode visibly changes, which is exactly backwards.
It is also the right product call independently: the introduction is what the
document is and why it exists, and it is short by construction.

**A document with one paragraph per section is not reduced, and that is not a
bug** / `crosslinked` reports 100% in the §7.8 word-count table / The report
prints a `reducible` column beside the percentage for exactly this reason. The
first draft of the test asserted a strict reduction on both fixtures named in
the brief and failed on `crosslinked`, which has three H2s of one paragraph
each. The heuristic was right and the assertion was wrong: a filter that
removed a section's only paragraph would be losing content, not summarising it.
The test now asserts the invariant that holds for every document (executive can
never show *more*) plus a strict reduction wherever the document itself has
something to reduce — derived from the fixture, not from a magic ratio, which is
what §7.8's "verify on fixtures, not a fixed ratio" asks for.

**The report counts blocks as well as words** / `23→12` on kitchen-sink, next to
a word ratio that reads 91% / Words badly understate the mode. A 40-line code
block is one block and a lot of tokens, but an executive reader stops at its
title: it is *one* unit of reading, not forty. The word ratio is kept because
§7.8 asks for word counts and because it is the number that would move if the
rule changed; the block ratio is added because it is the number that describes
what a reader actually stops doing. A table showing only 91% would read as a
broken feature.

**The mode is read from storage in a state initialiser, not in an effect** /
The first paint is already in the remembered mode / An effect renders reference
mode, commits it, and then re-renders as executive — a second pass over the
section tree and a visible flash of the full document for the reader who
specifically asked not to see it. §7.8 says the mode *persists*, and persisting
means the document arrives in the right shape.

**The per-section overrides are not persisted** / They are indices into a
reduced document, and they are cleared when the mode is left / Two reasons. A
returning reader cannot tell which sections they expanded last time, so a page of
silent overrides makes executive mode progressively less executive with no way
back; and in reference mode every section already shows everything, so an
override left switched on is a control that reveals nothing — the dead UI A4
rejects. The mode is the preference; the override is a decision about one
section in one sitting.

**The mode is a toggle button, not a segmented control, and it is not in the
hash** / One control in a 32px row that is already exactly full at 375px /
`localStorage` rather than the URL, because §7.1 gives the hash exactly one job
— which view, which section — and a mode change is not navigation. A segmented
pair ("Executive | Reference") was the other candidate and was rejected on the
header: the M3 screenshot already showed one control too many in that row, and
two buttons cost twice what one does. The visible text is the *thing*
("Executive") with `aria-pressed` for the state, never the action ("Switch to
reference mode"), because a label that changes with the state cannot be read as
a toggle by a screen reader at all. The full sentence lives in the palette row,
which is the discoverable place for it.

**The reading-mode palette row gets its own group, not a third row under
"Views"** / `ACTION_GROUP_ORDER` in `useSearch.ts` / It is not a view and it
does not navigate, and a group heading is read out before its rows — filing it
under "Views" would have been a lie the screen reader repeats. Each action
group is skipped entirely when it has no rows, which is the same rule the search
groups already follow and is what keeps `minimal.md` from growing an empty
"Views" heading.

**Every static palette row was dead in a real browser, since M2** / The overlay's
`onMouseDown` unmounted the row before its `click` could select it; fixed with
`event.target === event.currentTarget` / Found by M4.1's Playwright scenario,
which is the first time any e2e has *clicked* an action row — the M2 and M3
suites located them and asserted their text. The overlay closed the palette on
press, React tore the list down, and the click that would have fired `onSelect`
arrived with no target. Search *results* were unaffected, which is why it
survived four milestones: cmdk drives those from its own input handling, and only
the static rows went through this path. jsdom could not see it because
`fireEvent.click` sends no mousedown at all. The regression test asserts both
halves — the palette closed *and* the view changed — because asserting only the
first is exactly what let it through.

**The palette overlay is not inside a landmark, and M2's scan scope is why
nobody saw it** / Left for M4.3 rather than fixed under M4.1 / axe's `region`
rule ("all page content should be contained by landmarks") fires on the open
palette's overlay, the label cmdk renders around its input, and its listbox. The
M2 audit scopes its open-palette scan to `.palette`, so the overlay has never
been scanned. M4.1's scan is scoped the same way and says so in a comment, rather
than quietly widening a gate to make a new test pass on the strength of a
pre-existing defect. M4.3 owns the sweep, and the fix belongs with the rest of
the §9 landmark work.

**The 375px header sheds the search label before anything else** / One rule,
landed with M4.1 because the mode toggle is what made the row overflow /
Adding a control to a header that was already exactly full cost 5px of
horizontal overflow at 375px, which the M4.2 pass would have had to find anyway.
The order is: the search trigger's `⌘K` hint and the word "Search" go first,
because it is the only control in the row whose function is duplicated elsewhere
on the page — `⌘K`, `/`, and the palette itself — and the hint is a keyboard
affordance on a device that may have no such key. The title and the menu button
never go; they are the only things in the row that are *about this document*.
M4.2 revisits this with the rest of the mobile pass.

**A button must not borrow its accessible name from a child a media query can
hide** / `aria-label` on the search trigger and the mode toggle; Lighthouse a11y
100 → 95, `button-name` / Found by the Lighthouse gate, which audits at a mobile
viewport by default — the one width where the collapse above is active. Hiding
`.app-search__label` with `display: none` took it out of the accessibility tree,
and since the button's whole name *was* that span, the control became nameless
at 375px and at no other width. Two lessons, and the second is the one that
generalises: a media query can change the accessibility tree, so any responsive
collapse that hides a label has to move the name onto the control itself; and
the unit suite cannot catch this class at all, because it renders at no viewport
and a media query is invisible to it. The guard is therefore a *property* — every
header control carries an explicit `aria-label` — plus one Playwright assertion
at 375px, rather than a snapshot of the current markup. "Executive mode" also
satisfies WCAG 2.5.3, since the visible word "Executive" is contained in it.

**Three 375px-only axe findings, recorded for M4.3 rather than fixed under
M4.1** / `scrollable-region-focusable`, `link-in-text-block`, and the palette
overlay's `region` / Found by scanning a 375px page and an open palette —
scans nothing in CI has ever done / No test ran axe at 375px or over the open
overlay, so all three have been invisible for four milestones. They are listed
here so M4.3 inherits a list rather than a surprise, and the M4.1 test that found
them deliberately does not assert them: adding a scan here would either fail CI
on another task's findings or buy a green run by scoping the scan to exclude
them, and both are worse than recording them. The overlay one is the M2 scan's
scope — see the palette entry above.

**The 375px header becomes two rows, and the pane switch takes the second one** /
Identity and search above, navigation below; the title is no longer a stub /
This is the decision the G3 blemish needed, and the reason is arithmetic rather
than taste. At 375px the row held four things — menu, title, pane switch, search
— and M4.1's toggle tipped it over. Shrinking any *one* of them just moves the
damage: the M3 screenshot already showed the title squeezed to "Kitche…" while
everything else stayed full size. So the widest thing in the row, and the only
one that is a *second* navigation model above this width, takes a full-width row
of its own. The title then gets `flex: 1 1 auto; min-width: 0` — and `min-width:
0` is the load-bearing half, because a flex item's automatic minimum size is its
content width, so without it the title still refuses to shrink and the row
overflows into a horizontal scrollbar instead.

The header height token is restated inside the mobile query, which is not
cosmetic: `.reader-section` uses it for `scroll-margin-top` and the workbench for
`min-height`, and a two-row bar measured as 32px puts the heading you just
navigated to behind the bar. A Tier 0 document still gets a one-row header,
because the second row only exists when there is a pane switch to put in it.

**The pane switch is built from the same array as the desktop switcher** /
Parity by construction, not by a second list / M3.5 listed Docs and Visual Graph
and hard-coded the graph capability, so on a phone **the stepper was
unreachable** — a view the header switcher offered at 1440px, absent at 375px,
with no other route to it. Both controls now render the same capability-gated
`views` array, which makes disagreement impossible rather than merely unlikely: a
capability the pipeline adds appears in both and one it removes disappears from
both. The M3 rule still holds and is still asserted: no Metrics tab, because
there is no metrics view in v1.

**Touch targets are 44px below 768px and unchanged above it** / A new
`--touch-target` token, applied to thirteen controls / 44px is the iOS HIG
figure; WCAG 2.5.8 (AA) only asks for 24×24, so this is deliberately stricter
than the standard rather than a floor the standard already meets. The design
system is dense — 32px header, 4px radii, 10px labels — and that density is
right on a pointer and wrong on a thumb, so the whole rule lives in one media
query. The test asserts the *absence* at ≥1280 as well as the presence below
768: a `min-height` at the top level would be the same rule applied to the wrong
input device, making a mouse hunt for 44px targets on a 1440px display.

Inline chips are excluded, and that is a judgement rather than an oversight:
WCAG 2.5.8 exempts a target whose size is constrained by the line it sits in,
and padding a mid-sentence chip out to 44px would break the paragraph it
belongs to. The list is asserted one-by-one in `breakpoints.test.ts` so a
control added later is visibly *not* covered rather than silently uncovered.

**The drawer covers the page it dims, and Esc closes it** / Full width at 375px,
plus the key §9 has asked for since M2 / It was `min(260px, 100vw)` — 70% of a
375px screen, with the reader still legible beside it and a scrim over content
the reader could still read. Full width is the honest drawer.

That has one consequence worth recording, because it is the kind of thing a
layout change causes silently: **the scrim stopped being tappable**, and with it
the drawer's only touch exit. Esc was added in the same commit rather than
deferred to M4.3, because a full-screen overlay with no keyboard exit is a trap
this task created and M4.3's note is about focus *restore*. The listener is on
`document`, not on the `<nav>`, because focus is still on the menu button that
opened the drawer — a handler bound to the nav would never see the key. It sits
above the `sections.length === 0` early return, because a hook after a
conditional return is a hook that sometimes does not run.

**The graph is not fitted into an unreadable smear on a phone** / `minZoom: 0.6`
on `fitView`, and the reader pans / A four-column metro map is ~970 canvas units
wide; fitting that into 375px needs zoom ≈0.35, at which a 10px node label is
3.5px tall and the M4.2 screenshot showed four nodes collapsed into a band. The
clamp is inert at every other width, where `fitView` computes a zoom well above
it, so this is a one-line change that only bites where fitting is the wrong
answer. The trade is deliberate and is the one every map on a phone makes: a
graph wider than the screen and readable, rather than a graph that fits and
cannot be read. Panning is already bound and the zoom controls are on screen.

---

## M4.3 — the §9 sweep

**The axe gate is scoped to whole pages at both widths, and the two findings it
had been hiding are fixed** / `scrollable-region-focusable`, `link-in-text-block`
and the palette's `region` / M4.3 widened the scan rather than the threshold /
The M2 audit scanned the open palette with `include('.palette')`, which stops at
the overlay's edge — so the overlay itself, cmdk's own input label and its
listbox were never in the gate. And nothing had ever run axe at 375px, which is
where a code line actually overflows. All three findings were in the product
since M1; the contrast migration and the R5 deletion made "zero violations" true
only for the surfaces that happened to be scanned, which is a weaker claim than
it sounds. Nothing was allowlisted and no threshold moved: the three were fixed,
and the scan was widened to cover them.

**The code and terminal scrollers get what M2 gave the table** / `role="region"`,
a document-derived name, `tabindex="0"` / A box that scrolls sideways with no tab
stop is a box a keyboard user cannot pan, and axe only reports it at a width
where a line actually overflows. The name is `Code: <path or lang>` and
`Terminal output` — derived, never invented, and prefixed so two code blocks in
one section announce differently, exactly as M2 named the table regions after
their own header rows.

**Inline links are underlined** / `link-in-text-block`, serious, at every width /
A link inside a sentence that differs from its surroundings only by hue is
invisible to a reader who cannot separate cyan from grey. The underline is the
convention for exactly this and costs nothing; `text-underline-offset: 2px`
keeps it off the descenders in 14px body text, where the default reads as a
strikethrough.

**The palette overlay is `role="dialog" aria-modal="true"`** / Clears `region`,
and is true anyway / Nothing behind the palette is reachable while it is open —
that is what M2's focus trap has been enforcing — so `aria-modal` describes the
behaviour rather than adding one. This is the smallest change in the milestone
and it removed three violations at once.

**The skip link was in the wrong place, twice** / Moved to the first child of
`.app`, and `<main>` given `tabindex="-1"` / It was the first child of the very
element it points at, so activating it moved focus nowhere; moved out, it then
sat *after* `<header>`, whose menu button, reading-mode toggle, search trigger
and view switcher are all Tab stops, so the first Tab landed in the header. And
`<main>` had no `tabindex`, so even correctly placed the fragment navigation
would have scrolled without moving focus. All three are the same defect wearing
different hats: a skip link is the one control whose entire job is to move focus
somewhere it is not, and it has to be the *first* focusable element to do it.

**The closed drawer was in the tab order** / `visibility: hidden`, not
`translateX(-100%)` / Every section link in a closed drawer was a Tab stop a
keyboard user could reach and focus, with no way to see what they had focused.
`transform` moves an element off the screen and does nothing to the tab order;
`visibility: hidden` removes it from the tab order *and* the accessibility tree,
which is what "closed" has to mean. `visibility` is animatable, so holding it
visible for the length of the slide lets the drawer finish leaving.

**The drawer now takes focus, keeps it, and gives it back** / §9's drawer clause,
which M1–M3 had left as the missing half of the palette's / Focus goes to the
close button on open (the one control whose meaning does not depend on having
read the list), Tab cycles in both directions while open, and Esc or a link
returns it to the menu button. A drawer that swallows focus and does not give it
back strands a keyboard user at the top of the document — the exact defect the
palette's `restoreFocusTo` was written to avoid, in a different component.

**The document title is the document title** / §9 says so; `index.html` shipped a
hardcoded "Unfold" / The tab strip, the bookmark, the screen-reader window title
and the search result all named the *product* rather than the document being
read. `doc.title` is the end of §7.2's fallback chain, so it can never be empty,
and it is restored on unmount so a second App in the same document does not
inherit the last fixture's title.

**The palette's Esc hint is `--text-secondary`, and the reason is a compositing
artifact** / axe measured 3.82:1, not the 6.96:1 the token actually has / The
`.glass` overlay's `backdrop-filter` leaves axe reading composited pixels, so it
measured the text colour at roughly three-quarters strength against a blended
surface — a failure that appeared in one CI-shaped run and not in others on the
same build. A gate that fails on a compositing artifact is worse than no gate,
because the next person to see it widens something. Two changes make the
measurement deterministic and happen to be the right design anyway: the hint gets
an opaque surface of its own, and it moves from `--text-muted` to
`--text-secondary` (12.02:1 on `--surface-1`) because it is the only thing that
tells a keyboard user how to dismiss the dialog. It is not metadata and never
was.

**The R5 contrast allowlist entry was already gone, and the axe gate is
strict-zero on every surface CI can reach** / Deleted at G4/R11b; M4.3 widened
the scope / The M4 brief lists the R5 deletion as this session's one permitted
gate change, and `docs/plan.md` records it as applied at G4/R11b — so the commit
for it is `4193cef`, not one of M4's. What M4.3 did is make sure the
zero-violation claim covers the surfaces the old scope left out, which is the
half of "delete the allowlist" that a scoped scan quietly skips. The
`genericity.test.ts` colour guard proved its own worth during this task by
refusing two hex literals that appeared in a *comment* explaining a contrast
measurement; a guard that reads comments is a guard that has to be obeyed by the
person writing the explanation.

---

## M4.4 — the motion audit

**The inventory is a printed table and a test, not a paragraph** /
`src/test/motion.test.ts`, and it is the whole deliverable / §8 is a budget, and
a budget that is only written down stops being true the day someone adds a
fourth signature moment. The file parses the stylesheet — a grep would also
match prose in comments — and prints every animation on every run:

    animation              tier              iteration  signature
    section-flash          --motion-reveal    1          —
    loop-dash              --motion-ambient   infinite   —
    palette-spring         --motion-slow      1          yes
    edge-trace             --motion-ambient   infinite   —
    panel-in               --motion-slow      1          yes
    step-in                --motion-slow      1          yes

Six declarations, three signature moments, one reveal, two ambient loops. The
test that makes "three" mean three is the *unclassified* one: an animation that
appears that is in none of the three lists fails, so adding a fourth signature
moment is a deliberate act rather than an accident. The near miss is M4.1's mode
flip — a whole-document reflow, which is exactly the kind of thing that tempts
signature treatment — and it is asserted at 250ms in both the unit test and a
browser.

**Ambient loops get their own tier, because they were borrowing the reveal's** /
New `--motion-ambient: 6400ms` / `loop-dash` and `edge-trace` were both on
`--motion-reveal` — 560ms, which is right for a flash that happens once and
absurd for a dash crawl that never stops. Nothing about them looked *wrong*;
they were simply fast, and §8's word for that is "not slow". Borrowing a tier is
how a budget stops meaning anything, because the number no longer says what kind
of motion it is. The new tier is one full dash cycle at a drift nobody can track,
and it is zeroed by the reduced-motion block along with the other four.

**`section-flash` is classified as a reveal, and that is the reading** /
560ms, one-shot, and it is the only classification available / §8 allows 500–600ms
for reveals and ≤250ms for everything else, so a 560ms one-shot has to be one or
the other. It is: the flash fires when a navigation arrives at a section, it
never repeats, and it is a wash of `--accent-wash` at 8% alpha — an attention cue,
not a transition between two states. The test asserts it is one-shot and inside
the band, so "it is a reveal" is a claim with a number attached rather than a
rationalisation. Shortening it to 250ms would have made a full-width background
fade visibly snap.

**One Playwright describe runs with motion on, and it exists for one reason** /
`tests/e2e/motion.spec.ts`, `contextOptions: { reducedMotion: 'no-preference' }` /
The whole suite runs reduced, which is what lets it "assert on state, never on
sleeps" — and which also means a suite like that can pass with **no animation at
all** and still call itself green. "Reduced motion → everything is instant" is a
claim about a product that does not move unless something checks that it moves.
The four reduced-motion tests assert `animation-duration: 0s` and
`iteration-count: 1` on each signature element and on the ambient loops; the five
non-reduced ones assert the three moments are named, timed and curved. The
per-test override is `contextOptions` rather than a bare `reducedMotion` because
in `@playwright/test` 1.61 that option lives on `BrowserContextOptions`, not on
`PlaywrightTestOptions` — the documented form and the only one that type-checks.

**An infinite loop under reduced motion is the failure that never fails a test**
/ Asserted explicitly, at both tiers / An animation that keeps running while
reduced motion is requested does not time anything out; it just burns frames on a
reader who asked it not to, silently, forever. The reduced-motion test for the
ambient loops asserts the iteration count is `1` and not just that the page
behaves, because "the page is fine" is exactly what a runaway loop looks like
from the outside.

---

## M4.5 — delight

**One flag, one file, and the flag is checked before the import** /
`src/app/delight/delight.ts` is the whole feature / §7.10's "behind one
`features.delight` flag" plus the M4 brief's "config-off must mean the chunk is
never imported" is a claim about a *network waterfall*, and the only way to make
it true is to put the guard first: `enabled(on)` is the first statement of every
entry point and the `import('canvas-confetti')` is inside the branch below it. A
decorative feature that costs a reader 8KB on every page load because the check
happened one line too late is a worse bug than no confetti at all.

**"Never load" is stronger than "never fire", and the test says so** / Reduced
motion suppresses the *import*, not the call / §8's words are "confetti/particles
never load". Firing nothing while still requesting the chunk would satisfy a
naive test and cost every reader with the preference on the bytes. The tests
assert `fired.size === 0` as well as "nothing was drawn", and the preference is
re-read on *every call* rather than captured at construction — a reader who
turns reduced motion on mid-session must not be greeted by a burst from a
progress tick queued a moment earlier. `disableForReducedMotion: true` is passed
anyway as a second line of defence, not as the mechanism.

**The chunk is proven lazy three ways, because "lazy" is three claims** /
`budget.test.ts` reads the build, the e2e reads the request log, and the unit
test reads the gate / (1) The marker string is absent from the entry chunk and
present in some other chunk. (2) `index.html` preloads no non-entry chunk — the
failure (1) cannot see, because a correctly-split chunk that the entry
`modulepreload`s is still fetched on first paint. (3) The e2e records every
request the browser makes: with the flag off, or under reduced motion, nothing
matching `/confetti/` is ever requested — and the inverse test, with motion
allowed, asserts it *is* requested at a milestone and not before, which is the
assertion a "never requested" test cannot make on its own. The Playwright test
also asserts a real `<canvas>` exists afterwards, because jsdom never could.

**canvas-confetti is mocked in the unit test, and that is deliberate** / The
first draft passed twelve assertions and then threw `clearRect of null` from
inside the library's own `requestAnimationFrame`, on a timer, after the test had
finished / jsdom has no 2D context, so the library's animation loop dies on the
first frame. A passing test with a background exception is worse than a failing
one: the next person to see it has no idea which change caused it. What is under
test here is the *gate* — when we call it and with what — and the real library is
proven by the build output and by Chromium.

**Framer Motion stays uninstalled, and M4.4 is the reason** / §4 names it; the
audit found the opposite of a need for it / Spec §4 lists "Framer Motion —
layout/gesture animation, reduced-motion API", and the M4.4 audit found all
three signature moments already were CSS keyframes, the §8 budget was
satisfiable without it, and the one real defect was an ambient loop on the wrong
duration token. Adding a 40KB animation library to fix a misfiled token is the
"just for X" smell plan §9 tells you to reject, and the M4 brief is explicit
that it is not to be installed. It stays on `genericity.test.ts`'s DEFERRED list
with that reason attached, so the decision survives the next person who reads
§4 and wonders.

**The Konami matcher restarts on a wrong key rather than sliding a window** /
Position-matched, and the cursor is separate from the milestone set / The
sequence is a deliberate gesture, and a forgiving matcher would fire on a reader
who half-remembers it. The cursor is its own variable rather than another member
of `fired`: `fired` means "this milestone has been celebrated" and a caller can
read it to know how far a reader got, so overloading it for a key sequence would
make one number mean two things. The first draft did exactly that.

**The confetti palette is read from the cascade, and the guard said so** /
`tokenColours()` via `getComputedStyle` / `genericity.test.ts` refused three hex
literals in the first draft of `delight.ts`, and a fourth that had appeared in a
comment explaining them / `canvas-confetti` needs literal colour *strings* — it
hands them to a 2D context and never touches the DOM they came from — so the
values have to be read out of the cascade at the moment they are needed. Reading
them per burst rather than per module is what makes a runtime theme change
honoured, and the `.trim()` is load-bearing: `getPropertyValue` on a custom
property returns the token text with leading whitespace, and the library would
parse a padded value as not a colour at all — a failure that presents as
"the confetti is invisible" and nothing else.

**The lazy-chunk marker is a string from the library's code, not its name** /
`OffscreenCanvasRenderingContext2D`, and the first marker failed immediately /
`'confetti'` as the marker asserted the entry chunk contained no mention of
confetti, which it does: a dynamic import has to *name* its chunk, so the entry
legitimately contains `import("./confetti.module-….js")`. A reference to the
chunk is not the chunk. The marker is now a platform API name from confetti's
OffscreenCanvas feature detection, which appears nowhere in this app and which
minification cannot touch. The same lesson is why the xyflow test uses
`'xyflow'` — a string from the library's own bundle — and why neither of them
should be a chunk *filename*: Vite names chunks after the importing module, so
`confetti-abc123.js` would prove only that Vite believed the name.

**The pipeline perf test now takes the best of three runs — the bound did not
move** / `2000 sections parse without blowing up`, still `< 5000ms` / This test
read 617ms alone and 5027ms in a full-suite run, on a machine doing nothing
else, with no code change anywhere near the pipeline. A single wall-clock sample
inside a parallel test runner measures the scheduler as much as the parser, and a
gate that fails on a loaded CI runner teaches its readers to re-run it and then
to widen it. This is the same lesson the Lighthouse gate already learned — the
M4.6 brief's own words are that "62→45 variance proved single runs are noise",
which is why that gate is median-of-3. Best-of-3 is the cheaper cousin: for a
*bound* the question is how fast this can go, and the fastest run is the one
least polluted by whatever else the machine was doing. The bound is untouched,
the "no blowing up" assertion still runs on every sample, and a genuine
algorithmic regression still fails all three.

---

## M4.6 — the perf pass

**The test host now compresses, and that was most of the score** / `br`/`gzip`
on every text response in `tests/e2e/server.ts` / §12's deployment target is
Netlify or GitHub Pages, and both gzip every text response by default. The audit
host did not, so it sent a **439KB entry where a real host sends 136KB**, and
every number M4.6 records was measuring the host's silence rather than the
app's weight. Total transferred bytes went from ~3.6MB to ~1.0MB. A test host
that is *stricter* than production is a useful thing to have; a test host that is
*different* from production is a measurement of the wrong system, and this one
was silently the latter for four milestones.

**The waterfall fix, in the order that paid** / FCP 3.5s→1.6s, LCP 4.4s→2.0s /
Three changes, and they are not equal. (1) Compression, above. (2) The build
emits `<link rel="preload" as="fetch" crossorigin>` for the config **and** the
configured `docPath`, which takes two round trips off the critical path; it has
to live in the Vite plugin because that is the only place that knows the
configured path, and a deployer who changes `docPath` must not have to remember
to change a template. `crossorigin` is not optional: without it the preload is
fetched in no-cors mode, lands in a different cache entry, and is then fetched
*again* by the real request — a wasted round trip caused by a hint that looks
like it is working. (3) The config and the document are fetched **in parallel**
rather than in sequence.

**The font fallback numbers are measured, and the measurement had to be fixed
first** / `scripts/font-fallbacks.ts` / Lighthouse reports the LCP element as
**the reader's first paragraph**, so the largest thing on the page is text, and
`font-display: swap` re-wraps it when the real font lands — which is how a font
swap ends up *setting* LCP. The fix is a metric-matched fallback via
`size-adjust`. The first version of the measuring script compared line-box
*heights* and reported 100% for all three faces, because a `nowrap` div's height
is the inherited `line-height` and says nothing about the font; the metric that
matters is advance **width**, because that is what re-wraps a paragraph. The
real figures: Geist 97.78%, Inter **93.43%** (6.6% off — the visible one, and
the one the LCP paragraph is set in), JetBrains Mono 100.02%. No ascent/descent
overrides, because the script does not derive them and a guessed override
introduces a second reflow instead of removing one.

**Font preloading was measured and removed: it cost 2 points** / median 86 with
them, 88 without / The brief asked for "font preloads + size-adjust-matched
fallbacks so swap doesn't re-trigger LCP", and the two halves turn out to pull
in opposite directions. Once the fallback is metric-matched the swap is already
cheap, so the preload's only remaining job is to add three more requests to a
connection Lighthouse is throttling — which is contention, not saving. Shipping
it would have meant shipping the slower half of the brief's own instruction
because it was written down. The size-adjust fallbacks stay; the preloads do
not. `preloadFonts` and the three hints it emitted are gone.

**The idle-deferral is where TBT went** / `whenIdle()` in `app/whenIdle.ts`,
used by mermaid and Shiki / TBT 1134ms → ~390ms. Both heavy chunks were already
dynamic imports, which defers the *bytes*; what was not deferred is the *main
thread*, because both were kicked off from a `useEffect` during the initial
render, so a 645KB mermaid chunk and a full-document highlight pass landed in
the same burst as React's first commit. `requestIdleCallback` with a **2-second
timeout** — the timeout is the load-bearing half, because without it a document
that never goes idle would never render its diagrams, which is a behaviour
change dressed up as an optimisation. The diagram still draws and the code still
gets highlighted; they just stop competing with the first paint.

**A prefetch of the zero-config default was tried and reverted: it 404s** /
`main.tsx` / The first attempt to parallelise the fetches warmed `./document.md`
— the §1.4 default — before the config had been read. A request log showed it
firing on every single page load, 404ing, because a configured deployment points
somewhere else. It was a pessimisation for the common case in order to help the
rare one, and the build-time preload already covers the configured path.
Removed. Worth recording because the reasoning sounded right and the
measurement said otherwise.

**The perf gate is median-of-3, and a11y is the *worst* of 3** / `PERF_FLOOR =
90`, `PERF_RUNS = 3` / A performance score varies with machine load and an
accessibility score does not, so averaging the first and taking the worst of the
second is the only combination that is right for both. The brief's own "62→45
variance proved single runs are noise" is the reason: a gate on one sample is a
gate on the weather, and a weather gate is a gate that gets ignored. A per-run
timeout was added too, because "the gate hangs" is a worse failure than "the
gate fails" — CI's own timeout would eventually fire with no indication of
which run was stuck.

**The gate is ON at 90 and it FAILS. Final samples 86 / 88 / 82, median 86.
The gate itself names the cause: TBT.** Reported, not widened / TBT weight 30
(score 0.46-0.65 across runs) and LCP weight 25, both printed by the gate so a
failure is actionable rather than a bare number / This is the outcome the M4
brief anticipated — "if the waterfall fix alone doesn't reach 90, report the
remaining gap + your best next lever — do not silently widen anything." The
threshold is §10's own number and it is unchanged.

The 6-point spread across three runs is itself the finding. LCP is stable at
2.0-2.5s; TBT is not, because it is a function of what else the machine is doing
while React mounts a 60-block document. That is why the gate takes a median of
three: a single run here is measuring the weather, and 88-vs-86 is not a
meaningful regression.

**M4.6's own test run found a real M4.3 regression, and the fix was a CSS
deletion** / `.code-content` / M4.3 gave `.code-content` `role="region"` and a
tab stop so a horizontally scrolling code block would be reachable by keyboard.
Running the full suite after the server's compression change turned up
`scrollable-region-focusable` on `.code-plain` — the *inner* `<pre>`, which was
also `overflow-x: auto`, and was therefore the element that actually scrolled.
There were two nested scrollers, and the tab stop had gone on the outer one.

The defect was M4.3's own, moved down one element: the rule says a scrollable
box must be focusable, and the box that moved was not the box that was
focusable. The fix is to have one scroller rather than two — `.code-plain` and
`.code-highlighted` now size to their content and `.code-content` does the
scrolling. Worth recording because the M4.3 change looked correct in review and
in the unit tests; only a whole-page axe run against a long, unhighlighted fence
surfaced it, which is the argument for the M4.3 sweep being whole-page in the
first place.

**M4.8 status confirmation, read from `plan.md` and the specs, not from memory**
/ M4.1, M4.2, M4.4, M4.5, R5 / Each was checked against the plan's own wording
and against the file that implements it. M4.1 prints the §7.8 report for
`kitchen-sink` and `crosslinked` on every unit run — **23→12 blocks, 91% of
words** for `kitchen-sink`, and `crosslinked` reports 100% because each of its
H2s is a single paragraph, which the test asserts as a *reason* rather than a
fixed ratio. M4.2's two-row header with the 1px title stub at 375px is
recorded with its collapse order. M4.4's inventory is a *printed table and a
test* in `src/test/motion.test.ts`, six declarations: three signature moments,
one reveal, two ambient loops, with `--motion-ambient: 6400ms`; the
non-reduced-motion half is `tests/e2e/motion.spec.ts:95`, a
`test.use({ contextOptions: { reducedMotion: 'no-preference' } })` block with
five tests including the 250ms mode-flip ceiling. M4.5's off-switch is asserted
twice from the browser: `delight.spec.ts:31` (flag off → chunk never
requested) and `:71` (flag on, reduced motion → still never requested). The R5
contrast-allowlist entry was deleted at **G4/R11b, commit `4193cef`** — not in
M4, which is why M4.3's own entry says so rather than claiming the credit.

**M4.2's mobile collapse order is amended by M4.12** / the header at 375px
puts the wordmark first and the document title on a second row. M4.2 recorded
the order as "the title grows into the leftover space and truncates with an
ellipsis"; that rule was about *how the title behaves*, and M4.12 changes
*which element wins the top row*.

The wordmark stays on row one because it is the only element that says which
product this is and provides the way home, and a brand that disappears at the
width most people read at is not a brand. The title drops to row two and still
truncates. The rejected alternative is the one worth recording: truncating
UNFOLD to fit the title alongside it would reproduce a 1px stub at the far left
of the header — the precise defect M4.2 was written to eliminate — and a stub
where the brand goes is worse than a title one row down.

**The drop handler is on `window`, not on the drop screen** / M4.12, closing
M4.11b. The brief required that dropping onto a *loaded* document swap
documents, and the handler could not live in `DropScreen`, because that screen
is not mounted when a document is loaded — the one case the requirement is
about. The human's inability to confirm the behaviour was not a missing test
alone; the capability was not there. The `FileReader` and accept-check are
extracted to `useMarkdownFile` so the welcome view and the app-wide handler
cannot drift, since a second copy of that logic is the one nobody tests.

**The drop zone's border is 2px, not 1.5px** / M4.12. Chrome snaps a *dashed*
border to whole pixels: `1.5px dashed` computes to `1px`, confirmed with
`getComputedStyle`. The brief's value would have been written into the
stylesheet and read by every reviewer as a deliberate heavier rule, while
painting identically to the 1px dividers it is meant to out-weigh. The intent
is preserved; the value is the nearest that survives the snap. This is the same
shape as the M4.10 instrument lesson: the number in the brief was measured under
a different experiment than the one it was written for.

**Deployment is not a release criterion** / `docs/README.md`, logged as a human
decision / The deployment section now says plainly that it is documented but not
yet exercised on a real host. The reasoning: §10 gates measurable properties of
the artifact, and "a Netlify deploy works" is not one — it is true the first
time and needs re-checking every time the host or the `base` path changes.
Recording it as a known-unexercised contract is honest; making it a gate would
mean a gate that only the human who owns the deploy account can satisfy.

**M4.6b — profiling the two long tasks, and the profile overturneds the plan's
hypothesis** / `scripts/profile-long-tasks.ts`, median of 3 / The standing
suspicion since M4.6 was that search index construction was ~100ms of the
entry's cost and could be deferred. **It is 0ms, because the index is never
built on load.** `useSearchIndex` is called from `Palette`, and `App.tsx`
renders `{paletteOpen ? <Palette/> : null}` — the palette is not mounted until
someone presses `⌘K`. The MiniSearch index is therefore already deferred past
every measurement Lighthouse takes; there is nothing to move. Measured
*directly*, at the moment the palette opens, construction is **10.4ms at 4x
throttle** (4.3ms unthrottled). The premise was wrong, and it was wrong in the
cheapest possible way to discover.

**Three measurement traps, each of which produced a confidently wrong report
before it produced a right one** / profiler design / Worth more than the
numbers, because all three would have been reported as findings:

1. **A minified profile cannot name anything.** The production entry's hot
   functions are `mk`, `Ol`, `lC`, `dc`. Profiling `dist/` yields "198 samples
   went into a function called `<anon>`" and nothing further. The profiler
   builds `dist-profile/` with `--minify false` and serves *that* through the
   same static host, so names are readable. Absolute times are pessimistic
   (unminified code evaluates slower); the *ranking* is the finding.
2. **Unthrottled, this page has zero long tasks.** No CPU slowdown, no TBT, no
   buckets — a clean sheet that reads like success. Lighthouse's mobile
   simulation is a 4x slowdown, so the failing score only exists under
   throttling; profiling without it measures a machine, not the app.
3. **V8's pseudo-frames are the largest rows in the profile.** `(idle)` was
   5.9s against 378ms of real work — the first report read "94% unattributed"
   and the answer was invisible underneath it. `(idle)` means *the main thread
   had nothing to do*, which is the good outcome. Idle, program and GC are now
   reported in their own rows and excluded from the percentages, so the
   denominators are work rather than waiting.

**The actual breakdown of the ~330ms mount** / median of 3 at 4x CPU throttle,
unminified / Real work totals ~800ms, of which: React render/reconcile 225ms
(29%), markdown parse 191ms (24%), entity extraction 80ms (10%), and 285ms (36%)
in leaf frames with no recognisable ancestor — of which the largest single slice
is bare module evaluation at `(root)`, plus DOMPurify construction, js-yaml
loading and `getRegex`. TBT median 348ms. Shiki appears at only 4ms here against
100ms in an earlier run of this same script: it is idle-deferred, so whether it
lands inside the 4s capture window is a race, and one run's shiki number is not
a measurement.

**The entry's 273ms of eval is one bundle, 100% `index.js`** / React is
inlined / React and ReactDOM are inlined into the app entry rather than split
into their own chunk, so "React eval vs our eval" has no answer at the URL
level — they are the same file. Separating them means changing the bundler's
chunking, which is a product decision this task is explicitly not allowed to
make. It is also the one lever the profile does point at, and it is the reason
the next step is a decision rather than a task.

Two numbers in that run are **not** comparable to the Lighthouse gate and should
not be read as regressions: LCP 4924ms and the 327KB entry, both artifacts of
profiling an unminified bundle through 4x throttling. What survives is the
ranking.

**M4.6c is skipped: the gate's precondition is not met** / index construction
0ms at load, 10.4ms at palette open, against a ≥100ms threshold / The brief
said implement the deferral only if the profile shows ≥100ms *and* the
first-keystroke cost is zero. The first condition fails by an order of
magnitude, so the second was never tested and M4.6c does not exist. Reporting
that plainly is the whole value of having profiled rather than assumed — the
alternative was spending a milestone on an optimisation for work that was
already off the critical path.

**M4.9 / A14 — the perf gate is four named metrics, and it immediately found a
defect the composite was scoring 94 on** / `scripts/lighthouse.ts`, desktop
preset, median of 3 / The ratified amendment: **FCP ≤ 2000ms, LCP ≤ 2500ms, TBT
≤ 400ms, CLS ≤ 0.1**, each gated on the median of three, hard fail. The
composite is still computed and still recorded; it is no longer the gate.

The finding is the argument for the amendment, and it is a good one. Under
Lighthouse's **default mobile preset** the composite was 86/88/82 and the old
gate correctly failed. Under the **desktop preset A14 specifies**, the same
unchanged artifact scores a composite of **94, 94, 93** — which would have
*passed* the old ≥ 90 gate outright. And with the four ceilings:

| Metric | Median | Ceiling | |
|---|---|---|---|
| FCP | 486ms | 2000ms | ✓ |
| LCP | 569ms | 2500ms | ✓ |
| TBT | 7ms | 400ms | ✓ |
| **CLS** | **0.133** | **0.1** | **✗** |

**A composite of 94 was hiding a cumulative layout shift of 0.133.** Three
metrics of four are not merely meeting their ceilings, two of them by an order
of magnitude — and the app still shifts under the reader, because the composite
gives CLS weight 25 out of 100 and lets FCP's 486ms pay for it. That is exactly
the dilution the amendment exists to end, demonstrated on this app rather than
argued in the abstract.

**The CLS is one defect with one cause, and it is located** / `layout-shift`
PerformanceObserver, 3 sources, one instant / At **t=1352ms** — when the
document fetch resolves and replaces the loading state — `.reader` goes from
582px to 706px wide, the **hero jump chips re-wrap**, and the first H3 section
arrives 524px lower than it was. One shift, three attributed nodes, all
downstream of the same reflow. It is not font swap (the `size-adjust` fallbacks
landed in M4.6 and CLS was not measured then) and not a lazy chunk (those are
idle-deferred past 2s, and the shift is at 1.35s).

**What is deliberately *not* being done about it here.** M4.9's brief is the
gate, not a layout fix, and a fix means changing the loading state's layout so
the reader column has its final width before the document arrives — a visible
product change on the first-paint path, which is the wrong thing to smuggle into
a commit that is supposed to be "implement the ratified gate". So the gate ships
failing, with the cause named and the fix understood, rather than passing.

**And the ceiling is not being touched.** 0.133 against 0.1 is 33% over. Widening
to 0.15 would turn CI green in one edit and would be the exact move the
amendment was ratified to prevent — a threshold that is moved to fit the
artifact is not a threshold. The honest state is a red gate with a diagnosed
cause, which is more useful than a green gate with an undocumented one.

**A gate that did not run, and passed** / `void main()` / Rewriting
`lighthouse.ts` at M4.9 dropped the `void main()` call at the bottom of the
file. The result was the worst outcome a gate can have: **full `npm run ci`
exited 0**, the Lighthouse stage printed nothing, and nothing failed. Typecheck
passed, all 874 unit tests passed, all 63 Playwright scenarios passed. A gate
that is not invoked is a gate that always passes, and no amount of correct logic
in a function nobody calls will catch that. `src/test/perf-gate.test.ts` now
asserts the call site exists, with a comment saying why.

**A second pre-existing race, found while verifying the first** /
`motion.spec.ts:172` / The first G5 CI run failed at Playwright 62/63 — the
mode-flip test, `Expected /^mode-flip-[ab]$/`, `Received "none"` — and CI never
reached the Lighthouse stage. It is **not** caused by M4.9: that commit's entire
`src/` diff is one new test file, and the same scenario passed in the run twenty
minutes earlier.

The cause is that the test races the animation it asserts. It clicks the mode
toggle, then `await expect(...).toHaveAttribute('data-reading-mode', …)`, which
polls, and only then reads the computed `animation-name` on `.reader`. The
transition is **250ms**. On a machine carrying nine orphaned Chromium processes
(load average 7.18) the attribute poll alone outlasts the transition, the
computed style has already reverted to `none`, and the assertion fails on a
correct implementation. `pkill` the strays and the same spec is **9/9 green**.

So it is a latent test defect that load exposes, not a regression, and it is
recorded rather than quietly re-run until green. The fix is not "add a wait" —
it is to assert the animation from a `getAnimations()` read taken *before* the
attribute poll, or to have the app set the animation-name and the test read it
synchronously in the same tick as the click. Both are test-side changes and
neither was in M4.9's scope.

**M4.10 — the CLS was the font swap, and the fix was a change M4.6 had already
made and then unmade for a reason that no longer applies** / `vite.config.ts`,
`preloadLatinFonts()` / M4.9's gate failed on CLS 0.148. Three hypotheses were
eliminated by measurement, in the order the brief lists them, and the answer was
none of them.

- *Milestone state re-initialising* (a): ruled out by reading the code —
  `createDelight` is `useMemo`'d and `fired` is closure state with a
  `fired.has()` guard. The module is not the defect. (Relevant to M4.11 below,
  where it turned out not to be the defect there either.)
- *`pop()` wired to section change* (b): ruled out by a geometry probe sampling
  every 55ms. `.reader` was **582px** wide at t=1223ms and **707px** at t=1281ms.
  The reading column is content-sized up to `--reading-column`, so a change in
  *where text wraps* changes the column's width and moves everything under it.
  That is a text-metric change, not a section change.
- *Wrong max* (c): ruled out — `useScrollProgress` computes
  `scrollTop / (scrollHeight − clientHeight)`, which is correct.

What was left was the thing the brief did not list: the `resource` timeline put
Geist's and Inter's woff2 responses completing at **t=1352ms**, and the single
layout-shift entry is at **t=1352ms**. Same millisecond. `font-display: swap`
paints the fallback, then the real face lands and re-wraps the document.

M4.6's `size-adjust` fallbacks reduce this and do not remove it: `Inter Fallback`
is matched to **93.43%** of Inter's advance width, and 6.6% moves wrap points.
Metric matching is the right fix for **LCP** — one element re-rendering — and
the wrong fix for **CLS**, which is every element below the re-wrap.

**So the fix is the font preloads M4.6 deleted, and the reason to re-measure
rather than re-apply or re-dismiss is the preset.** M4.6 measured preloads at a
composite of 86-with / 88-without under Lighthouse's **default preset** — a
throttled mobile emulation, 4x CPU and simulated slow 4G — and concluded that
three more requests on a throttled connection is contention, not saving. §10.1
/ A14 gates on the **desktop** preset, where there is no CPU throttling and no
simulated link. The premise of M4.6's removal does not describe the experiment
being run now. Re-measured under desktop:

| | M4.9 | M4.10 |
|---|---|---|
| FCP | 461ms | 477ms |
| LCP | 562ms | 668ms |
| TBT | 2ms | 2ms |
| **CLS** | **0.148** | **0.000** |
| a11y | 100 | 100 |
| composite | 93 | **99** |

Fonts now complete at **64–88ms** instead of 1352ms. `tests/e2e/cls.spec.ts`
asserts zero shift *and* that the latin faces land before 1000ms, and it was
verified to fail without the fix: `layout shifted by 0.1189 — sources: t=1306ms
[div.reader, button.hero-jump]`. Without the second assertion the test could
pass by luck on a document that happens not to reflow, and the defect would
return silently on a longer one.

**M4.11 — the human-reported cadence defect does not reproduce, and that is the
finding** / `tests/e2e/delight.spec.ts` / Confetti "fires after every section
change". The cadence test scrolls the full document in steps, asserts the burst
count is at most 4, then clicks six rail sections and asserts the count does not
move. **It passes on the current build.** There is no defect at the cadence
layer, so there is nothing to fix, and inventing a fix for a bug that is not
there would be worse than reporting the absence.

Two things are worth carrying forward, though, because they are real:

1. **The milestones under-fire, which is the opposite of the report.** A full
   scroll produced **one** burst, at ~65% progress. The 25% and 50% milestones
   did not fire. The likely cause is the same lazy rendering M4.6 deferred:
   `scrollHeight` grows as the idle-deferred mermaid and Shiki work lands, so a
   fraction of the page measured early is a smaller fraction of the page
   measured later, and the threshold is crossed in the wrong place. This is
   *under*-firing and is not the reported symptom.
2. **Counting confetti from the outside has two traps, and both read a
   confident zero while confetti was on screen.** `getContext('2d')` is never
   called through `HTMLCanvasElement.prototype`, and observing
   `document.documentElement` from an init script throws because the root
   element does not exist yet at that point. A test that reports "no confetti"
   when the truth is "nothing is watching" is worse than no test, and both are
   now recorded in the test itself.

**A pre-existing race that failed a real CI run, and is now fixed at the root** /
`motion.spec.ts:172` / It clicked the mode toggle, then
`await expect(...).toHaveAttribute(...)` — which polls — and only then read the
computed `animation-name` of a **250ms** transition. On a loaded machine the
poll outlasts the transition and a correct implementation reports `none`. M4.9
recorded this as load-dependent; it then failed an ordinary CI run, which
disproves that. The fix is to sample on every animation frame *while the
animation runs* and assert the `mode-flip` was observed — a stronger claim than
reading a value at an arbitrary later moment, because a transition that never
started produces no reading and the test fails.
