/**
 * `unfold.config.json` (spec §1.4). Deployer-facing and entirely optional:
 * every field has a default, and zero-config must work. Parsing never throws —
 * a broken config degrades to defaults plus a warning.
 */

import { DEFAULT_FILE_EXTENSIONS } from './constants'
import { warn } from './warn'

/** `auto` = capability-detected, `off` = force hidden, `on` = force shown. */
export type FeatureSwitch = 'auto' | 'off' | 'on'

/**
 * How an untagged ASCII fence is presented (M4.14, spec §6.9).
 *
 * `auto` — attempt the ASCII diagram parse; a fence that parses renders as an
 * SVG diagram and one that does not renders as the existing terminal window.
 *
 * `terminal` — never attempt the parse. Every terminal candidate renders as the
 * terminal window it rendered as before this milestone. The escape hatch: it is
 * how a deployer can turn the feature off, and how a defect can be bisected
 * without a code change.
 */
export type DiagramsMode = 'auto' | 'terminal'

export type UnfoldConfig = {
  /** Path or URL of the markdown document to load. */
  docPath: string
  /** Overrides the document's own title. */
  title?: string
  /** Overrides `--primary` at runtime. Any CSS color value. */
  accent?: string
  features: {
    graph: FeatureSwitch
    stepper: FeatureSwitch
    /** M4.14. Defaults to `auto`, which is the whole feature. */
    diagrams: DiagramsMode
  }
  /** File extensions treated as file paths by entity extraction. */
  fileExtensions: string[]
  /** Extra source-file regexes, each with a global flag. */
  entityPatterns: { name: string; pattern: string }[]
  /** Description map for entity popovers; empty by default (spec §7.5). */
  descriptions: Record<string, string>
}

export const DEFAULT_CONFIG: UnfoldConfig = {
  docPath: './document.md',
  features: { graph: 'auto', stepper: 'auto', diagrams: 'auto' },
  fileExtensions: [...DEFAULT_FILE_EXTENSIONS],
  entityPatterns: [],
  descriptions: {},
}

function asFeatureSwitch(value: unknown, fallback: FeatureSwitch): FeatureSwitch {
  return value === 'auto' || value === 'off' || value === 'on' ? value : fallback
}

function asDiagramsMode(value: unknown, fallback: DiagramsMode): DiagramsMode {
  return value === 'auto' || value === 'terminal' ? value : fallback
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  return items.length === 0 ? undefined : items.map((item) => item.trim())
}

function asPatternList(value: unknown): { name: string; pattern: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const patterns: { name: string; pattern: string }[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record['name'] !== 'string' || typeof record['pattern'] !== 'string') continue
    try {
      // Validate now so a bad regex cannot explode mid-parse later.
      new RegExp(record['pattern'], 'gu')
    } catch {
      warn('config', 'ignoring entity pattern with an invalid regular expression', record['name'])
      continue
    }
    patterns.push({ name: record['name'], pattern: record['pattern'] })
  }
  return patterns.length === 0 ? undefined : patterns
}

function asRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** Merge a parsed (or absent) config object over the defaults. */
export function normalizeConfig(raw: unknown): UnfoldConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_CONFIG }
  const record = raw as Record<string, unknown>
  const features =
    typeof record['features'] === 'object' && record['features'] !== null
      ? (record['features'] as Record<string, unknown>)
      : {}

  const extensions = asStringArray(record['fileExtensions'])
  const patterns = asPatternList(record['entityPatterns'])
  const descriptions = asRecord(record['descriptions'])

  return {
    docPath: typeof record['docPath'] === 'string' && record['docPath'].trim() !== ''
      ? record['docPath']
      : DEFAULT_CONFIG.docPath,
    ...(typeof record['title'] === 'string' ? { title: record['title'] } : {}),
    ...(typeof record['accent'] === 'string' ? { accent: record['accent'] } : {}),
    features: {
      graph: asFeatureSwitch(features['graph'], DEFAULT_CONFIG.features.graph),
      stepper: asFeatureSwitch(features['stepper'], DEFAULT_CONFIG.features.stepper),
      diagrams: asDiagramsMode(features['diagrams'], DEFAULT_CONFIG.features.diagrams),
    },
    fileExtensions: extensions ?? [...DEFAULT_CONFIG.fileExtensions],
    entityPatterns: patterns ?? [],
    descriptions: descriptions ?? {},
  }
}

/** Parse the text of `unfold.config.json`. Invalid JSON → defaults + warning. */
export function parseConfig(text: string): UnfoldConfig {
  if (text.trim() === '') return { ...DEFAULT_CONFIG }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    warn('config', 'unfold.config.json is not valid JSON; using defaults', String(error))
    return { ...DEFAULT_CONFIG }
  }
  return normalizeConfig(raw)
}
