/**
 * Fixture helpers. Tests read the real files from `testdocs/` so the fixtures
 * are the contract — never a copy of them.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UnfoldConfig } from '../pipeline/config'
import { parseDocument } from '../pipeline/parse'
import { clearWarnings, getWarnings, setWarningEcho, setWarningSink, type Warning } from '../pipeline/warn'
import type { Block, Doc, Section } from '../pipeline/types'

const here = dirname(fileURLToPath(import.meta.url))
export const TESTDOCS_DIR = resolve(here, '../../testdocs')

export const FIXTURES = [
  'minimal',
  'kitchen-sink',
  'crosslinked',
  'no-structure',
  'edge-cases',
] as const

export type FixtureName = (typeof FIXTURES)[number]

export function fixturePath(name: FixtureName): string {
  return join(TESTDOCS_DIR, `${name}.md`)
}

export function readFixture(name: FixtureName): string {
  return readFileSync(fixturePath(name), 'utf8')
}

/**
 * Parse a fixture with warnings captured, so a test can assert both on the Doc
 * and on the dev-mode diagnostics. The console is never written to.
 */
export function parseFixture(name: FixtureName, source?: string): { doc: Doc; warnings: Warning[] } {
  const previous = setWarningSink([])
  setWarningEcho(false)
  try {
    const doc = parseDocument(source ?? readFixture(name), { fileName: `${name}.md` })
    return { doc, warnings: getWarnings() }
  } finally {
    setWarningSink(previous)
    setWarningEcho(true)
  }
}

/** Parse a markdown string with warnings captured. */
export function parseMarkdown(
  source: string,
  options: { fileName?: string; config?: UnfoldConfig } = {},
): { doc: Doc; warnings: Warning[] } {
  const previous = setWarningSink([])
  setWarningEcho(false)
  try {
    const doc = parseDocument(source, {
      fileName: options.fileName ?? 'test.md',
      ...(options.config === undefined ? {} : { config: options.config }),
    })
    return { doc, warnings: getWarnings() }
  } finally {
    setWarningSink(previous)
    setWarningEcho(true)
  }
}

export function clearAllWarnings(): void {
  clearWarnings()
}

/** Block kinds present in a block list, in order, with duplicates. */
export function kindsOf(blocks: readonly Block[]): string[] {
  return blocks.map((block) => block.kind)
}

/** Block-kind histogram, sorted by kind name for stable snapshots. */
export function kindCounts(blocks: readonly Block[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const kind of kindsOf(blocks)) counts[kind] = (counts[kind] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

/** Depth-first section tree with slugs, levels and block-kind histograms. */
export function sectionTree(sections: readonly Section[]): unknown[] {
  return sections.map((section) => ({
    level: section.level,
    slug: section.slug,
    title: section.title,
    kinds: kindCounts(section.blocks),
    files: section.files.map((file) => (file.symbol === undefined ? file.path : `${file.path}::${file.symbol}`)),
    tests: section.tests.map((test) => test.id),
    linksTo: section.linksTo,
    children: sectionTree(section.children),
  }))
}

/** Every section, depth-first. */
export function allSections(sections: readonly Section[]): Section[] {
  const out: Section[] = []
  const visit = (list: readonly Section[]) => {
    for (const section of list) {
      out.push(section)
      visit(section.children)
    }
  }
  visit(sections)
  return out
}

/** Every block in a document, intro included. */
export function allBlocksOf(doc: Doc): Block[] {
  return [...doc.intro, ...allSections(doc.sections).flatMap((section) => section.blocks)]
}
