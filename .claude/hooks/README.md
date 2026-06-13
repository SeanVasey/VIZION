# Hooks

Place Claude Code hooks here and reference them from `../settings.json`.

Suggested for VIZ(IO)N (not yet wired, to keep settings free of un-requested grants):

- **SessionStart** — verify `node_modules` exists and run `npm run generate:icons` so a
  fresh web session can build and test immediately.
- **PreToolUse (Bash git commit)** — remind that the verification gate
  (`lint → typecheck → test → e2e → build`) must be green before committing.

See https://docs.claude.com/en/docs/claude-code/hooks for the hook schema.
