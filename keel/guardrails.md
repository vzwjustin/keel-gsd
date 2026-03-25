# KEEL Guardrails — GSD Integration

KEEL is an optional anti-drift companion that runs alongside GSD phases.
When present, it adds a real-time guardrail layer: checkpoint → watch → done-gate.

## How it fits into GSD

```
GSD phase lifecycle               KEEL guardrail layer
─────────────────────             ──────────────────────────────────
/gsd:discuss-phase          →     keel goal (syncs from ROADMAP.md)
/gsd:plan-phase             →     keel plan (generates drift-aware plan)
/gsd:execute-phase          →     keel companion start + keel checkpoint
  (subagent writes code)    →     companion watches every file change
  (drift detected)          →     alert injected into agent context
/gsd:verify-work            →     keel done (blocks if drift unresolved)
/gsd:complete-milestone     →     keel checkpoint (clean close)
```

## Setup

```bash
# In any GSD-managed repo
keel install      # bootstraps .keel/, hooks, companion
keel start        # scan → goal (reads ROADMAP.md) → plan → checkpoint
```

After `keel install`, the companion runs in the background. GSD workflows
continue unchanged. KEEL alerts surface in the Claude Code status line.

## Guardrail commands for GSD agents

```bash
keel companion status       # is the watcher alive?
keel drift                  # what has drifted from the plan?
keel checkpoint             # snapshot state (run before each phase)
keel done                   # gate: only passes when reality = intent
keel recover                # drift → recovery plan with checkpoint anchor
keel advance                # mark step done, auto-checkpoint, move forward
```

## KEEL-STATUS.md

After any `keel` command that refreshes the brief, KEEL writes
`.planning/KEEL-STATUS.md` with the current goal, phase, alerts,
and blockers. GSD agents can read this file to understand KEEL state
without calling `keel` directly.

## Drift does not block GSD

KEEL is advisory by default. Drift alerts surface in the status line and
`.planning/KEEL-STATUS.md` but do not interrupt GSD execution. The only
hard gate is `keel done` — which GSD agents should call before declaring
a phase complete.

## When KEEL is not installed

All KEEL steps are no-ops. GSD works exactly as before.
