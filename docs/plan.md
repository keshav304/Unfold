# PLAN.md — Unfold build plan

Execution plan for `docs/spec.md`. The spec says **what**; this says **in what
order, how to verify, and where to stop and check**. Work one milestone at a
time. Do not start a milestone until the previous one's gate passes.

**Effort granularity:** 1 session ≈ one focused agent session with human review
(2–4h). Estimates assume the human reviews at gates; skipping gates is how the
genericity contract dies.

## 0. How to run each session (agent protocol)

Give the agent, every time: `docs/spec.md` + `docs/plan.md` + `designs/` +
relevant fixture/demo doc. Then:

1. **Scope guard:** one milestone (or one named task) per session. Anything
   beyond it goes on the backlog list at the bottom of this file, not into code.
2. **Hard rules, restated every session:**
   - No document strings, brand names, or demo-specific content anywhere in
     `src/` (exception: `testdocs/` fixtures).
   - No hardcoded hex/radii/shadows — `tokens.css` only (§5.2).
   - No new dependency without a one-line justification mapped to §4.
   - Tests green before UI work proceeds. `typecheck → vitest → build` (§11).
   - `ARCHITECTURE.md` (demo doc) is **data** — the agent never edits it.
3. **End-of-session ritual (non-negotiable):** the "stranger test" — load a
   markdown file the agent has never seen (any GitHub README). Zero console
   errors, nothing demo-specific rendered, degraded features hidden not broken.
4. Commit per task, message = task ID (`M0.3: github-parity slugs + vectors`).

## 1. Milestone overview

| ID | Milestone | Sessions | Depends on | Gate |
|---|---|---|---|---|
| P0 | Bootstrap & fixtures | 1 | — | G0 |
| M0 | Pipeline: parse → Doc → capabilities | 2 | P0 | G1 ⚠️ highest-leverage |
| M1 | Reader experience | 2–3 | M0 | G2 |
| M2 | Search + palette + entities | 2 | M0 (indexes), M1 (UI shell) | G3 |
| M3 | Graph + stepper + workbench | 2–3 | M0 (DSL, thresholds), M1 | G4 |
| M4 | Modes, mobile, a11y, motion, delight | 2 | all | G5 = release |

Total: ~11–14 sessions. Cut lines per milestone in §8.

## 2. P0 — Bootstrap & fixtures

**Goal:** everything M0 consumes exists before any app code.

- [x] P0.1 Init Vite + React 18 + TS strict + Tailwind; Vitest wired; CI
      script (`typecheck → vitest → build`) running green on an empty app.
- [x] P0.2 Extract `src/styles/tokens.css` from DESIGN.md + §5.2 table.
      Include elevation shadows, `--gradient`, grid-line color. Confirm zero
      hex values anywhere else (grep check later).
- [x] P0.3 Self-host fonts (Geist, Inter, JetBrains Mono, subsets,
      `font-display: swap`) + `tnum` utility.
- [x] P0.4 Author the five fixtures in `testdocs/` per §11 table. `kitchen-sink.md`
      must include: frontmatter, tables, tagged code, ASCII diagram, mermaid,
      loop, **explicit graph block, steps block**, glossary with an explicit
      `Aliases:` line, entity paths, duplicate headings.
- [x] P0.5 Author `crosslinked.md`: NO graph block, exactly 3 internal
      cross-links across exactly 3 H2s (boundary fixture).
- [ ] P0.6 Prepare the demo doc (you, not the agent): optionally add
      ` ```graph ` / ` ```steps ` blocks to `ARCHITECTURE.md` — it's an authoring
      task on data, not code.

**Gate G0:** fixtures parse under a scratch remark script; tokens.css renders a
swatch page correctly; CI green.

## 3. M0 — Pipeline (⚠️ the milestone that decides everything)

**Goal:** `md file → Doc object` as a pure, tested function (§6.2–6.3). No UI.

- [x] M0.1 Loader + config: `fetch(docPath)` with 404/`file://` fallback path
      stubbed; `unfold.config.json` parser (§1.4, all fields optional).
- [x] M0.2 Frontmatter + mdast parse → raw AST (§6.2).
- [x] M0.3 Section splitter (H2 top-level, H3 nested) + block classifier,
      including ASCII `terminal` detection (§6.9) and `loop` parsing.
- [x] M0.4 **GitHub-parity slugs** (§6.4) + duplicate `-1/-2` suffixing +
      test vectors. This is the #1 source of broken anchors — test it to death.
- [x] M0.5 Entity extraction (§6.5): file paths, `path::symbol`, test ids,
      glossary terms. No scanning inside code blocks. Config-extensible list.
- [x] M0.6 Glossary assembly (§6.6): candidate headings, merge, explicit-only
      aliases.
- [x] M0.7 Graph + steps DSL parsers (§6.7–6.8) with graceful failure →
      `code` block.
- [x] M0.8 Capability detection (§1.1) + derived-graph thresholds (§6.7):
      constants `DERIVED_GRAPH_MIN_LINKS/SECTIONS = 3` in one constants file.
- [x] M0.9 Indexes (§6.6): minisearch build, backlinks, per-section text with
      snippet windows.
- [x] M0.10 Tests §11.1–11.7 (golden snapshots per fixture, slug vectors,
      capability matrix, threshold boundaries, DSL degradation, glossary,
      extraction). All green.

**Gate G1 — do not proceed without this:**
- All fixtures parse; golden snapshots committed.
- **Capability matrix exact:** `minimal`→none · `crosslinked`→derived graph ·
  `kitchen-sink`→all · `no-structure`→Tier 0 only.
- **Stranger test at the data level:** parse 3 unseen READMEs — no throw, sane
  Doc, no false entities from their code fences.
- Agent can print the full Doc JSON for `kitchen-sink` and every field is
  explainable. If G1 is soft, every later milestone is built on sand.

## 4. M1 — Reader experience

**Goal:** the §7.1–7.3 reader, faithful to refs, running on the real pipeline.

- [x] M1.1 App shell: header (menu/title/search trigger/mode/view switcher —
      switcher renders only when capable), hash routing (`#slug`, `#/graph`,
      `#/stepper`).
- [x] M1.2 Block renderers: prose, code (Shiki + header strip + copy, §7.1),
      tables (scroll wrapper, sticky header), quote, list, hr, terminal window
      (§6.9 styling).
- [x] M1.3 `loop` SVG renderer + `mermaid` lazy renderer (dark theme).
- [x] M1.4 Internal links: in-app scroll + flash; unresolvable → muted +
      tooltip (§6.4).
- [x] M1.5 Hero (§7.2): title fallback chain, stats, jump chips, canvas-grid
      ambient background.
- [x] M1.6 Metro TOC (§7.3): rail, fill, scrollspy (IntersectionObserver),
      now-reading chip; drawer + scrim <1280px.
- [x] M1.7 Progress bar, back-to-top, loader/drop screen with drag-drop
      (§6.1, §7.10).
- [x] M1.8 Component tests §11.9 subset + budgets check on `kitchen-sink`.
- [x] M1.9 Preview-mode review fixes: A5 HTML rejection, ship `testdocs/`
      in the build, HTTP `ui-smoke`, rail-less grid collapse.

**Gate G2:** all five fixtures + stranger README render cleanly; view switcher
absent on `minimal`; breakpoints behave per §5.3 (spot-check 1280/768/375);
Lighthouse ≥ 90/95.

## 5. M2 — Search, palette, entities

**Goal:** REFERENCE speed (§7.4–7.5). Indexes exist since M0.9 — this is UI.

- [x] M2.0 A3 amendment: a table cell is a list of inline runs (`InlineRun`), not a
      string, so cells render through the shared inline pipeline — entity chips
      included. Pipeline + snapshots + fixture expectations.
- [x] M2.1 ui-smoke promoted into `npm run ci`; the stranger subset stays behind
      `ui-smoke:stranger`. The unused `stubLayout` helper is gone.
- [x] M2.2 cmdk palette: Level-3 elevation, spring-in (signature motion #1,
      `--ease-spring` + a `--motion-*` duration), focus trap and focus restore to
      the trigger. ⌘K / Ctrl+K and `/`, with `/` inert in a text field.
- [x] M2.3 Result groups: Sections / Files / Glossary — a group renders only when
      its data exists; ±45-char snippets; the match marked in a `<mark>`.
      Keyboard-complete. (A4: results + navigation only, no static actions.)
- [x] M2.4 Entity chips in the shared inline renderer: file / `path::symbol` /
      test-id chips in prose and inside inline code spans; per-section dedupe;
      real `<button>`s so keyboard users get the popover for free.
- [x] M2.5 Glossary chips: word-bounded, case-insensitive, aliases included,
      prose-only per A2.
- [x] M2.6 Popovers (§7.5): Level-2 glass card portalled to `<body>` and
      positioned `fixed` (the table-cell clipping trap), backlinks list, navigate
      + flash, descriptions map empty by default.
- [x] M2.7 Tests: alias hit lands on its parent term, `minimal` shows no entity
      UI and a Sections-only palette, palette triggers/arrows/Enter/Esc and the
      `/`-in-input guard, chip inside backticks (A2), chip inside a table cell
      (A3), popover focus-open/Esc/portal target.
- [x] M2.8 Budget: entry 131.9KB gz (§10 limit 200KB); cmdk is bundled into the
      entry chunk, not a lazy one.

- [x] M2.PW1 `tests/e2e/` Playwright project, its own `test:e2e` script, wired
      into `npm run ci` after the unit suite. Global setup builds once and serves
      `dist/` with SPA fallback, a path-traversal guard and a second mount for
      documents outside `dist/`. Every context runs `reducedMotion: 'reduce'`.
- [x] M2.PW2 Served-artifact scenarios: kitchen-sink (title from frontmatter, no
      raw `---`, terminal/loop/mermaid present, no horizontal overflow at 1440 or
      375), a wrong `docPath` refused with the A5 drop screen, `no-structure` with
      no rail and a full-width single column asserted by bounding box. Every
      scenario fails on any console error or warning.
- [x] M2.PW3 The palette in a real engine: ⌘K open, arrows, Enter navigates, Esc
      restores focus to the trigger (asserted on `document.activeElement`), `/`
      inert in an input, Tab cycles inside the palette, Esc on a chip's popover
      returns focus to the chip, and axe-core reports zero violations on the open
      palette.
- [x] M2.PW4 Lighthouse against the preview server each run, `CHROME_PATH` pointed
      at Playwright's chromium. **a11y ≥ 95 is a hard fail** (it scores 96);
      performance is recorded to `artifacts/lighthouse.json` only, per A6.
- [x] One screenshot per scenario in `artifacts/e2e/`, never diffed — visual
      regression is adopted at the M4 freeze.

**Backlog (added at G3):** Playwright screenshot-diff baselines, at the M4 freeze.

**Gate G3:** search smoke §11.8 green on every fixture; `/` and ⌘K both work;
popovers open via keyboard focus; `minimal.md` renders zero chips.

## 6. M3 — Graph + stepper + workbench

**Goal:** the SKIM showpieces (§7.6–7.7) with both graph modes proven.

- [ ] M3.1 Lazy React Flow chunk; canvas on `--grid-line`; metro node styling
      (§7.6: shell/stroke/active gradient wash; edge dash-glow).
- [ ] M3.2 Explicit graph rendering + `Architecture` labeling.
- [ ] M3.3 Derived `Document map` from precomputed links + `Auto-generated
      map` chip; below-threshold → capability off.
- [ ] M3.4 Inspector panel (440px): slide-in (signature motion #2), first
      prose block, file chips, "Open section" → reader.
- [ ] M3.5 Workbench layout per §5.3: ≥1280 3-zone; 768–1279 50/50; <768
      segmented tabs (Docs / Visual Graph — no Metrics tab).
- [ ] M3.6 Stepper view (§7.7): horizontal/vertical, ←/→, progress dots,
      deep-link per step, `@slug` source links.
- [ ] M3.7 Graph a11y: focusable labeled nodes, Enter/Esc.
- [ ] M3.8 Threshold boundary tests (§11.4) wired to the real UI states.

**Gate G4:** boundary demo (2 links off / 3 on, explicit wins); keyboard walk
of graph + stepper clean; every `sectionSlug` in graph/stepper data validates.

## 7. M4 — Modes, polish, release

**Goal:** the last 20% that makes it feel finished (§7.8–7.10, §8–§10).

- [ ] M4.1 Executive/Reference mode (§7.8): per-section rule, "show all"
      override, transition, localStorage persist.
- [ ] M4.2 Mobile pass: all views at 375px; tabs; drawer; touch targets.
      - [ ] **Header title collapses to a 1px stub at 375px** (found at G3, in
            `artifacts/e2e/02-kitchen-sink-mobile.png`): the search button and
            the view switcher consume the row. Fix it *here*, not in M3 — M3 adds
            the segmented tabs to this same header region, and batching the two
            is one layout change instead of two.
- [ ] M4.3 A11y audit: §9 checklist, `:focus-visible` rings, AA on chips +
      muted text (the usual failures).
      - [ ] **Apply the `--text-subtle` contract decided at G3** (see
            `DECISIONS.md`): `--text-subtle` becomes inactive/decorative only,
            and all nine informational uses move to `--text-muted`. The token
            *value* is unchanged, so this is a find-and-replace over the table
            in that entry, not a design decision.
      - [ ] Delete `KNOWN_OWNED_BY_M4_3` from `tests/e2e/palette.spec.ts`; the
            axe gate goes back to zero violations.
      - [ ] Add the `tokens.test.ts` guard: no rule may use `--text-subtle`
            outside an explicit inactive/decorative allowlist. Lands with the
            migration, not before it.
- [ ] M4.4 Motion audit (§8): exactly 3 signature moments; reveals fire once;
      reduced-motion → full static fallback verified.
- [ ] M4.5 Delight behind `features.delight` (§7.10); off under
      reduced-motion.
- [ ] M4.6 Perf pass (§10): lazy chunks verified in build output; ≤200KB
      initial gz; Lighthouse re-run.
      - [ ] **TBT 520ms** (G3 CI baseline) and LCP 4.3s. Likely initial render
            plus lazy-chunk resolution on `kitchen-sink`, which is the
            fixture the audit loads. Work the LCP waterfall fix A6 deferred here.
      - [ ] **Compare CI-to-CI.** Headless Lighthouse is not DevTools and the
            numbers are not comparable across harnesses. The G3 CI run —
            perf 62, a11y 96, bp 100, seo 82; FCP 3.4s, LCP 4.3s, TBT 520ms,
            CLS 0.022, SI 4.8s — is the baseline, and `artifacts/lighthouse.json`
            is regenerated every CI run, so the comparison is mechanical.
      - [ ] Perf assertions still do not exist and are not added before the
            waterfall work; until then the audit records, per A6.
- [ ] M4.7 Deploy: static `dist/` to Netlify/GH Pages; `base` config if
      subpath; final stranger test against the deployed URL.
- [ ] **Optional:** a lighter render-test fixture. The unit suite is 51s, mostly
      full-`kitchen-sink` renders including the lazy mermaid chunk. Not urgent —
      CI is 2m16s — but it is the lever if the suite keeps growing.

**Gate G5 = release.** Full §11 suite green on CI; §13 M4 criteria checked;
README with: what it is, config reference (§1.4), authoring conventions
(§1.2), v1 limits (§15).

## 8. Cut lines (if time compresses)

Drop in this order — each cut leaves a coherent product:
1. Delight (M4.5) — one flag.
2. Stepper (M3.6–3.7) — capability-gated anyway.
3. Derived document map (keep explicit-graph only).
4. Popover descriptions (keep backlinks-only cards).
**Never cut:** slugs (M0.4), capability tests (§11.3), stranger test ritual,
budgets, reduced-motion.

## 9. Standing risk checks (per session)

| Smell | Response |
|---|---|
| Demo strings in `src/` | Reject; move to fixture/config |
| New hex in a component | Reject; token first |
| New dep "just for X" | Justify vs §4 or reject |
| Tests edited to pass | Reject; fix the code |
| Ref HTML copy-paste growing | Refactor to component + tokens |
| Feature rendered for missing data | Violates §1.3; hide it |

## 10. Backlog (post-v1, from spec §15)

- Light theme design + `[data-theme]` activation
- `?doc=<url>` remote ingestion (CORS/SSRF review first)
- Multi-document browsing / doc switcher
- Light Shiki/mermaid theme pairing
- Config-extensible entity regexes surfaced as API
