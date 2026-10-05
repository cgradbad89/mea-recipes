import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { expect, it } from 'vitest'
import { startFirestoreEmulator } from './helpers/firestoreEmulator'

function listening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1000)
    const finish = (value: boolean) => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

it('isolates concurrent suites for the same project and awaits all service shutdowns', async () => {
  const suites: Awaited<ReturnType<typeof startFirestoreEmulator>>[] = []
  try {
    // Identical project IDs also exercise isolation of project-keyed hub locators.
    const results = await Promise.allSettled([0, 1].map(async () => {
      const suite = await startFirestoreEmulator('demo-mea-lifecycle-regression')
      suites.push(suite)
      return suite
    }))
    for (const result of results) if (result.status === 'rejected') throw result.reason
    const ports = suites.flatMap(suite => [suite.port, suite.hubPort, suite.loggingPort, suite.websocketPort])
    expect(new Set(ports).size).toBe(8)
    for (const suite of suites) {
      const response = await fetch(`http://127.0.0.1:${suite.hubPort}/emulators`)
      const services = await response.json()
      expect(services.firestore).toMatchObject({ host: '127.0.0.1', port: suite.port, webSocketPort: suite.websocketPort })
      expect(services.logging.port).toBe(suite.loggingPort)
    }
  } finally {
    await Promise.all(suites.map(suite => suite.stop()))
  }
  for (const suite of suites) {
    expect(existsSync(suite.directory)).toBe(false)
    await suite.stop() // teardown is idempotent
    for (const port of [suite.port, suite.hubPort, suite.loggingPort, suite.websocketPort]) {
      expect(await listening(port), `owned service still listening on ${port}`).toBe(false)
    }
  }
}, 45_000)
