# Implementation Plan: keel-magical-install

## Overview

Three isolated, additive insertions: a greenfield KEEL offer in `new-project.md`, a brownfield KEEL offer in `resume-project.md`, and a KEEL discovery note in `bin/install.js`. No existing logic is altered.

## Tasks

- [x] 1. Add greenfield KEEL offer to `new-project.md`
  - [x] 1.1 Insert the KEEL offer block at the end of Step 1 (Setup), after the existing bootstrap block
    - Trigger condition: `command -v keel >/dev/null 2>&1 && [ ! -d ".keel" ]`
    - Use `AskUserQuestion` with header "KEEL", two options: "Enable KEEL" and "Skip for now"
    - On accept: run `keel install 2>/dev/null || (keel init 2>/dev/null && keel scan 2>/dev/null && keel companion start 2>/dev/null)`
    - On accept with `.keel/` still absent after command: surface advisory `⚠ KEEL could not be initialized — continuing without drift protection.`
    - On decline: continue to Step 2 immediately
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3_

  - [x] 1.2 Write property test for offer condition biconditional (greenfield)
    - **Property 1: Offer condition is a strict biconditional**
    - **Validates: Requirements 1.1, 1.5, 1.6**
    - Use fast-check: `fc.boolean()` × `fc.boolean()` → assert `offerShown === (keelInstalled && !keelDirExists)`
    - Minimum 100 runs

  - [x] 1.3 Write property test for offer description word count
    - **Property 2: Offer description word count**
    - **Validates: Requirements 5.1**
    - Use fast-check: `fc.constantFrom('greenfield', 'brownfield')` → assert word count ≤ 15

  - [x] 1.4 Write property test for accepted command fire-and-forget
    - **Property 3: Accepted command uses fire-and-forget**
    - **Validates: Requirements 1.3, 4.3**
    - Use fast-check: `fc.constantFrom('new-project', 'resume-project')` → assert command includes `2>/dev/null`

  - [x] 1.5 Write unit tests for greenfield offer logic
    - keel installed + `.keel/` absent → offer shown
    - keel installed + `.keel/` present → offer not shown, existing bootstrap runs
    - keel not installed → offer not shown, no KEEL output
    - user accepts → `keel install 2>/dev/null` in output
    - user declines → workflow continues, no KEEL command
    - keel install fails (`.keel/` still absent) → advisory message shown
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 4.4_

- [x] 2. Add brownfield KEEL offer to `resume-project.md`
  - [x] 2.1 Insert the KEEL brownfield offer block in the `initialize` step, after the existing companion restart block and before the KEEL-STATUS.md surface block
    - Trigger condition: `command -v keel >/dev/null 2>&1 && [ ! -d ".keel" ]`
    - Use `AskUserQuestion` with header "KEEL", two options: "Add KEEL" and "Skip"
    - On accept: run `keel install 2>/dev/null || (keel init 2>/dev/null && keel scan 2>/dev/null && keel companion start 2>/dev/null)`
    - On accept with `.keel/` still absent: surface advisory `⚠ KEEL could not be initialized — continuing without drift protection.`
    - On decline: continue to load_state immediately
    - Existing companion restart block (`[ -d ".keel" ]`) must remain unchanged — the two blocks are mutually exclusive by condition
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.4, 6.2, 6.4_

  - [x] 2.2 Write property test for decline is a no-op
    - **Property 4: Decline is a no-op**
    - **Validates: Requirements 1.4, 2.4, 4.2, 4.5**
    - Use fast-check: `fc.record({ keelInstalled: fc.boolean(), keelDirExists: fc.boolean() })` → simulate decline → assert workflow state unchanged and offer not re-shown

  - [x] 2.3 Write property test for no KEEL activity when binary is absent
    - **Property 7: No KEEL activity when binary is absent**
    - **Validates: Requirements 1.5, 2.5, 4.3, 6.6**
    - Use fast-check: `fc.boolean()` (keelDirExists) → assert no keel commands executed and no KEEL offer in output when `keelInstalled = false`

  - [x] 2.4 Write unit tests for brownfield offer logic
    - keel installed + `.keel/` absent → brownfield offer shown
    - keel installed + `.keel/` present → companion restart runs, no offer
    - keel not installed → no offer, no KEEL output
    - user accepts → `keel install 2>/dev/null` in output
    - user declines → load_state proceeds immediately
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 6.2_

- [x] 3. Checkpoint — Ensure workflow file changes are consistent
  - Verify the two offer blocks are mutually exclusive (one uses `[ -d ".keel" ]`, the other `[ ! -d ".keel" ]`)
  - Verify no existing KEEL wiring in either file was altered
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add KEEL discovery note to `bin/install.js` `finishInstall()`
  - [x] 4.1 Add KEEL detection and note generation inside `finishInstall()`
    - Use `require('child_process').execSync('command -v keel', { stdio: 'ignore' })` wrapped in try/catch
    - On success (keel installed): set `keelNote` to "KEEL is already installed — drift protection will be offered during project setup."
    - On failure (keel not installed): set `keelNote` to "Optional: KEEL adds real-time drift protection that runs alongside GSD.\n  Install: brew install keel  (or https://getkeel.dev)"
    - Append `keelNote` to the existing `console.log` output, after the "Done!" / runtime command line and before the community link
    - Do not alter any existing runtime-specific logic, file copy operations, or other output
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.5, 6.5_

  - [x] 4.2 Write property test for installer output contains KEEL mention and install command
    - **Property 5: Installer output contains KEEL mention and install command**
    - **Validates: Requirements 3.1, 3.2, 3.4**
    - Use fast-check: `fc.constantFrom('claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf')` with `keelInstalled = false` → assert output includes `'KEEL'` and (`'brew install'` or `'getkeel.dev'`)
    - Minimum 100 runs

  - [x] 4.3 Write property test for installer output branches on keel presence
    - **Property 6: Installer output branches on keel presence**
    - **Validates: Requirements 3.5**
    - Use fast-check: runtime × `fc.boolean()` (keelInstalled) → assert installed path contains `'already installed'` and no `'brew install'`; not-installed path contains `'brew install'` and no `'already installed'`
    - Minimum 100 runs

  - [x] 4.4 Write unit tests for `finishInstall()` KEEL note
    - keel not installed → output contains "Optional: KEEL" and install command
    - keel installed → output contains "already installed" and no install command
    - Each supported runtime (claude, opencode, gemini, codex, copilot, antigravity, cursor, windsurf) produces output with KEEL note
    - KEEL note appears after "Done!" line and before community link
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 5. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use **fast-check** (JavaScript), minimum 100 iterations each
- The two workflow offer blocks are mutually exclusive by construction — no shared state or coordination needed
- `execSync` in `bin/install.js` uses `{ stdio: 'ignore' }` and try/catch — safe default is "not installed"
