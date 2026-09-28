/**
 * Read a dropped or picked markdown file (M4.12).
 *
 * Extracted from `DropScreen` so the **welcome view and the app-wide drop
 * handler use the same path**. The brief's requirement is that dropping onto a
 * *loaded* document swaps documents, which means the drop logic cannot live
 * inside the drop screen — the drop screen is not mounted when a document is
 * loaded. Duplicating the accept-check and the `FileReader` error handling into
 * a second place would be how the two paths drift, and the second path is the
 * one nobody tests.
 *
 * The rules are unchanged from the original: a file is accepted if it is named
 * `*.md`/`*.mdx` or is typed `text/markdown`, it is read as text, and every
 * failure produces a message rather than an exception (§6.1).
 */

import { useCallback, useRef, useState } from 'react'

export type MarkdownFile = { text: string; name: string }

export type UseMarkdownFile = {
  /** The `<input type="file">` the picker button should click. */
  input: React.RefObject<HTMLInputElement>
  /** Attach to a drop target: handles `dragover`, `dragleave` and `drop`. */
  dropProps: {
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: React.DragEvent) => void
  }
  /** True while a file is over the drop target, for the wash/border state. */
  dragging: boolean
  /** The last rejection, or null. Cleared on the next attempt. */
  error: string | null
  /** Open the OS file picker. The keyboard path, which drag is not. */
  choose: () => void
  /** Wire to the `<input type="file">`'s `onChange`. */
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

const MARKDOWN = /\.mdx?$/iu

export function useMarkdownFile(onFile: (file: MarkdownFile) => void): UseMarkdownFile {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const read = useCallback(
    (file: File | undefined) => {
      if (file === undefined) return
      if (!MARKDOWN.test(file.name) && file.type !== 'text/markdown') {
        setError(`${file.name} is not a markdown file.`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => onFile({ text: String(reader.result ?? ''), name: file.name })
      reader.onerror = () => setError(`${file.name} could not be read.`)
      reader.readAsText(file)
    },
    [onFile],
  )

  return {
    input,
    dragging,
    error,
    choose: useCallback(() => input.current?.click(), []),
    onChange: (event) => {
      setError(null)
      read(event.target.files?.[0])
    },
    dropProps: {
      onDragOver: (event) => {
        // preventDefault is what marks this element as a valid drop target at
        // all; without it the browser navigates to the file and the app is gone.
        event.preventDefault()
        setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (event) => {
        event.preventDefault()
        setDragging(false)
        setError(null)
        read(event.dataTransfer.files[0])
      },
    },
  }
}
