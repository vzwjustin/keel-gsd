# Requirements Document

## Introduction

KEEL is an optional anti-drift guardrail that runs underneath GSD. It is already fully wired into 17 GSD workflow files once initialized, but there is no discovery or onboarding moment. Users who have the `keel` binary installed but haven't initialized it for a repo get nothing. Users who don't know about KEEL never find out it exists.

This feature makes the KEEL install/setup experience "magical" — zero-friction, discoverable, and automatic where possible. The goal is to surface KEEL at the right moments (new project creation, session resume, and GSD installation) with a non-blocking, skip-friendly offer that explains what KEEL does and how to enable it.

## Glossary

- **KEEL**: The optional anti-drift guardrail companion that runs alongside GSD, providing real-time drift detection, checkpoint anchors, and a done-gate
- **GSD**: Get Shit Done — the planning, execution, and verification system that KEEL runs underneath
- **keel binary**: The `keel` executable installed on the user's machine, detectable via `command -v keel`
- **`.keel/` directory**: The per-repo KEEL initialization artifact created by `keel init` or `keel install`; its presence indicates KEEL has been initialized for the repo
- **KEEL presence guard**: The standard two-part check `command -v keel >/dev/null 2>&1 && [ -d ".keel" ]` used in existing GSD workflows
- **Bootstrap guard**: The binary-only check `command -v keel >/dev/null 2>&1` used in `new-project.md` where `.keel/` doesn't exist yet
- **Greenfield KEEL offer**: The one-time non-blocking offer surfaced in `new-project.md` after bootstrap when KEEL init failed or binary was absent
- **Brownfield KEEL offer**: The non-blocking offer surfaced in `resume-project.md` when the `keel` binary is present but `.keel/` is absent for an existing GSD project
- **Fire-and-forget**: KEEL commands run with `2>/dev/null` error suppression, never blocking GSD execution
- **GSD installer**: The `bin/install.js` script run via `npx get-shit-done-cc` that installs GSD for a given AI runtime
- **`new-project.md`**: The GSD workflow that initializes a new project from scratch
- **`resume-project.md`**: The GSD workflow that restores project context at the start of a new session

## Requirements

### Requirement 1: Greenfield KEEL Offer in new-project.md

**User Story:** As a developer starting a new GSD project, I want to be informed about KEEL drift protection if it's available but not yet initialized, so that I can enable it without having to discover it separately.

#### Acceptance Criteria

1. WHEN `new-project.md` completes the KEEL bootstrap attempt AND `command -v keel` succeeds AND `[ -d ".keel" ]` is false, THE `new-project.md` workflow SHALL surface a one-time non-blocking offer to enable KEEL drift protection.
2. THE KEEL offer in `new-project.md` SHALL include a one-liner description of what KEEL does (e.g., "watches for scope drift and blocks phase completion until reality matches intent").
3. WHEN the user accepts the KEEL offer in `new-project.md`, THE `new-project.md` workflow SHALL run `keel install` (or `keel init && keel scan && keel companion start`) as a fire-and-forget operation with `2>/dev/null` error suppression.
4. WHEN the user declines the KEEL offer in `new-project.md`, THE `new-project.md` workflow SHALL continue without any KEEL initialization and without surfacing the offer again in the same session.
5. WHEN `command -v keel` fails in `new-project.md`, THE `new-project.md` workflow SHALL NOT surface the KEEL offer (binary not installed — a separate requirement covers the installer path).
6. WHEN `[ -d ".keel" ]` is true after the bootstrap attempt in `new-project.md`, THE `new-project.md` workflow SHALL NOT surface the KEEL offer (KEEL already initialized successfully).
7. THE KEEL offer in `new-project.md` SHALL be presented after PROJECT.md creation and workflow preference collection are complete, so that it does not interrupt the core project setup flow.

### Requirement 2: Brownfield KEEL Offer in resume-project.md

**User Story:** As a developer resuming an existing GSD project, I want to be offered KEEL drift protection if the binary is installed but the repo was never initialized, so that I can add KEEL to an existing project without knowing the manual command.

#### Acceptance Criteria

1. WHEN `resume-project.md` runs the KEEL companion restart check AND `command -v keel` succeeds AND `[ -d ".keel" ]` is false, THE `resume-project.md` workflow SHALL surface a one-time non-blocking offer to initialize KEEL for the existing project.
2. THE KEEL offer in `resume-project.md` SHALL include a one-liner description of what KEEL does and note that it can be added to existing projects.
3. WHEN the user accepts the KEEL offer in `resume-project.md`, THE `resume-project.md` workflow SHALL run `keel install` (or `keel init && keel scan && keel companion start`) as a fire-and-forget operation with `2>/dev/null` error suppression.
4. WHEN the user declines the KEEL offer in `resume-project.md`, THE `resume-project.md` workflow SHALL continue to the normal project status presentation without any KEEL initialization.
5. WHEN `command -v keel` fails in `resume-project.md`, THE `resume-project.md` workflow SHALL NOT surface the KEEL offer.
6. WHEN `[ -d ".keel" ]` is true in `resume-project.md`, THE `resume-project.md` workflow SHALL NOT surface the KEEL offer (KEEL already initialized — existing companion restart logic applies).
7. THE KEEL offer in `resume-project.md` SHALL be presented before the project status display, so that KEEL state is available when the status banner is shown if the user accepts.

### Requirement 3: KEEL Mention in GSD Installer

**User Story:** As a developer installing GSD for the first time, I want to know that KEEL is an optional companion available for drift protection, so that I can make an informed decision about whether to install it.

#### Acceptance Criteria

1. WHEN `bin/install.js` completes a successful GSD installation, THE Installer SHALL display a post-install message that mentions KEEL as an optional companion tool.
2. THE post-install KEEL mention SHALL include the install command or URL for obtaining the `keel` binary (e.g., `brew install keel` or the canonical install URL).
3. THE post-install KEEL mention SHALL describe KEEL's purpose in one sentence (e.g., "real-time drift protection that runs alongside GSD").
4. THE post-install KEEL mention SHALL be clearly marked as optional so that users who do not want KEEL are not confused or blocked.
5. WHEN `command -v keel` succeeds at install time, THE Installer SHALL acknowledge that KEEL is already installed and skip the install instructions, showing only a note that KEEL will be offered during project setup.
6. THE post-install KEEL mention SHALL appear after all runtime-specific installation steps are complete and SHALL NOT interrupt or delay the primary installation flow.

### Requirement 4: Offer Non-Blocking and Skip-Friendly Behavior

**User Story:** As a developer who does not want KEEL, I want all KEEL offers to be easy to dismiss and never required, so that KEEL never adds friction to my GSD workflow.

#### Acceptance Criteria

1. THE KEEL offer (in both `new-project.md` and `resume-project.md`) SHALL present a clear "skip" or "no thanks" option as a first-class choice alongside the "enable" option.
2. WHEN the user skips the KEEL offer, THE GSD workflow SHALL proceed immediately to the next step without delay, additional prompts, or re-surfacing the offer.
3. THE KEEL offer SHALL NOT block, pause, or gate any GSD workflow step — it SHALL be presented as an aside after the primary workflow step completes.
4. IF the KEEL initialization command fails after the user accepts the offer, THEN THE GSD workflow SHALL continue normally and SHALL surface a non-fatal advisory message indicating KEEL could not be initialized.
5. THE KEEL offer SHALL NOT appear more than once per session in a given workflow invocation.

### Requirement 5: Offer Copy and Framing

**User Story:** As a developer seeing the KEEL offer for the first time, I want the offer to be informative and concise, so that I can make a quick decision without needing to research KEEL separately.

#### Acceptance Criteria

1. THE KEEL offer copy SHALL identify KEEL by name and describe its primary function in 15 words or fewer.
2. THE KEEL offer copy SHALL use language consistent with GSD's tone — direct, non-hyperbolic, and developer-facing.
3. THE KEEL offer in `new-project.md` SHALL be framed as a greenfield opportunity (e.g., "KEEL drift protection is available — enable it for this project?").
4. THE KEEL offer in `resume-project.md` SHALL be framed as a brownfield addition (e.g., "KEEL isn't set up for this repo yet — add drift protection now?").
5. THE post-install KEEL mention in `bin/install.js` SHALL be framed as a discovery note, not a prompt (e.g., "Optional: KEEL adds real-time drift protection — install with: ...").

### Requirement 6: Preservation of Existing KEEL Wiring

**User Story:** As a developer using GSD with KEEL already initialized, I want the magical install changes to have zero impact on my existing KEEL setup, so that the new onboarding flow does not break anything that already works.

#### Acceptance Criteria

1. WHEN `[ -d ".keel" ]` is true, THE `new-project.md` workflow SHALL execute the existing bootstrap guard (`keel init`, `keel scan`, `keel companion start`) unchanged and SHALL NOT surface the KEEL offer.
2. WHEN `[ -d ".keel" ]` is true, THE `resume-project.md` workflow SHALL execute the existing companion restart logic unchanged and SHALL NOT surface the KEEL offer.
3. THE changes to `new-project.md` SHALL NOT alter the existing fire-and-forget bootstrap block that runs before the KEEL offer check.
4. THE changes to `resume-project.md` SHALL NOT alter the existing KEEL-STATUS.md surface step that runs when `.keel/` is present.
5. THE changes to `bin/install.js` SHALL NOT alter any existing runtime installation logic, file copy operations, or post-install output for any supported runtime.
6. WHEN KEEL is not installed (`command -v keel` fails), ALL existing GSD workflows SHALL continue to operate as no-ops with respect to KEEL, exactly as before.
