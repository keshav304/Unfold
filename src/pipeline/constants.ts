/**
 * The single constants file. Every threshold and tunable the pipeline uses
 * lives here so that behaviour changes have exactly one home.
 */

/* ------------------------------------------------------------------ *
 * Derived graph (spec §6.7)
 * ------------------------------------------------------------------ */

/** Minimum number of valid internal cross-links for a derived document map. */
export const DERIVED_GRAPH_MIN_LINKS = 3

/** Minimum number of distinct H2 sections that must appear as a link endpoint. */
export const DERIVED_GRAPH_MIN_SECTIONS = 3

/* ------------------------------------------------------------------ *
 * Capabilities (spec §1.1)
 * ------------------------------------------------------------------ */

/** Minimum distinct file-path matches across the document for `entities`. */
export const ENTITIES_MIN_FILE_PATHS = 3

/** Minimum entries in a candidate glossary section for the `glossary` flag. */
export const GLOSSARY_MIN_ENTRIES = 2

/* ------------------------------------------------------------------ *
 * Entity extraction (spec §6.5 / §6.6)
 * ------------------------------------------------------------------ */

/** Default file extensions considered when matching a file path. */
export const DEFAULT_FILE_EXTENSIONS: readonly string[] = [
  'py',
  'ts',
  'tsx',
  'js',
  'jsx',
  'go',
  'rs',
  'java',
  'rb',
  'sh',
  'sql',
  'json',
  'yaml',
  'yml',
  'toml',
  'css',
  'html',
  'md',
]

/** Headings (exact, case-insensitive) that mark a glossary section. */
export const GLOSSARY_CANDIDATE_HEADINGS: readonly string[] = [
  'glossary',
  'terms',
  'terminology',
  'definitions',
  'appendix: terms',
]

/** Paragraph prefixes that declare explicit aliases (spec §6.6). */
export const ALIAS_LINE_PREFIXES: readonly string[] = ['aliases:', 'alias:']

/* ------------------------------------------------------------------ *
 * Indexes (spec §6.6)
 * ------------------------------------------------------------------ */

/**
 * The slug of the document introduction.
 *
 * §6.3 gives the introduction no heading, so it has no slug of its own. It is
 * still searchable content, and a hit on it has to navigate *somewhere*, so it
 * is given this one. The reader renders it as a real anchor, which makes
 * `#intro` a working deep link rather than a special case.
 */
export const INTRO_SLUG = 'intro'

/** Characters of context kept on each side of a search hit. */
export const SNIPPET_WINDOW = 45

/* ------------------------------------------------------------------ *
 * ASCII diagram detection (spec §6.9)
 * ------------------------------------------------------------------ */

/** Minimum lines containing box-drawing characters. */
export const TERMINAL_MIN_BOX_LINES = 2

/** Minimum arrow lines required by the arrow+box rule. */
export const TERMINAL_MIN_ARROW_LINES = 2

/* ------------------------------------------------------------------ *
 * DSL block info strings (spec §6.7 / §6.8 / §1.2)
 * ------------------------------------------------------------------ */

/** Fence info strings parsed as Unfold DSL rather than plain code. */
export const DSL_LANGUAGES = {
  graph: 'graph',
  steps: 'steps',
  loop: 'loop',
  mermaid: 'mermaid',
} as const

export type DslLanguage = (typeof DSL_LANGUAGES)[keyof typeof DSL_LANGUAGES]
