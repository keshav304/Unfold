/**
 * Drop screen (spec §6.1). The designed path for a 404 or a `file://` page:
 * drag any `.md` onto the window, or pick one. The result is parsed by the same
 * pipeline as every other document — there is no second code path.
 */

import { useCallback, useRef, useState, type DragEvent } from 'react'

export type DropScreenProps = {
  message?: string
  onFile: (text: string, fileName: string) => void
  onRetry?: () => void
}

export function DropScreen({ message, onFile, onRetry }: DropScreenProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const read = useCallback(
    (file: File | undefined) => {
      if (file === undefined) return
      if (!/\.mdx?$/iu.test(file.name) && file.type !== 'text/markdown') {
        setError(`${file.name} is not a markdown file.`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => onFile(String(reader.result ?? ''), file.name)
      reader.onerror = () => setError(`${file.name} could not be read.`)
      reader.readAsText(file)
    },
    [onFile],
  )

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    setError(null)
    read(event.dataTransfer.files[0])
  }

  return (
    <div
      className="drop-screen grid-canvas"
      data-dragging={dragging ? 'true' : 'false'}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="drop-panel elev-2">
        <h1 className="drop-title t-headline-xl">Drop a markdown file</h1>
        <p className="drop-message t-body-lg">
          {message ?? 'That document could not be loaded. Drop a .md file here, or choose one below.'}
        </p>
        <div className="drop-actions">
          <button type="button" className="drop-button t-code-sm" onClick={() => input.current?.click()}>
            Choose file
          </button>
          {onRetry !== undefined ? (
            <button type="button" className="drop-button drop-button--ghost t-code-sm" onClick={onRetry}>
              Try the configured document again
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,text/markdown"
          className="visually-hidden"
          aria-label="Choose a markdown file"
          onChange={(event) => {
            setError(null)
            read(event.target.files?.[0])
          }}
        />
        {error !== null ? (
          <p className="drop-error t-code-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Error card for a parse failure — a reason, never a blank screen (§6.1). */
export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="drop-screen grid-canvas">
      <div className="drop-panel elev-2" role="alert">
        <h1 className="drop-title t-headline-xl">This document could not be read</h1>
        <p className="drop-message t-body-lg">{message}</p>
        {onRetry !== undefined ? (
          <div className="drop-actions">
            <button type="button" className="drop-button t-code-sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
