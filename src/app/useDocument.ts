/**
 * Loading a document into a `Doc` (spec §6.1). Three states, always: loading,
 * loaded, failed. A failure is a message with a reason — never a blank screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadDocument, type LoadFailureReason } from '../pipeline/loader'
import { normalizeConfig, type UnfoldConfig } from '../pipeline/config'
import { parseDocument } from '../pipeline/parse'
import { setWarningEcho, setWarningSink, type Warning } from '../pipeline/warn'
import type { Doc } from '../pipeline/types'

export type DocState =
  | { status: 'loading' }
  | { status: 'ready'; doc: Doc; config: UnfoldConfig }
  | { status: 'drop'; reason: LoadFailureReason; message: string }
  | { status: 'error'; message: string }

export type UseDocument = DocState & {
  /** Re-read the configured document. */
  reload: () => void
  /** Parse a file the user dropped or picked (§6.1). */
  loadText: (text: string, fileName: string) => void
  warnings: Warning[]
}

export function useDocument(
  initialConfig: UnfoldConfig,
  fetcher: typeof fetch = fetch,
): UseDocument {
  const [state, setState] = useState<DocState>({ status: 'loading' })
  const [warnings, setWarningList] = useState<Warning[]>([])

  const parse = useCallback((text: string, fileName: string, config: UnfoldConfig) => {
    const sink: Warning[] = []
    const previous = setWarningSink(sink)
    // The pipeline's own warnings are collected and handed to the shell rather
    // than printed, so a document can surface them; the echo is restored to
    // whatever it was — `import.meta.env.DEV` in a real build — rather than forced
    // on, which is what made M3's view-layer warnings appear in production.
    setWarningEcho(false)
    try {
      const doc = parseDocument(text, { fileName, config })
      setWarningList([...sink])
      setState({ status: 'ready', doc, config })
    } finally {
      setWarningSink(previous)
      setWarningEcho(import.meta.env.DEV)
    }
  }, [])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    void loadDocument(initialConfig.docPath, { fetcher }).then((result) => {
      if (result.ok) {
        parse(result.source, result.path, initialConfig)
        return
      }
      if (result.reason === 'no-source') {
        setState({ status: 'error', message: 'No document is configured.' })
        return
      }
      // 404 and file:// are the designed path to the drop screen (§6.1).
      setState({ status: 'drop', reason: result.reason, message: result.message })
    })
  }, [fetcher, initialConfig, parse])

  useEffect(reload, [reload])

  const loadText = useCallback(
    (text: string, fileName: string) => {
      parse(text, fileName, initialConfig)
    },
    [initialConfig, parse],
  )

  return useMemo(
    () => ({ ...state, reload, loadText, warnings }) as UseDocument,
    [state, reload, loadText, warnings],
  )
}

/** Parse config text once at startup; never throws. */
export function useConfig(raw: string): UnfoldConfig {
  return useMemo(() => {
    try {
      return normalizeConfig(JSON.parse(raw))
    } catch {
      return normalizeConfig({})
    }
  }, [raw])
}
