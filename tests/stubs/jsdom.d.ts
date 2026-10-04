// Minimal types for the already-installed jsdom runtime used by capture tests.
// Avoid adding a dependency solely for this test harness.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; runScripts?: string })
    window: Window & typeof globalThis
  }
}
