# Design Document: keel-magical-install

## Overview

This feature makes KEEL discoverable and zero-friction to enable. KEEL is already fully wired into GSD workflows once initialized, but there is no onboarding moment. Users who have the `keel` binary but haven't run `keel init` get nothing; users who don't know about KEEL never find out.

The design adds three lightweight touch points:

1. **Greenfield offer** — in `new-project.md`, after bootstrap, when keel binary is present but `.keel/` was not created
2. **Brownfield offer** — in `resume-project.md`, when keel binary is present but `.keel/` is absent for an existing project
3. **Installer mention** — in `bin/install.js` `finishInstall()`, a static discovery note after all runtime-specific steps complete

All three are non-blocking and additive. No existing logic is altered.

---

## Architecture

The feature is purely additive — three isolated insertion points in existing files. There is no new module, no shared state, and no cross-file coupling.

```
new-project.md          resume-project.md         bin/install.js
      │                        │                         │
  Step 1 (Setup)          initialize step          finishInstall()
      │                        │                         │
  [existing bootstrap]   [existing companion         [existing
      │                   restart block]              output]
      ▼                        ▼                         ▼
  ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────┐
  │ KEEL offer      │   │ KEEL offer      │   │ KEEL discovery   │
  │ (greenfield)    │   │ (brownfield)    │   │ note (static)    │
  └─────────────────┘   └─────────────────┘   └──────────────────┘
```

Each insertion point is self-contained. The offer blocks in the workflow files use `AskUserQuestion` (the existing GSD interactive prompt mechanism). The installer note is a static `console.log` addition.

---

## Components and Interfaces

### Component 1: Greenfield KEEL Offer (`new-project.md`)

**Placement:** End of Step 1 (Setup), after the existing KEEL bootstrap block, before Step 2 (Brownfield Offer).

**Trigger condition:**
```bash
command -v keel >/dev/null 2>&1 && [ ! -d ".keel" ]
```

The existing bootstrap block already ran `keel init 2>/dev/null`. If `.keel/` still doesn't exist after that, either the binary isn't installed or init failed silently. This check catches the "binary present, init failed" case.

**Offer block to insert:**

```markdown
**KEEL drift protection offer (greenfield):**
```bash
if command -v keel >/dev/null 2>&1 && [ ! -d ".keel" ]; then
  # Bootstrap ran but .keel/ wasn't created — offer manual setup
fi
```

Use AskUserQuestion:
- header: "KEEL"
- question: "KEEL watches for scope drift and blocks phase completion until reality matches intent. Enable it for this project?"
- options:
  - "Enable KEEL" — Initialize drift protection now (recommended)
  - "Skip for now" — Continue without KEEL

**If "Enable KEEL":**
```bash
keel install 2>/dev/null || (keel init 2>/dev/null && keel scan 2>/dev/null && keel companion start 2>/dev/null)
```
Surface advisory if `.keel/` still absent after the command:
```bash
if [ ! -d ".keel" ]; then
  echo "⚠ KEEL could not be initialized — continuing without drift protection."
fi
```

**If "Skip for now":** Continue to Step 2 immediately.
```

**Invariant:** This block only runs when `command -v keel` succeeds AND `[ ! -d ".keel" ]`. It never runs when `.keel/` already exists (existing bootstrap succeeded) or when keel is not installed.

---

### Component 2: Brownfield KEEL Offer (`resume-project.md`)

**Placement:** In the `initialize` step, after the existing KEEL companion restart block and before the KEEL status surface block.

**Current structure of the initialize step:**
```
1. Load INIT context
2. [existing] KEEL companion restart (runs if .keel/ exists)
3. [existing] Surface KEEL-STATUS.md (runs if .keel/ exists)
4. → route to load_state or reconstruct
```

**New structure:**
```
1. Load INIT context
2. [existing] KEEL companion restart (runs if .keel/ exists)
3. [NEW] KEEL brownfield offer (runs if binary present AND .keel/ absent)
4. [existing] Surface KEEL-STATUS.md (runs if .keel/ exists)
5. → route to load_state or reconstruct
```

**Trigger condition:**
```bash
command -v keel >/dev/null 2>&1 && [ ! -d ".keel" ]
```

**Offer block to insert:**

```markdown
**KEEL brownfield offer:**
```bash
if command -v keel >/dev/null 2>&1 && [ ! -d ".keel" ]; then
  # Binary present but repo not initialized
fi
```

Use AskUserQuestion:
- header: "KEEL"
- question: "KEEL isn't set up for this repo yet. It watches for scope drift and can be added to existing projects. Add drift protection now?"
- options:
  - "Add KEEL" — Initialize for this project
  - "Skip" — Continue without KEEL

**If "Add KEEL":**
```bash
keel install 2>/dev/null || (keel init 2>/dev/null && keel scan 2>/dev/null && keel companion start 2>/dev/null)
```
Surface advisory if `.keel/` still absent:
```bash
if [ ! -d ".keel" ]; then
  echo "⚠ KEEL could not be initialized — continuing without drift protection."
fi
```

**If "Skip":** Continue to load_state immediately.
```

**Invariant:** The existing companion restart block (`if command -v keel >/dev/null 2>&1 && [ -d ".keel" ]`) is unchanged. The new offer block uses the complementary condition (`[ ! -d ".keel" ]`). The two blocks are mutually exclusive by construction.

---

### Component 3: KEEL Mention in `bin/install.js`

**Placement:** Inside `finishInstall()`, appended to the existing `console.log` that prints the "Done!" message. The KEEL note appears after the runtime-specific "Open a blank directory and run..." line.

**Current output (simplified):**
```
Done! Open a blank directory in Claude Code and run /gsd:new-project.

Join the community: https://discord.gg/gsd
```

**New output (keel not installed):**
```
Done! Open a blank directory in Claude Code and run /gsd:new-project.

Optional: KEEL adds real-time drift protection that runs alongside GSD.
Install: brew install keel  (or https://getkeel.dev)

Join the community: https://discord.gg/gsd
```

**New output (keel already installed):**
```
Done! Open a blank directory in Claude Code and run /gsd:new-project.

KEEL is already installed — drift protection will be offered during project setup.

Join the community: https://discord.gg/gsd
```

**Implementation in `finishInstall()`:**

The keel check runs synchronously using Node's `child_process.execSync`:

```javascript
// KEEL discovery note
let keelNote = '';
try {
  require('child_process').execSync('command -v keel', { stdio: 'ignore' });
  keelNote = `\n  ${cyan}KEEL${reset} is already installed — drift protection will be offered during project setup.\n`;
} catch {
  keelNote = `\n  ${dim}Optional:${reset} KEEL adds real-time drift protection that runs alongside GSD.\n  Install: ${cyan}brew install keel${reset}  (or https://getkeel.dev)\n`;
}

console.log(`
  ${green}Done!${reset} Open a blank directory in ${program} and run ${cyan}${command}${reset}.
${keelNote}
  ${cyan}Join the community:${reset} https://discord.gg/gsd
`);
```

**Constraint:** The `execSync` call uses `{ stdio: 'ignore' }` so it never produces output. The try/catch handles the "not found" case. This does not alter any existing logic in `finishInstall()`.

---

## Data Models

This feature introduces no new data structures, files, or persistent state. The only "state" is:

- **`.keel/` directory presence** — existing filesystem artifact, read-only from GSD's perspective
- **`keel` binary presence** — checked via `command -v keel`, read-only
- **Offer shown flag** — implicit in workflow execution (the offer block runs once per workflow invocation by construction; there is no loop)

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Offer condition is a strict biconditional

*For any* workflow invocation (new-project or resume-project), the KEEL offer is surfaced if and only if `command -v keel` succeeds AND `[ -d ".keel" ]` is false. Any other combination of those two boolean inputs must not produce an offer.

**Validates: Requirements 1.1, 1.5, 1.6, 2.1, 2.5, 2.6**

### Property 2: Offer description word count

*For any* rendering of the KEEL offer text, the description of what KEEL does (the sentence explaining its function, excluding the question framing) must contain 15 words or fewer.

**Validates: Requirements 5.1**

### Property 3: Accepted command uses fire-and-forget

*For any* KEEL offer acceptance (in either workflow), the command string that is executed must contain `2>/dev/null` error suppression and must not block the workflow on failure.

**Validates: Requirements 1.3, 2.3, 4.3**

### Property 4: Decline is a no-op

*For any* workflow invocation where the user declines the KEEL offer, the workflow state after the decline must be identical to the workflow state that would exist if the offer had never been shown — no KEEL initialization, no re-prompt, no delay.

**Validates: Requirements 1.4, 2.4, 4.2, 4.5**

### Property 5: Installer output contains KEEL mention and install command

*For any* call to `finishInstall()` where the keel binary is not installed, the output string must contain both a reference to KEEL by name and an install command or URL.

**Validates: Requirements 3.1, 3.2, 3.4**

### Property 6: Installer output branches on keel presence

*For any* call to `finishInstall()`, the output when `command -v keel` succeeds must differ from the output when it fails — specifically, the "already installed" path must not show install instructions, and the "not installed" path must not claim KEEL is already installed.

**Validates: Requirements 3.5**

### Property 7: No KEEL activity when binary is absent

*For any* workflow invocation where `command -v keel` fails, no KEEL-related command is executed, no KEEL offer is shown, and no KEEL output is produced.

**Validates: Requirements 1.5, 2.5, 4.3, 6.6**

---

## Error Handling

### KEEL init failure after acceptance

When the user accepts the offer and the fire-and-forget command runs, `.keel/` may still not exist afterward (e.g., `keel install` failed silently). The workflow checks for `.keel/` after the command and surfaces a non-fatal advisory:

```
⚠ KEEL could not be initialized — continuing without drift protection.
```

The workflow then continues normally. This satisfies Requirement 4.4.

### `command -v keel` unavailable in shell context

In some AI runtime environments, `command -v` may not be available. The guard uses `command -v keel >/dev/null 2>&1` which is POSIX-compliant and fails gracefully (exit code non-zero) if `command` itself is unavailable. The `2>/dev/null` suppresses any error output. The workflow continues as if keel is not installed.

### `execSync` failure in `bin/install.js`

The `execSync('command -v keel', { stdio: 'ignore' })` call is wrapped in try/catch. Any failure (binary not found, shell not available, permission error) falls through to the "not installed" branch. This is the safe default.

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. Unit tests cover specific examples and edge cases; property tests verify universal correctness across generated inputs.

### Unit Tests

**`new-project.md` offer logic (conceptual — tested via workflow simulation):**
- Example: keel installed, `.keel/` absent → offer shown
- Example: keel installed, `.keel/` present → offer not shown, existing bootstrap runs
- Example: keel not installed → offer not shown, no KEEL output
- Example: user accepts offer → `keel install 2>/dev/null` command in output
- Example: user declines offer → workflow continues, no KEEL command
- Example: keel install fails (`.keel/` still absent after command) → advisory message shown

**`resume-project.md` offer logic:**
- Example: keel installed, `.keel/` absent → brownfield offer shown
- Example: keel installed, `.keel/` present → companion restart runs, no offer
- Example: keel not installed → no offer, no KEEL output
- Example: user accepts → `keel install 2>/dev/null` in output
- Example: user declines → load_state proceeds immediately

**`bin/install.js` `finishInstall()`:**
- Example: keel not installed → output contains "Optional: KEEL" and install command
- Example: keel installed → output contains "already installed" and no install command
- Example: output for each runtime (claude, opencode, gemini, etc.) contains KEEL note
- Example: KEEL note appears after the "Done!" line, before the community link

### Property-Based Tests

Property tests use a PBT library appropriate for the target language. For JavaScript (`bin/install.js`): **fast-check**. For workflow markdown logic (if extracted to a testable helper): **fast-check** or equivalent.

Each property test runs a minimum of **100 iterations**.

**Property 1 test — Offer condition biconditional:**
```
// Feature: keel-magical-install, Property 1: Offer condition is a strict biconditional
fc.assert(fc.property(
  fc.boolean(), // keelInstalled
  fc.boolean(), // keelDirExists
  (keelInstalled, keelDirExists) => {
    const offerShown = evaluateOfferCondition(keelInstalled, keelDirExists);
    return offerShown === (keelInstalled && !keelDirExists);
  }
), { numRuns: 100 });
```

**Property 2 test — Offer description word count:**
```
// Feature: keel-magical-install, Property 2: Offer description word count
fc.assert(fc.property(
  fc.constantFrom('greenfield', 'brownfield'),
  (offerType) => {
    const description = getOfferDescription(offerType);
    const wordCount = description.trim().split(/\s+/).length;
    return wordCount <= 15;
  }
), { numRuns: 100 });
```

**Property 3 test — Accepted command uses fire-and-forget:**
```
// Feature: keel-magical-install, Property 3: Accepted command uses fire-and-forget
fc.assert(fc.property(
  fc.constantFrom('new-project', 'resume-project'),
  (workflow) => {
    const cmd = getKeelAcceptCommand(workflow);
    return cmd.includes('2>/dev/null');
  }
), { numRuns: 100 });
```

**Property 4 test — Decline is a no-op:**
```
// Feature: keel-magical-install, Property 4: Decline is a no-op
fc.assert(fc.property(
  fc.record({ keelInstalled: fc.boolean(), keelDirExists: fc.boolean() }),
  (state) => {
    const before = captureWorkflowState(state);
    simulateDecline(state);
    const after = captureWorkflowState(state);
    return deepEqual(before, after) && offerNotShownAgain(state);
  }
), { numRuns: 100 });
```

**Property 5 test — Installer output contains KEEL mention and install command:**
```
// Feature: keel-magical-install, Property 5: Installer output contains KEEL mention and install command
fc.assert(fc.property(
  fc.constantFrom('claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf'),
  (runtime) => {
    const output = captureFinishInstallOutput(runtime, /* keelInstalled= */ false);
    return output.includes('KEEL') && (output.includes('brew install') || output.includes('getkeel.dev'));
  }
), { numRuns: 100 });
```

**Property 6 test — Installer output branches on keel presence:**
```
// Feature: keel-magical-install, Property 6: Installer output branches on keel presence
fc.assert(fc.property(
  fc.constantFrom('claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf'),
  fc.boolean(), // keelInstalled
  (runtime, keelInstalled) => {
    const output = captureFinishInstallOutput(runtime, keelInstalled);
    if (keelInstalled) {
      return output.includes('already installed') && !output.includes('brew install');
    } else {
      return !output.includes('already installed') && output.includes('brew install');
    }
  }
), { numRuns: 100 });
```

**Property 7 test — No KEEL activity when binary is absent:**
```
// Feature: keel-magical-install, Property 7: No KEEL activity when binary is absent
fc.assert(fc.property(
  fc.boolean(), // keelDirExists (irrelevant when binary absent, but test both)
  (keelDirExists) => {
    const commands = captureExecutedCommands({ keelInstalled: false, keelDirExists });
    const output = captureWorkflowOutput({ keelInstalled: false, keelDirExists });
    return commands.every(cmd => !cmd.includes('keel')) &&
           !output.includes('KEEL offer');
  }
), { numRuns: 100 });
```

### Test Configuration

- PBT library: **fast-check** (JavaScript, matches `bin/install.js` runtime)
- Minimum iterations per property test: **100**
- Each test tagged with: `Feature: keel-magical-install, Property N: <property text>`
- Unit tests focus on: specific examples, edge cases (binary absent, `.keel/` present), error conditions (init failure)
- Property tests focus on: universal correctness of condition logic, output content invariants, and branch behavior
