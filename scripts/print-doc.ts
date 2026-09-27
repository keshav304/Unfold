/**
 * DEV-ONLY: print the parsed Doc for a markdown file as JSON.
 *
 *   npm run print-doc -- testdocs/kitchen-sink.md
 *
 * Disposable debugging scaffolding — not part of the app bundle.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseDocument } from '../src/pipeline/parse'
import { getWarnings } from '../src/pipeline/warn'

const target = process.argv[2] ?? 'testdocs/kitchen-sink.md'
const source = readFileSync(target, 'utf8')
const doc = parseDocument(source, { fileName: basename(target) })

process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`)

const warnings = getWarnings()
if (warnings.length > 0) {
  process.stderr.write(`\n${warnings.length} warning(s):\n`)
  for (const warning of warnings) {
    process.stderr.write(`  [${warning.code}] ${warning.message}${warning.detail ? ` — ${warning.detail}` : ''}\n`)
  }
}
