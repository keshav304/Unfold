/**
 * Capability detection (spec §1.1). Every flag is a pure function of the parsed
 * document — plus, where the deployer has spoken, the config. Nothing here looks
 * at what a document says, only at what it contains.
 *
 *   graph     an explicit ```graph block, OR the §6.7 derivation thresholds
 *   stepper   a ```steps block
 *   glossary  a candidate heading with ≥ GLOSSARY_MIN_ENTRIES entries
 *   entities  ≥ ENTITIES_MIN_FILE_PATHS distinct file paths across the document
 *   mermaid   a ```mermaid block
 *   loop      a ```loop block
 *   terminal  an auto-detected ASCII diagram
 */

import { ENTITIES_MIN_FILE_PATHS, GLOSSARY_MIN_ENTRIES } from './constants'
import type { FeatureSwitch } from './config'
import type { Block, CapabilitySet, Doc, GlossaryEntry, GraphSpec, Section, StepSpec } from './types'

export type CapabilityInput = {
  blocks: readonly Block[]
  sections: readonly Section[]
  glossary: readonly GlossaryEntry[]
  /** Every distinct file path mentioned in prose, document-wide. */
  filePaths: readonly string[]
  /** An explicit `graph` block, if the document has one. */
  explicitGraph?: GraphSpec
  /** A derived document map, if the thresholds were met. */
  derivedGraph?: GraphSpec
  steps?: readonly StepSpec[]
  features?: { graph?: FeatureSwitch; stepper?: FeatureSwitch }
}

function hasKind(blocks: readonly Block[], kind: Block['kind']): boolean {
  return blocks.some((block) => block.kind === kind)
}

function allBlocks(sections: readonly Section[]): Block[] {
  const blocks: Block[] = []
  const visit = (list: readonly Block[]) => {
    for (const block of list) blocks.push(block)
  }
  for (const section of sections) {
    visit(section.blocks)
    for (const child of section.children) {
      visit(child.blocks)
      for (const grandchild of child.children) visit(grandchild.blocks)
    }
  }
  return blocks
}

/** Resolve a config switch against a detected value. */
export function applySwitch(detected: boolean, mode: FeatureSwitch | undefined): boolean {
  if (mode === 'off') return false
  if (mode === 'on') return true
  return detected
}

export function detectCapabilities(input: CapabilityInput): CapabilitySet {
  const sectionBlocks = allBlocks(input.sections)
  const blocks = [...input.blocks, ...sectionBlocks]

  const graphDetected = input.explicitGraph !== undefined || input.derivedGraph !== undefined

  return {
    graph: applySwitch(graphDetected, input.features?.graph),
    stepper: applySwitch(input.steps !== undefined && input.steps.length > 0, input.features?.stepper),
    glossary: input.glossary.length >= GLOSSARY_MIN_ENTRIES,
    entities: input.filePaths.length >= ENTITIES_MIN_FILE_PATHS,
    mermaid: hasKind(blocks, 'mermaid'),
    loop: hasKind(blocks, 'loop'),
    terminal: hasKind(blocks, 'terminal'),
  }
}

/** Capability names that are on, in a stable order. */
export function activeCapabilities(capabilities: CapabilitySet): (keyof CapabilitySet)[] {
  return (Object.keys(capabilities) as (keyof CapabilitySet)[]).filter((name) => capabilities[name])
}

/** Is this document Tier 0 only — reader, hero, TOC, search, nothing else? */
export function isTier0Only(capabilities: CapabilitySet): boolean {
  return activeCapabilities(capabilities).length === 0
}

/** Read the capability set off a finished document. */
export function capabilitiesOf(doc: Doc): CapabilitySet {
  return doc.capabilities
}
