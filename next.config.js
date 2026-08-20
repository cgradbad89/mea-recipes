/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  // Keep local file tracing scoped to this app when parent directories contain
  // unrelated lockfiles. Recipe images use plain <img>, so no optimizer allowlist
  // is required here.
  outputFileTracingRoot: __dirname,
}

module.exports = nextConfig
