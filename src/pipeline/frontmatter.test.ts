/**
 * Frontmatter (spec §6.2, §1.2).
 *
 * These tests exist because a real bug shipped through here: the CommonJS
 * `gray-matter` default export did not survive the browser build, so in a real
 * page the frontmatter block was rendered as document text and the title fell
 * back to the H1. The unit tests all passed, because they run in Node.
 */

import { describe, expect, it } from 'vitest'
import { splitFrontmatter } from './frontmatter'
import { parseDocument } from './parse'
import { readFixture } from '../test/fixtures'

describe('splitFrontmatter', () => {
  it('reads a simple mapping', () => {
    const result = splitFrontmatter('---\ntitle: Hello\ndescription: World\n---\n\n# Body\n')
    expect(result.present).toBe(true)
    expect(result.data).toEqual({ title: 'Hello', description: 'World' })
    expect(result.body).toBe('\n# Body\n')
  })

  it('returns the whole source when there is no block', () => {
    const source = '# Just a document\n'
    const result = splitFrontmatter(source)
    expect(result.present).toBe(false)
    expect(result.body).toBe(source)
  })

  it('an unterminated block is not a block', () => {
    const source = '---\ntitle: x\n\n# Body\n'
    expect(splitFrontmatter(source).present).toBe(false)
  })

  it('a `---` that is not on the first line is a thematic break, not frontmatter', () => {
    const source = '# Title\n\n---\n\nmore\n'
    expect(splitFrontmatter(source).present).toBe(false)
  })

  it('a sequence is valid YAML but carries no frontmatter map', () => {
    const result = splitFrontmatter('---\n- a\n- b\n---\n\n# Body\n')
    expect(result.present).toBe(true)
    expect(result.data).toEqual({})
    expect(result.malformed).toBe(true)
    // The body is still delivered — a document is never lost to bad metadata.
    expect(result.body).toContain('# Body')
  })

  it('malformed YAML is skipped, and the body survives', () => {
    const result = splitFrontmatter('---\ntitle: "unclosed\n---\n\n# Body\n')
    expect(result.malformed).toBe(true)
    expect(result.body).toContain('# Body')
  })

  it('an empty block is valid and empty', () => {
    const result = splitFrontmatter('---\n---\n\n# Body\n')
    expect(result.present).toBe(true)
    expect(result.data).toEqual({})
  })

  it('handles CRLF line endings', () => {
    const result = splitFrontmatter('---\r\ntitle: Hello\r\n---\r\n\r\n# Body\r\n')
    expect(result.data).toEqual({ title: 'Hello' })
    expect(result.body).not.toContain('title:')
  })

  it('does not treat a `---` inside a YAML block value as the close', () => {
    const result = splitFrontmatter('---\ndescription: |\n  a\n  ---\n  b\n---\n\n# Body\n')
    expect(result.data['description']).toContain('---')
  })
})

describe('the frontmatter never reaches the reader as text', () => {
  it.each(['kitchen-sink'])('%s has its title from frontmatter, not the H1', (name) => {
    const doc = parseDocument(readFixture(name as 'kitchen-sink'), { fileName: `${name}.md` })
    expect(doc.titleSource).toBe('frontmatter')
    expect(doc.title).toBe('Kitchen Sink Fixture')
    expect(doc.description).toBeTypeOf('string')
  })

  it('no block in the rendered output begins with the YAML keys', () => {
    const doc = parseDocument(readFixture('kitchen-sink'), { fileName: 'kitchen-sink.md' })
    const text = [...doc.intro, ...doc.sections.flatMap((s) => s.blocks)]
      .map((block) => (block.kind === 'prose' ? JSON.stringify(block.node) : ''))
      .join(' ')
    expect(text).not.toContain('title: Kitchen Sink Fixture')
  })
})
