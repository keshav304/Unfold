/**
 * M4.14 §16 — real-document coverage, measured rather than assumed.
 *
 * Read-only. Nothing in this script writes to a document: it reads the markdown
 * in `testdocs/` (the demo document among them), finds every fence §6.9
 * classified as a terminal candidate, runs each through the ASCII diagram
 * parser, and prints what happened.
 *
 * The number that matters is the ratio of parsed to unparseable fences, and the
 * honesty of it depends on the document not being adjusted to suit the parser.
 * §28 of the milestone is explicit: a fence that cannot be parsed must stay a
 * terminal window, so a low ratio is a fact to report, not a problem to fix by
 * editing markdown. **The demo document is the test of genericity** — which is
 * why it is analysed first, and why the script never touches it.
 *
 * ```
 * npm run diagrams:coverage             # the report
 * npm run diagrams:coverage -- --shots  # the report, plus a screenshot of every
 *                                       # diagram as the served app renders it
 * ```
 */

import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describeDiagram, parseAsciiDiagram, type AsciiDiagram } from '../src/pipeline/ascii-diagram'
import { parseDocument } from '../src/pipeline/parse'
import { normalizeConfig } from '../src/pipeline/config'
import type { Block, Section } from '../src/pipeline/types'
import { PREVIEW_PORT, repoRoot, startServer } from '../tests/e2e/server'

const DOC_DIR = 'testdocs'
const OUT = join(repoRoot(), 'artifacts', 'diagrams')

/** Every terminal candidate in a document, in reading order, with its anchor. */
function terminalCandidates(doc: { intro: Block[]; sections: Section[] }): { id: string; code: string }[] {
  const found: { id: string; code: string }[] = []
  const visit = (blocks: readonly Block[], slug: string): void => {
    blocks.forEach((block, index) => {
      if (block.kind === 'terminal') found.push({ id: `${slug}#${index}`, code: block.code })
    })
  }
  visit(doc.intro, 'intro')
  const walk = (sections: readonly Section[]): void => {
    for (const section of sections) {
      visit(section.blocks, section.slug)
      walk(section.children)
    }
  }
  walk(doc.sections)
  return found
}

type Row = { doc: string; id: string; result: ReturnType<typeof parseAsciiDiagram> }

function analyse(): Row[] {
  const config = normalizeConfig(
    JSON.parse(readFileSync(join(repoRoot(), 'unfold.config.json'), 'utf8')) as unknown,
  )
  const demo = config.docPath.replace(/^\.\//u, '')
  const files = readdirSync(join(repoRoot(), DOC_DIR))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(DOC_DIR, name))
  // The configured document is analysed first, and only once even though it is
  // also a file in the directory: it is the demo, and the demo is the test.
  const ordered = [demo, ...files.filter((file) => file !== demo)]

  const rows: Row[] = []
  for (const file of ordered) {
    const doc = parseDocument(readFileSync(join(repoRoot(), file), 'utf8'), { fileName: file })
    for (const candidate of terminalCandidates(doc)) {
      rows.push({ doc: file, id: candidate.id, result: parseAsciiDiagram(candidate.code) })
    }
  }
  return rows
}

function report(rows: readonly Row[]): { parsed: number; total: number } {
  const parsed = rows.filter((row) => row.result.kind === 'diagram')
  process.stdout.write(`\nASCII diagram coverage — ${rows.length} terminal candidate(s)\n\n`)

  for (const row of rows) {
    const where = `${row.doc}  ${row.id}`
    if (row.result.kind === 'unparseable') {
      process.stdout.write(`  fallback  ${where}\n`)
      continue
    }
    const diagram: AsciiDiagram = row.result
    const nodes = diagram.nodes
      .map((node) => `${node.id}="${node.label.replace(/\n/gu, ' / ')}" @${node.row},${node.col}`)
      .join('  ')
    const edges = diagram.edges
      .map(
        (edge) =>
          `${edge.from}→${edge.to} (${edge.direction}${edge.dashed ? ', dashed' : ''}` +
          `${edge.label === undefined ? '' : `, "${edge.label}"`})`,
      )
      .join('  ')
    process.stdout.write(
      `  diagram   ${where}  ${diagram.nodes.length} nodes, ${diagram.edges.length} edges\n`,
    )
    process.stdout.write(`             nodes: ${nodes}\n`)
    process.stdout.write(`             edges: ${edges}\n`)
    process.stdout.write(`             label: ${describeDiagram(diagram)}\n`)
    if (diagram.annotations.length > 0) {
      process.stdout.write(
        `             notes:  ${diagram.annotations
          .map((note) => `"${note.text}" @${note.row},${note.col}`)
          .join(', ')}\n`,
      )
    }
  }

  const total = rows.length
  process.stdout.write(
    `\nParsed successfully: ${parsed.length} / ${total}\nFallback:            ${total - parsed.length} / ${total}\n`,
  )
  return { parsed: parsed.length, total }
}

/**
 * Screenshots of the diagrams as the **served** app renders them.
 *
 * The report proves the parser's reading; these prove the renderer's. A diagram
 * can parse perfectly and still be drawn badly, and the only way to see that is
 * to look at it — which is also why the diagram count is printed next to each
 * run: a page that rendered none is obvious in the log, not only in the image.
 */
async function shots(): Promise<void> {
  const { chromium } = await import('playwright')
  mkdirSync(OUT, { recursive: true })
  const server = await startServer(PREVIEW_PORT)
  const browser = await chromium.launch()
  try {
    for (const [name, width] of [
      ['desk', 1440],
      ['phone', 375],
    ] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      await page.goto(`http://127.0.0.1:${PREVIEW_PORT}/`, { waitUntil: 'load' })
      // M4.12 made `#/` the front door: arriving is not a request for the
      // document, so the reader has to be asked for the way a person asks. A
      // count of zero diagrams here would otherwise mean "no screenshots" and
      // read like "no diagrams".
      const open = page.getByRole('button', { name: /open the bundled document/i })
      await open.waitFor({ timeout: 10_000 })
      await open.click()
      await page.locator('.app').first().waitFor()
      const count = await page.locator('.ascii-diagram').count()
      for (let index = 0; index < count; index += 1) {
        await page.locator('.ascii-diagram').nth(index).scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(OUT, `${name}-diagram-${index + 1}.png`) })
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      process.stdout.write(
        `shots: ${name.padEnd(6)} ${String(width).padStart(4)}px  diagrams: ${count}  horizontal overflow: ${overflow}px\n`,
      )
      await context.close()
    }
  } finally {
    await browser.close()
    server.closeAllConnections()
    await new Promise<void>((done) => {
      server.close(() => done())
    })
  }
}

const main = async (): Promise<void> => {
  const { parsed, total } = report(analyse())
  if (process.argv.includes('--shots')) await shots()
  // Not a gate, and deliberately: §28 says a fallback is a legitimate outcome,
  // so failing on the ratio would be a milestone arguing with its own rules. The
  // exit code only asks whether the parser found anything at all, which is a
  // smoke signal that the pipeline is wired end to end.
  process.exitCode = parsed > 0 ? 0 : 1
  process.stdout.write(`\n(${parsed}/${total} fences in these documents render as SVG diagrams)\n`)
}

void main()

