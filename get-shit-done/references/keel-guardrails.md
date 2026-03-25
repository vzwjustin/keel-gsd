<overview>
KEEL is the anti-drift guardrail layer for GSD-managed repos. GSD handles planning,
discussion, execution, and verification. KEEL watches the repo in real-time and
surfaces drift — files touched outside the active plan step, goal statement drift,
scope expansion — before they compound.

**Division of responsibility:**
- GSD: planning, phase structure, execution orchestration, UAT
- KEEL: companion watcher, drift detection, checkpoint anchors, done-gate

GSD workflows run unchanged. KEEL is additive.
</overview>

<keel_lifecycle>

## KEEL touchpoints within GSD workflow

| GSD step | KEEL action | Command |
|----------|-------------|---------|
| Start of phase | Open checkpoint, start companion | `keel checkpoint && keel companion start` |
| During execution | Companion watches silently | (automatic) |
| Drift detected | Alert in statusline + KEEL-STATUS.md | (automatic) |
| Before verify-work | Check for unresolved drift | `keel drift` |
| After UAT passes | Run done-gate | `keel done` |
| Phase complete | Close checkpoint | `keel checkpoint` |

</keel_lifecycle>

<reading_keel_state>

## Reading KEEL state from .planning/

When KEEL is installed, it mirrors its current brief into `.planning/KEEL-STATUS.md`
after every state change. Read this file to understand KEEL's current view:

```bash
cat .planning/KEEL-STATUS.md 2>/dev/null || echo "KEEL not active"
```

Fields in KEEL-STATUS.md:
- `Current goal` — the goal KEEL is tracking
- `Current phase` — KEEL's internal phase name
- `Next step` — what KEEL thinks should happen next
- `Blockers` — unresolved drift rules blocking `keel done`
- `Active alerts` — current warning feed

</reading_keel_state>

<done_gate>

## KEEL done-gate

`keel done` is the guard before any phase can be declared complete.
It checks:

1. Goal statement has not drifted from the original intent
2. All plan steps are completed or have a recorded delta
3. No high-confidence unresolved drift findings
4. Companion heartbeat is fresh (within 30s)

If the gate blocks, the output explains exactly which rule failed and
what the agent must do: `keel delta`, `keel replan`, or `keel advance`.

**Integrate into verify-work:**

After UAT passes and before committing phase completion, run:
```bash
keel done || echo "KEEL done-gate blocked — resolve drift before closing phase"
```

</done_gate>

<companion_health>

## Companion health checks

The KEEL companion runs as a background process. If it dies, drift detection
stops silently. Check before starting a phase:

```bash
keel companion status
# running: true → healthy
# running: false → start with `keel companion start`
# stale heartbeat → restart with `keel companion stop && keel companion start`
```

The GSD statusline shows ⚓ clean / ⚓ N warn / ⚓ N drift / ⚓ off at a glance.

</companion_health>

<keel_not_installed>

## When KEEL is not installed

All KEEL commands are no-ops. GSD works exactly as before.
Check with: `command -v keel && [ -d .keel ] && echo "keel present" || echo "keel absent"`

</keel_not_installed>
