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
