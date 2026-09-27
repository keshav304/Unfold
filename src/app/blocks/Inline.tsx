/**
 * Inline content rendering: text, emphasis, strong, inline code, links.
 *
 * Internal links (`#slug`) resolve in-app (scroll + flash). Unresolvable ones
 * render as muted text with a tooltip — never as broken navigation (§6.4).
 * No `dangerouslySetInnerHTML` anywhere (§4).
 */

import type { Content, RootContent } from 'mdast'
import { Fragment, type ReactNode } from 'react'
import { internalLinksOf } from '../../pipeline/blocks'
import { navigate } from '../navigate'

export type InlineContext = {
  /** Slugs that exist in the document. */
  slugs: ReadonlySet<string>
  /** Called after an in-app navigation so the shell can flash the target. */
  onNavigate?: (slug: string) => void
}

function childrenOf(node: Content | RootContent): ReactNode {
  const node_ = node as { children?: Content[] }
  const children = node_.children ?? []
  return children.map((child, index) => renderInline(child, index))
}

export function renderInline(node: Content | RootContent, key: number, context?: InlineContext): ReactNode {
  switch (node.type) {
    case 'text':
      return <Fragment key={key}>{node.value}</Fragment>

    case 'emphasis':
      return <em key={key}>{childrenOf(node)}</em>

    case 'strong':
      return <strong key={key}>{childrenOf(node)}</strong>

    case 'delete':
      return <del key={key}>{childrenOf(node)}</del>

    case 'inlineCode':
      return (
        <code key={key} className="inline-code">
          {node.value}
        </code>
      )

    case 'break':
      return <br key={key} />

    case 'link':
      return renderLink(node, key, context)

    case 'image': {
      const src = node.url
      const external = /^https?:/iu.test(src)
      return (
        <img
          key={key}
          className="inline-image"
          src={src}
          alt={node.alt ?? ''}
          title={node.alt ?? undefined}
          loading="lazy"
          {...(external ? { referrerPolicy: 'no-referrer' } : {})}
        />
      )
    }

    default: {
      const value = 'value' in node && typeof node.value === 'string' ? node.value : ''
      return <Fragment key={key}>{value}</Fragment>
    }
  }
}

function renderLink(
  node: Extract<Content, { type: 'link' }>,
  key: number,
  context?: InlineContext,
): ReactNode {
  const label = node.children
    .map((child) => ('value' in child && typeof child.value === 'string' ? child.value : ''))
    .join('')

  // Only `#slug` hrefs are internal. Everything else is a normal link.
  if (!node.url.startsWith('#') || node.url.length < 2) {
    const external = /^[a-z][a-z0-9+.-]*:/iu.test(node.url)
    return (
      <a
        key={key}
        className="inline-link"
        href={node.url}
        title={node.title ?? undefined}
        {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {childrenOf(node)}
      </a>
    )
  }

  let slug = node.url.slice(1)
  try {
    slug = decodeURIComponent(slug)
  } catch {
    // A malformed escape is still a link; use it verbatim.
  }
  slug = slug.trim().toLowerCase()

  if (context === undefined || !context.slugs.has(slug)) {
    // §6.4: unresolvable internal links are muted with a tooltip, not broken.
    return (
      <span key={key} className="inline-link inline-link--unresolved" title="This section does not exist in this document.">
        {childrenOf(node)}
        <span className="visually-hidden"> (unresolved link: {label})</span>
      </span>
    )
  }

  return (
    <a
      key={key}
      className="inline-link inline-link--internal"
      href={`#${slug}`}
      title={node.title ?? undefined}
      onClick={(event) => {
        event.preventDefault()
        navigate(slug, context.onNavigate)
      }}
    >
      {childrenOf(node)}
    </a>
  )
}

/** Every internal link target declared inside a node, for the reader to index. */
export { internalLinksOf }
