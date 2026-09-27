/**
 * §6.9 — ASCII diagram detection. Three independent rules, any one of which
 * classifies an untagged fence as a terminal window.
 */

import { describe, expect, it } from 'vitest'
import { isAsciiDiagram } from './terminal'
import { parseMarkdown } from '../test/fixtures'

const box = [
  '+------------------+        +-----------------+',
  '| Client shell     | -----> | Ingest worker   |',
  '+------------------+        +-----------------+',
  '        |                            |',
  '        v                            v',
  '+------------------+        +-----------------+',
  '| Query planner    | <----- | Index store     |',
  '+------------------+        +-----------------+',
].join('\n')

describe('rule 1: box-drawing characters', () => {
  it('two or more box lines is a diagram', () => {
    expect(isAsciiDiagram('┌────┐\n│ a  │\n└────┘')).toBe(true)
  })

  it('one box line is not enough', () => {
    expect(isAsciiDiagram('┌────┐\nplain text')).toBe(false)
  })
})

describe('rule 2: a +---+ rule', () => {
  it('a single plus rule is a diagram', () => {
    expect(isAsciiDiagram('+--------+\nsome text')).toBe(true)
  })

  it('indentation is allowed', () => {
    expect(isAsciiDiagram('   +======+\n   text')).toBe(true)
  })
})

describe('rule 3: arrows plus box structure', () => {
  it('two arrow lines and a pipe line is a diagram', () => {
    expect(isAsciiDiagram('a --> b\nc <-- d\n| e |')).toBe(true)
  })

  it('arrow lines alone are not a diagram', () => {
    expect(isAsciiDiagram('a --> b\nc --> d')).toBe(false)
  })

  it('one arrow line plus pipes is not a diagram', () => {
    expect(isAsciiDiagram('a --> b\n| e |')).toBe(false)
  })

  it('unicode arrows count', () => {
    expect(isAsciiDiagram('a → b\nc → d\n| e |')).toBe(true)
  })
})

describe('prose and code are not diagrams', () => {
  it.each([
    'just a sentence with no structure',
    'const x = 1\nconst y = 2',
    'function foo() {\n  return 1\n}',
    '',
    'a single line',
  ])('%j is not a diagram', (code) => {
    expect(isAsciiDiagram(code)).toBe(false)
  })
})

describe('classification in a document', () => {
  it('an untagged diagram fence becomes a terminal block', () => {
    const { doc } = parseMarkdown(`# T\n\n\`\`\`\n${box}\n\`\`\``)
    expect(doc.intro[0]?.kind).toBe('terminal')
  })

  it('a tagged fence is never a terminal, even when it draws boxes', () => {
    const { doc } = parseMarkdown(`# T\n\n\`\`\`text\n${box}\n\`\`\``)
    expect(doc.intro[0]?.kind).toBe('code')
  })

  it('an untagged fence of ordinary code stays a code block', () => {
    const { doc } = parseMarkdown(`# T\n\n\`\`\`\nconst x = 1\n\`\`\``)
    expect(doc.intro[0]?.kind).toBe('code')
  })
})
