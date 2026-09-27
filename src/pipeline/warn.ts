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

/**
 * Whether warnings reach the console.
 *
 * Defaults to **development builds only**, and that default is the rule rather
 * than a setting: §1.3 asks for a "development-mode warning", so a production
 * build that logs one is not being helpful, it is violating the spec and failing
 * the e2e console-noise gate. The e2e suite is the reason this was found — it
 * runs against a *built* artifact, so anything the app prints in production
 * shows up there as a failure.
 *
 * `import.meta.env.DEV` is substituted at build time, so the `false` branch is
 * dead code in a production bundle and costs nothing.
 */
let echoToConsole = import.meta.env.DEV

/** Replace the warning sink. Returns the previous sink. */
export function setWarningSink(next: Warning[]): Warning[] {
  const previous = sink
  sink = next
  return previous
}

/** Mirror warnings to `console.warn` as well. See the note on the default. */
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
