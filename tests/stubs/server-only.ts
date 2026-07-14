/**
 * Vitest stand-in for the `server-only` package, which throws when imported
 * outside a React Server environment. Unit tests exercise server modules
 * (adapter, providers) in plain Node, so the poison-pill is stubbed out here
 * via the alias in vitest.config.ts. Next.js builds still enforce the real
 * package — this stub never ships.
 */
export {};
