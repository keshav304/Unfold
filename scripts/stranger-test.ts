/**
 * DEV-ONLY — the stranger test at the data level (plan §0 ritual).
 *
 * Parses real-world markdown the pipeline has never seen (READMEs shipped in
 * node_modules), and reports: throws, capability spread, sampled entity
 * extractions, and any false-positive file paths.
 *
 *   npm run stranger-test
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { parseDocument } from '../src/pipeline/parse'
import { setWarningEcho, setWarningSink } from '../src/pipeline/warn'
import { activeCapabilities } from '../src/pipeline/capabilities'
import type { Warning } from '../src/pipeline/warn'

const LIMIT = Number.parseInt(process.argv[2] ?? '14', 10)

function findReadmes(): string[] {
  const out = execFileSync('find', [
    'node_modules',
    '-name',
    'README.md',
    '-not',
    '-path',
    '*/node_modules/*/node_modules/*',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return out.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

const files = findReadmes()
const sample = files.slice(0, LIMIT)

process.stdout.write(`Stranger test: ${sample.length} real-world README(s) of ${files.length} found\n\n`)

let thrown = 0
let crashed = 0
const capabilityTally = new Map<string, number>()
const samples: { file: string; filePaths: string[] }[] = []
const allFalsePositives: { file: string; path: string }[] = []
const dslWarnings: Warning[] = []
const elapsed: number[] = []

for (const file of sample) {
  const source = readFileSync(file, 'utf8')
  const sink: Warning[] = []
  const previous = setWarningSink(sink)
  setWarningEcho(false)
  const started = performance.now()
  let doc
  try {
    doc = parseDocument(source, { fileName: basename(file) })
  } catch (error) {
    thrown += 1
    process.stdout.write(`  THREW   ${file}\n    ${String(error)}\n`)
    setWarningSink(previous)
    setWarningEcho(true)
    continue
  } finally {
    elapsed.push(performance.now() - started)
  }
  setWarningSink(previous)
  setWarningEcho(true)

  if (doc.title === '') crashed += 1
  if (JSON.stringify(doc).length === 0) crashed += 1

  for (const name of activeCapabilities(doc.capabilities)) {
    capabilityTally.set(name, (capabilityTally.get(name) ?? 0) + 1)
  }
  for (const warning of sink) {
    if (warning.code === 'dsl') dslWarnings.push({ ...warning, message: `${file}: ${warning.message}` })
  }
  samples.push({ file: file.replace('node_modules/', ''), filePaths: doc.indexes.filePaths.slice(0, 6) })

  // A false positive is a "path" that is really a URL, a version, or a sentence.
  for (const candidate of doc.indexes.filePaths) {
    if (/^https?$/i.test(candidate) || candidate.includes(' ') || /^\d+$/.test(candidate)) {
      allFalsePositives.push({ file: basename(file), path: candidate })
    }
  }
}

process.stdout.write(`throws: ${thrown}   empty/broken docs: ${crashed}\n`)
process.stdout.write(
  `parse time: min ${Math.min(...elapsed).toFixed(1)}ms  median ${[...elapsed].sort((a, b) => a - b)[Math.floor(elapsed.length / 2)]?.toFixed(1)}ms  max ${Math.max(...elapsed).toFixed(1)}ms\n\n`,
)

process.stdout.write('capability spread across the sample:\n')
if (capabilityTally.size === 0) process.stdout.write('  (none — every document was Tier 0)\n')
for (const [name, count] of [...capabilityTally].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${name.padEnd(10)} ${count}/${sample.length}\n`)
}

process.stdout.write('\nsampled entity extractions (first 6 paths per document):\n')
for (const entry of samples) {
  process.stdout.write(`  ${entry.file}\n`)
  for (const path of entry.filePaths) process.stdout.write(`      ${path}\n`)
}

process.stdout.write(`\nDSL degradations: ${dslWarnings.length}\n`)
for (const warning of dslWarnings.slice(0, 10)) {
  process.stdout.write(`  ${warning.message}${warning.detail === undefined ? '' : ` — ${warning.detail}`}\n`)
}

process.stdout.write(`\nfalse-positive file paths: ${allFalsePositives.length}\n`)
for (const entry of allFalsePositives.slice(0, 20)) {
  process.stdout.write(`  ${entry.file}: ${entry.path}\n`)
}
