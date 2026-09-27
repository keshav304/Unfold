/**
 * M2.PW1 — close the host.
 *
 * Without this the run hangs on the open listening socket, which reads as a
 * hung CI job rather than as a missing teardown.
 */

import { stop } from './lifecycle'

export default async function globalTeardown(): Promise<void> {
  await stop()
}
