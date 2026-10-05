import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const host = '127.0.0.1'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Hold every reservation until the whole set is allocated; the OS chooses distinct
// ephemeral ports even when several Vitest workers start suites simultaneously.
async function allocatePorts(count: number): Promise<number[]> {
  const servers = Array.from({ length: count }, () => createServer())
  try {
    return await Promise.all(servers.map(server => new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, host, () => {
        const address = server.address()
        if (!address || typeof address === 'string') reject(new Error('Cannot reserve emulator port'))
        else resolve(address.port)
      })
    })))
  } finally {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function signal(pid: number, value: NodeJS.Signals): void {
  try { process.kill(pid, value) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

export async function startFirestoreEmulator(projectID: string) {
  if (!projectID.startsWith('demo-')) throw new Error('Tests require a synthetic demo Firebase project')
  const [port, hubPort, loggingPort, websocketPort] = await allocatePorts(4)
  const directory = mkdtempSync(join(tmpdir(), 'mea-test-firestore-'))
  const config = join(directory, 'firebase.json')
  const log = join(directory, 'emulator.log')
  writeFileSync(config, JSON.stringify({ emulators: {
    firestore: { host, port, websocketPort },
    hub: { host, port: hubPort },
    logging: { host, port: loggingPort },
    ui: { enabled: false },
  } }))
  const logFD = openSync(log, 'w')
  let emulator: ChildProcess
  try {
    emulator = spawn('firebase', [
      'emulators:start', '--only', 'firestore', '--project', projectID,
      '--config', config, '--log-verbosity', 'QUIET',
    ], {
      cwd: directory, stdio: ['ignore', logFD, logFD],
      // Hub locator files are project-keyed. Isolate them even across simultaneous
      // npm test runs using the same synthetic project ID.
      env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
    })
  } finally { closeSync(logFD) }
  let spawnError: Error | undefined
  emulator.once('error', error => { spawnError = error })
  const closed = new Promise<void>(resolve => {
    emulator.once('close', () => resolve())
  })
  const javaPIDs = new Set<number>()

  function rememberJava() {
    // Firebase launches Java detached. A failed CLI can orphan it before the hub
    // publishes its PID. Match both this exact synthetic project AND allocated
    // port, never kill by executable name or a default/shared port.
    const rows = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n')
    for (const row of rows) {
      if (row.includes('cloud-firestore-emulator-') &&
          new RegExp(`--project_id ${projectID}(?:\\s|$)`).test(row) &&
          new RegExp(`--port ${port}(?:\\s|$)`).test(row)) {
        javaPIDs.add(Number(row.trim().split(/\s+/)[0]))
      }
    }
  }

  let stopped = false
  async function stop() {
    if (stopped) return
    rememberJava()
    if (emulator.pid && alive(emulator.pid)) signal(emulator.pid, 'SIGINT')
    await Promise.race([closed, delay(5000)])
    if (emulator.pid && alive(emulator.pid)) signal(emulator.pid, 'SIGKILL')
    await closed
    rememberJava()
    for (const pid of javaPIDs) if (alive(pid)) signal(pid, 'SIGTERM')
    const deadline = Date.now() + 2000
    while ([...javaPIDs].some(alive) && Date.now() < deadline) await delay(50)
    for (const pid of javaPIDs) if (alive(pid)) signal(pid, 'SIGKILL')
    const killDeadline = Date.now() + 2000
    while ([...javaPIDs].some(alive) && Date.now() < killDeadline) await delay(50)
    if ([...javaPIDs].some(alive)) throw new Error('Owned Firestore emulator process did not stop')
    rmSync(directory, { recursive: true, force: true })
    stopped = true
  }

  try {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      rememberJava()
      if (spawnError || emulator.exitCode !== null || emulator.signalCode !== null) break
      try {
        const response = await fetch(`http://${host}:${port}`, { signal: AbortSignal.timeout(1000) })
        if (response.ok) return { port, hubPort, loggingPort, websocketPort, directory, stop }
      } catch { /* startup is still in progress */ }
      await delay(250)
    }
    throw new Error(`Firestore emulator failed (${spawnError?.message ?? emulator.exitCode ?? 'readiness timeout'})\n${readFileSync(log, 'utf8').slice(-6000)}`)
  } catch (error) {
    await stop()
    throw error
  }
}
