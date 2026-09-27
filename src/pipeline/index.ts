/** Public surface of the content pipeline (spec §6). No UI lives here. */

export * from './types'
export * from './constants'
export { parseDocument, blockToProseText, type ParseOptions } from './parse'
export { parseConfig, normalizeConfig, DEFAULT_CONFIG, type UnfoldConfig, type FeatureSwitch } from './config'
export { loadDocument, isFileProtocol, type LoadResult, type LoadFailureReason } from './loader'
export { slugify, Slugger, uniqueSlugFactory } from './slug'
export { isAsciiDiagram } from './terminal'
export { classifyNode, internalLinksOf, normaliseLang, type ClassifyResult } from './blocks'
export { splitSections, type SplitResult } from './sections'
export { extractEntities, proseRunsOf, type EntityOptions, type ExtractedEntities } from './entities'
export { buildGlossary, isGlossaryCandidate, parseAliasLine } from './glossary'
export { parseGraph } from './dsl/graph'
export { parseSteps, type StepParseResult } from './dsl/steps'
export { parseLoop, LOOP_MIN_LABELS } from './dsl/loop'
export { DslParseError } from './dsl/types'
export {
  detectCapabilities,
  activeCapabilities,
  isTier0Only,
  applySwitch,
  type CapabilityInput,
} from './capabilities'
export { deriveGraph, resolveToH2, type CrossLink, type DerivationResult } from './derive-graph'
export {
  flattenSections,
  buildSearchRecords,
  buildBacklinks,
  createSearchIndex,
  snippetAround,
  type Snippet,
} from './indexes'
export {
  toPlainText,
  toPlainTextLines,
  toProseText,
  collectProseRuns,
  blocksToPlainText,
  countWords,
  walk,
} from './mdast-text'
export { setWarningSink, setWarningEcho, getWarnings, clearWarnings, warn, type Warning } from './warn'
