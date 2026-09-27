/**
 * Development-mode diagnostics (spec §1.3: a failed block degrades and warns).
 * Warnings are collected in-process rather than written straight to the console
 * so tests can assert on them and so production never logs.
 */

export type Warning = {
  code: string
  message: string
  detail?: string
}

let sink: Warning[] = []
let echoToConsole = false

/** Replace the warning sink. Returns the previous sink. */
export function setWarningSink(next: Warning[]): Warning[] {
  const previous = sink
  sink = next
  return previous
}

/** Mirror warnings to `console.warn` as well (dev server default). */
export function setWarningEcho(enabled: boolean): void {
  echoToConsole = enabled
}

export function getWarnings(): Warning[] {
  return sink
}

export function clearWarnings(): void {
  sink = []
}

/** Record a warning. Never throws, whatever the message. */
export function warn(code: string, message: string, detail?: string): void {
  const entry: Warning = detail === undefined ? { code, message } : { code, message, detail }
  sink.push(entry)
  if (echoToConsole) {
    const suffix = detail === undefined ? '' : ` — ${detail}`
    // eslint-disable-next-line no-console
    console.warn(`[unfold:${code}] ${message}${suffix}`)
  }
}
