# 16. A clearable default model — null means "start on Auto"

Date: 2026-08-15
Status: accepted

## Context

`profiles.default_model` was a `NOT NULL` `model_target` enum with a column
default, and the Settings picker deliberately hid the Auto row because a
non-nullable enum column gave "no default" nowhere to live. The consequence
the owner hit: once a default model is chosen there is no way back —

> "if I decide I want auto to remain the model at load up but have selected a
> specific model in settings, that will always populate first and there's no
> way to return auto as the default since auto isn't a model in the profile
> model list."

Two prior rulings box in the solution space. Auto is a UI and wire concept
ONLY (`src/lib/enhance/auto-target.ts`): the `model_target` enum is shared
with `usage_events.target` and `prompts.target_model`, where a literal
`'auto'` would be a lie about what ran, and `scripts/check-model-enum.mjs`
exists to keep the roster and the enum in lockstep. So "no default" could
never be an enum label.

## Decision

**Absence is the representation.** `profiles.default_model` drops `NOT NULL`
and its column default (migration `20260815113000`); `null` means "no stored
default → start on Auto". The enum is untouched.

**The Settings choice is authoritative for what a load opens on** (owner
decision, 2026-08-15). `ProfileHydrator` now writes both knobs, once per
load: a concrete default sets `targetModel` and forces `autoTarget: false`; a
cleared default forces `autoTarget: true` and leaves `targetModel` alone —
the device's last pick stays Auto's fallback, so turning Auto off mid-session
still returns the user to their own pick (the store's standing contract).
Both branches deliberately override the device's persisted `autoTarget`:
that is what makes the setting mean "what the app opens on" rather than "a
fallback the device may ignore". Mid-session the composer's toggles rule, as
before.

**New accounts start cleared** (owner decision, same pass): dropping the
column default means `handle_new_user()`'s insert lands `null`, so a fresh
account opens on Auto until it picks a model.

**Settings reuses the picker's Auto row as its clear.** The row and the
tuning dial were already separable (the row gates on the Auto pair, the dial
additionally on the preference pair), so Settings wires only the Auto pair —
row without dial, because the routing budget is a per-run knob, not an
account default. A new `autoDescription` prop rewords the row for this
meaning ("No default — each session starts on Auto"); the picker stays
store-free. Choosing Auto writes `{ default_model: null }` through the same
control-commit-with-rollback path, and the rollback restores all three knobs
it touched (`defaultModel`, `targetModel`, `autoTarget`).

## Consequences

- A missing profile row now hydrates to Auto rather than to Opus 5 — the
  same reading a freshly-created account gets, and an honest one: there IS
  no stored default.
- The e2e stub keeps `default_model: "opus_5"` — dozens of authed specs
  assume the Opus pill — and its PATCH handler merges `null` correctly.
- `database.types.ts` was hand-edited for the nullability; the next
  `supabase gen types` run must come from a project with the migration
  applied, or it reverts the edit (the enum-parity test is column-blind
  either way).
- Deploy order is safe on both sides: the migration only removes a
  constraint; old code keeps writing real enum ids and never reads null.
