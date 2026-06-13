# `.claude/` — agent workspace configuration

This directory configures Claude Code for the VIZ(IO)N repo.

- **`settings.json`** — project settings. Currently defensive only (denies reading
  `.env*` secret files). Add permission allow-rules here per your own preference; they
  are intentionally not pre-seeded.
- **`hooks/`** — repo automation hooks (e.g. a SessionStart check that the toolchain is
  installed). See `hooks/README.md`.
- **`skills/`** — project-specific skills. See `skills/README.md`.
- **`commands/`** — project slash-commands. See `commands/README.md`.

Read [`../CLAUDE.md`](../CLAUDE.md) first — it is the operating contract — then
[`../tasks/lessons.md`](../tasks/lessons.md) before starting a phase.
