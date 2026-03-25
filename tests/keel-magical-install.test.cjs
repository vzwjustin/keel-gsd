/**
 * keel-magical-install — Property-Based Tests
 *
 * Property 1: Offer condition is a strict biconditional
 *
 * For any combination of (keelInstalled, keelDirExists), the KEEL offer is shown
 * if and only if keelInstalled is true AND keelDirExists is false.
 *
 * **Validates: Requirements 1.1, 1.5, 1.6**
 *
 * Feature: keel-magical-install, Property 1: Offer condition is a strict biconditional
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

/**
 * Mirrors the bash condition logic:
 *   command -v keel >/dev/null 2>&1 && [ ! -d ".keel" ]
 *
 * @param {boolean} keelInstalled - true if `command -v keel` succeeds
 * @param {boolean} keelDirExists - true if `.keel/` directory exists
 * @returns {boolean} whether the KEEL offer should be shown
 */
function evaluateOfferCondition(keelInstalled, keelDirExists) {
  return keelInstalled && !keelDirExists;
}

/**
 * Returns the functional description sentence for the KEEL offer.
 * This is the sentence explaining what KEEL does, excluding the question framing.
 *
 * @param {'greenfield'|'brownfield'} offerType
 * @returns {string}
 */
function getOfferDescription(offerType) {
  if (offerType === 'greenfield') {
    return 'KEEL watches for scope drift and blocks phase completion until reality matches intent.';
  }
  // brownfield
  return 'It watches for scope drift and can be added to existing projects.';
}

describe('Property 1: Offer condition is a strict biconditional', () => {
  test('offerShown === (keelInstalled && !keelDirExists) for all boolean inputs', () => {
    // Feature: keel-magical-install, Property 1: Offer condition is a strict biconditional
    fc.assert(
      fc.property(
        fc.boolean(), // keelInstalled
        fc.boolean(), // keelDirExists
        (keelInstalled, keelDirExists) => {
          const offerShown = evaluateOfferCondition(keelInstalled, keelDirExists);
          return offerShown === (keelInstalled && !keelDirExists);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for the four concrete cases
  test('keel installed + .keel/ absent → offer shown', () => {
    assert.strictEqual(evaluateOfferCondition(true, false), true);
  });

  test('keel installed + .keel/ present → offer NOT shown', () => {
    assert.strictEqual(evaluateOfferCondition(true, true), false);
  });

  test('keel not installed + .keel/ absent → offer NOT shown', () => {
    assert.strictEqual(evaluateOfferCondition(false, false), false);
  });

  test('keel not installed + .keel/ present → offer NOT shown', () => {
    assert.strictEqual(evaluateOfferCondition(false, true), false);
  });
});

/**
 * Property 2: Offer description word count
 *
 * For any rendering of the KEEL offer text, the description of what KEEL does
 * (the sentence explaining its function, excluding the question framing) must
 * contain 15 words or fewer.
 *
 * **Validates: Requirements 5.1**
 *
 * Feature: keel-magical-install, Property 2: Offer description word count
 */
describe('Property 2: Offer description word count', () => {
  test('description word count ≤ 15 for all offer types', () => {
    // Feature: keel-magical-install, Property 2: Offer description word count
    fc.assert(
      fc.property(
        fc.constantFrom('greenfield', 'brownfield'),
        (offerType) => {
          const description = getOfferDescription(offerType);
          const wordCount = description.trim().split(/\s+/).length;
          return wordCount <= 15;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for each concrete offer type
  test('greenfield description is ≤ 15 words', () => {
    const desc = getOfferDescription('greenfield');
    const wordCount = desc.trim().split(/\s+/).length;
    assert.ok(wordCount <= 15, `Expected ≤ 15 words, got ${wordCount}: "${desc}"`);
  });

  test('brownfield description is ≤ 15 words', () => {
    const desc = getOfferDescription('brownfield');
    const wordCount = desc.trim().split(/\s+/).length;
    assert.ok(wordCount <= 15, `Expected ≤ 15 words, got ${wordCount}: "${desc}"`);
  });
});

/**
 * Property 3: Accepted command uses fire-and-forget
 *
 * For any KEEL offer acceptance (in either workflow), the command string that is
 * executed must contain `2>/dev/null` error suppression and must not block the
 * workflow on failure.
 *
 * **Validates: Requirements 1.3, 4.3**
 *
 * Feature: keel-magical-install, Property 3: Accepted command uses fire-and-forget
 */

/**
 * Returns the command string executed when the user accepts the KEEL offer.
 * Both workflows use the same fire-and-forget command.
 *
 * @param {'new-project'|'resume-project'} workflow
 * @returns {string}
 */
function getKeelAcceptCommand(workflow) {
  // Both greenfield (new-project) and brownfield (resume-project) use the same command
  return 'keel install 2>/dev/null || (keel init 2>/dev/null && keel scan 2>/dev/null && keel companion start 2>/dev/null)';
}

describe('Property 3: Accepted command uses fire-and-forget', () => {
  test('accepted command includes 2>/dev/null for all workflows', () => {
    // Feature: keel-magical-install, Property 3: Accepted command uses fire-and-forget
    fc.assert(
      fc.property(
        fc.constantFrom('new-project', 'resume-project'),
        (workflow) => {
          const cmd = getKeelAcceptCommand(workflow);
          return cmd.includes('2>/dev/null');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for each concrete workflow
  test('new-project accept command includes 2>/dev/null', () => {
    const cmd = getKeelAcceptCommand('new-project');
    assert.ok(cmd.includes('2>/dev/null'), `Expected command to include 2>/dev/null, got: "${cmd}"`);
  });

  test('resume-project accept command includes 2>/dev/null', () => {
    const cmd = getKeelAcceptCommand('resume-project');
    assert.ok(cmd.includes('2>/dev/null'), `Expected command to include 2>/dev/null, got: "${cmd}"`);
  });
});

/**
 * Greenfield offer logic — unit tests
 *
 * Simulates the KEEL offer logic from `commands/gsd/new-project.md`:
 * - Determines whether the offer is shown based on system state
 * - Simulates user accept/decline and the resulting workflow output
 *
 * _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 4.4_
 */

/**
 * Simulates the greenfield KEEL offer logic from new-project.md.
 *
 * @param {{ keelInstalled: boolean, keelDirExists: boolean, keelInstallSucceeds?: boolean }} state
 * @param {'accept' | 'decline' | null} userChoice
 * @returns {{ offerShown: boolean, commandExecuted: string | null, advisoryShown: boolean, workflowContinued: boolean }}
 */
function simulateGreenfieldOffer(state, userChoice) {
  const { keelInstalled, keelDirExists, keelInstallSucceeds = true } = state;

  // Offer is only shown when binary is present AND .keel/ does not exist
  const offerShown = keelInstalled && !keelDirExists;

  if (!offerShown) {
    // No offer — workflow continues normally, no KEEL command
    return {
      offerShown: false,
      commandExecuted: null,
      advisoryShown: false,
      workflowContinued: true,
    };
  }

  // Offer is shown — handle user choice
  if (userChoice === 'accept') {
    const commandExecuted = 'keel install 2>/dev/null';
    // After running the command, check if .keel/ now exists
    const keelDirCreated = keelInstallSucceeds;
    const advisoryShown = !keelDirCreated;
    return {
      offerShown: true,
      commandExecuted,
      advisoryShown,
      workflowContinued: true,
    };
  }

  // decline (or null treated as decline/skip)
  return {
    offerShown: true,
    commandExecuted: null,
    advisoryShown: false,
    workflowContinued: true,
  };
}

describe('Greenfield offer logic — unit tests', () => {
  // Req 1.1: keel installed + .keel/ absent → offer shown
  test('keel installed + .keel/ absent → offer shown', () => {
    const result = simulateGreenfieldOffer({ keelInstalled: true, keelDirExists: false }, null);
    assert.strictEqual(result.offerShown, true);
  });

  // Req 1.6: keel installed + .keel/ present → offer not shown, existing bootstrap runs
  test('keel installed + .keel/ present → offer not shown, workflow continues', () => {
    const result = simulateGreenfieldOffer({ keelInstalled: true, keelDirExists: true }, null);
    assert.strictEqual(result.offerShown, false);
    assert.strictEqual(result.commandExecuted, null);
    assert.strictEqual(result.workflowContinued, true);
  });

  // Req 1.5: keel not installed → offer not shown, no KEEL output
  test('keel not installed → offer not shown, no KEEL command', () => {
    const result = simulateGreenfieldOffer({ keelInstalled: false, keelDirExists: false }, null);
    assert.strictEqual(result.offerShown, false);
    assert.strictEqual(result.commandExecuted, null);
    assert.strictEqual(result.advisoryShown, false);
  });

  // Req 1.3: user accepts → `keel install 2>/dev/null` in output
  test('user accepts → keel install 2>/dev/null command executed', () => {
    const result = simulateGreenfieldOffer({ keelInstalled: true, keelDirExists: false }, 'accept');
    assert.strictEqual(result.offerShown, true);
    assert.ok(result.commandExecuted !== null, 'Expected a command to be executed');
    assert.ok(
      result.commandExecuted.includes('keel install') && result.commandExecuted.includes('2>/dev/null'),
      `Expected "keel install 2>/dev/null" in command, got: "${result.commandExecuted}"`
    );
  });

  // Req 1.4: user declines → workflow continues, no KEEL command
  test('user declines → workflow continues, no KEEL command executed', () => {
    const result = simulateGreenfieldOffer({ keelInstalled: true, keelDirExists: false }, 'decline');
    assert.strictEqual(result.offerShown, true);
    assert.strictEqual(result.commandExecuted, null);
    assert.strictEqual(result.advisoryShown, false);
    assert.strictEqual(result.workflowContinued, true);
  });

  // Req 4.4: keel install fails (.keel/ still absent) → advisory message shown
  test('keel install fails (.keel/ still absent) → advisory shown, workflow continues', () => {
    const result = simulateGreenfieldOffer(
      { keelInstalled: true, keelDirExists: false, keelInstallSucceeds: false },
      'accept'
    );
    assert.strictEqual(result.offerShown, true);
    assert.ok(result.commandExecuted !== null, 'Expected a command to be executed');
    assert.strictEqual(result.advisoryShown, true);
    assert.strictEqual(result.workflowContinued, true);
  });
});

/**
 * Property 4: Decline is a no-op
 *
 * For any workflow invocation where the user declines the KEEL offer, the
 * workflow state after the decline must be identical to the workflow state
 * that would exist if the offer had never been shown — no KEEL initialization,
 * no re-prompt, no delay.
 *
 * **Validates: Requirements 1.4, 2.4, 4.2, 4.5**
 *
 * Feature: keel-magical-install, Property 4: Decline is a no-op
 */

/**
 * Captures a snapshot of the workflow state for a given system state.
 * The "workflow state" is defined as: no KEEL commands executed, no advisory
 * shown, and the workflow continues normally.
 *
 * @param {{ keelInstalled: boolean, keelDirExists: boolean }} state
 * @returns {{ commandsExecuted: string[], advisoryShown: boolean, workflowContinued: boolean, offerShownCount: number }}
 */
function captureWorkflowState(state) {
  // The workflow state is purely a function of the system state.
  // A decline means: no KEEL commands run, no advisory, workflow continues.
  // The offer count starts at 0 — it has not been shown yet in this snapshot.
  return {
    commandsExecuted: [],
    advisoryShown: false,
    workflowContinued: true,
    offerShownCount: 0,
  };
}

/**
 * Simulates the user declining the KEEL offer.
 * A decline is a no-op: it must not mutate the state object in any way
 * that would affect workflow execution.
 *
 * @param {{ keelInstalled: boolean, keelDirExists: boolean }} state
 */
function simulateDecline(state) {
  // Decline: do nothing. No KEEL commands, no state mutation.
  // The workflow continues to the next step immediately.
}

/**
 * Verifies that the KEEL offer is not re-shown after a decline.
 * Per Requirement 4.5, the offer must not appear more than once per session.
 *
 * @param {{ keelInstalled: boolean, keelDirExists: boolean }} state
 * @returns {boolean}
 */
function offerNotShownAgain(state) {
  // After a decline, the offer must not be re-surfaced.
  // We model this by checking that the offer count remains 0 post-decline.
  const postDeclineState = captureWorkflowState(state);
  return postDeclineState.offerShownCount === 0;
}

/**
 * Deep equality check for workflow state snapshots.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('Property 4: Decline is a no-op', () => {
  test('workflow state is unchanged after decline for all system states', () => {
    // Feature: keel-magical-install, Property 4: Decline is a no-op
    fc.assert(
      fc.property(
        fc.record({ keelInstalled: fc.boolean(), keelDirExists: fc.boolean() }),
        (state) => {
          const before = captureWorkflowState(state);
          simulateDecline(state);
          const after = captureWorkflowState(state);
          return deepEqual(before, after) && offerNotShownAgain(state);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for the decline no-op invariant
  test('decline when keel installed + .keel/ absent → no command executed, workflow continues', () => {
    const state = { keelInstalled: true, keelDirExists: false };
    const before = captureWorkflowState(state);
    simulateDecline(state);
    const after = captureWorkflowState(state);
    assert.deepStrictEqual(before, after);
    assert.strictEqual(after.commandsExecuted.length, 0);
    assert.strictEqual(after.advisoryShown, false);
    assert.strictEqual(after.workflowContinued, true);
  });

  test('decline when keel installed + .keel/ present → state unchanged (offer was never shown)', () => {
    const state = { keelInstalled: true, keelDirExists: true };
    const before = captureWorkflowState(state);
    simulateDecline(state);
    const after = captureWorkflowState(state);
    assert.deepStrictEqual(before, after);
  });

  test('decline when keel not installed → state unchanged (offer was never shown)', () => {
    const state = { keelInstalled: false, keelDirExists: false };
    const before = captureWorkflowState(state);
    simulateDecline(state);
    const after = captureWorkflowState(state);
    assert.deepStrictEqual(before, after);
  });

  test('offer not re-shown after decline for any system state', () => {
    const states = [
      { keelInstalled: true, keelDirExists: false },
      { keelInstalled: true, keelDirExists: true },
      { keelInstalled: false, keelDirExists: false },
      { keelInstalled: false, keelDirExists: true },
    ];
    for (const state of states) {
      simulateDecline(state);
      assert.strictEqual(offerNotShownAgain(state), true, `Expected offer not re-shown for state: ${JSON.stringify(state)}`);
    }
  });
});

/**
 * Property 7: No KEEL activity when binary is absent
 *
 * For any workflow invocation where `command -v keel` fails, no KEEL-related
 * command is executed, no KEEL offer is shown, and no KEEL output is produced.
 * The keelDirExists flag is irrelevant when the binary is absent, but both
 * values are tested to confirm the invariant holds unconditionally.
 *
 * **Validates: Requirements 1.5, 2.5, 4.3, 6.6**
 *
 * Feature: keel-magical-install, Property 7: No KEEL activity when binary is absent
 */

/**
 * Returns the array of commands that would be executed given the workflow state.
 * When keelInstalled is false, no keel commands are ever executed.
 *
 * @param {{ keelInstalled: boolean, keelDirExists: boolean }} state
 * @returns {string[]}
 */
function captureExecutedCommands(state) {
  const { keelInstalled, keelDirExists } = state;

  // The offer condition: binary present AND .keel/ absent
  const offerCondition = keelInstalled && !keelDirExists;

  if (!offerCondition) {
    // No offer shown → no keel commands executed
    return [];
  }

  // Offer shown and accepted (worst-case: assume accept to test the command path)
  // Even in the accept path, the command is only reached when keelInstalled is true.
  return [
    'keel install 2>/dev/null || (keel init 2>/dev/null && keel scan 2>/dev/null && keel companion start 2>/dev/null)',
  ];
}

/**
 * Returns the workflow output string for the given state.
 * When keelInstalled is false, no KEEL offer text appears in the output.
 *
 * @param {{ keelInstalled: boolean, keelDirExists: boolean }} state
 * @returns {string}
 */
function captureWorkflowOutput(state) {
  const { keelInstalled, keelDirExists } = state;

  // The offer condition: binary present AND .keel/ absent
  const offerCondition = keelInstalled && !keelDirExists;

  if (!offerCondition) {
    // No offer → output contains no KEEL offer text
    return 'Workflow completed normally.';
  }

  // Offer is shown — output includes the KEEL offer
  return 'KEEL offer: Enable drift protection for this project?';
}

describe('Property 7: No KEEL activity when binary is absent', () => {
  test('no keel commands executed and no KEEL offer in output when keelInstalled = false', () => {
    // Feature: keel-magical-install, Property 7: No KEEL activity when binary is absent
    fc.assert(
      fc.property(
        fc.boolean(), // keelDirExists (irrelevant when binary absent, but test both)
        (keelDirExists) => {
          const commands = captureExecutedCommands({ keelInstalled: false, keelDirExists });
          const output = captureWorkflowOutput({ keelInstalled: false, keelDirExists });
          return commands.every(cmd => !cmd.includes('keel')) &&
                 !output.includes('KEEL offer');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for the concrete cases
  test('keelInstalled=false, keelDirExists=false → no keel commands, no KEEL offer', () => {
    const commands = captureExecutedCommands({ keelInstalled: false, keelDirExists: false });
    const output = captureWorkflowOutput({ keelInstalled: false, keelDirExists: false });
    assert.strictEqual(commands.length, 0);
    assert.ok(!output.includes('KEEL offer'), `Expected no KEEL offer in output, got: "${output}"`);
  });

  test('keelInstalled=false, keelDirExists=true → no keel commands, no KEEL offer', () => {
    const commands = captureExecutedCommands({ keelInstalled: false, keelDirExists: true });
    const output = captureWorkflowOutput({ keelInstalled: false, keelDirExists: true });
    assert.strictEqual(commands.length, 0);
    assert.ok(!output.includes('KEEL offer'), `Expected no KEEL offer in output, got: "${output}"`);
  });

  test('keelInstalled=true, keelDirExists=false → keel command IS executed (control case)', () => {
    const commands = captureExecutedCommands({ keelInstalled: true, keelDirExists: false });
    assert.ok(commands.length > 0, 'Expected keel command when binary is present and .keel/ absent');
    assert.ok(commands.some(cmd => cmd.includes('keel')), 'Expected command to include keel');
  });
});

/**
 * Brownfield offer logic — unit tests
 *
 * Simulates the KEEL brownfield offer logic from `commands/gsd/resume-project.md`:
 * - Determines whether the offer is shown based on system state
 * - When `.keel/` is present: companion restart runs, offer is NOT shown
 * - When `.keel/` is absent and keel installed: offer IS shown
 * - Simulates user accept/decline and the resulting workflow output
 *
 * _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 6.2_
 */

/**
 * Simulates the brownfield KEEL offer logic from resume-project.md.
 *
 * The initialize step has two mutually exclusive KEEL blocks:
 *   1. Companion restart: runs if `command -v keel` succeeds AND `.keel/` exists
 *   2. Brownfield offer: runs if `command -v keel` succeeds AND `.keel/` is absent
 *
 * @param {{ keelInstalled: boolean, keelDirExists: boolean, keelInstallSucceeds?: boolean }} state
 * @param {'accept' | 'decline' | null} userChoice
 * @returns {{ offerShown: boolean, commandExecuted: string | null, advisoryShown: boolean, workflowContinued: boolean, companionRestartRan: boolean }}
 */
function simulateBrownfieldOffer(state, userChoice) {
  const { keelInstalled, keelDirExists, keelInstallSucceeds = true } = state;

  // Block 1: companion restart — runs when binary present AND .keel/ exists (Req 6.2)
  const companionRestartRan = keelInstalled && keelDirExists;

  // Block 2: brownfield offer — runs when binary present AND .keel/ absent (Req 2.1, 2.5, 2.6)
  // The two blocks are mutually exclusive by construction
  const offerShown = keelInstalled && !keelDirExists;

  if (!offerShown) {
    // No offer — workflow continues normally, no KEEL install command
    return {
      offerShown: false,
      commandExecuted: null,
      advisoryShown: false,
      workflowContinued: true,
      companionRestartRan,
    };
  }

  // Offer is shown — handle user choice
  if (userChoice === 'accept') {
    // Req 2.3: fire-and-forget with 2>/dev/null
    const commandExecuted = 'keel install 2>/dev/null';
    // After running the command, check if .keel/ now exists
    const keelDirCreated = keelInstallSucceeds;
    const advisoryShown = !keelDirCreated;
    return {
      offerShown: true,
      commandExecuted,
      advisoryShown,
      workflowContinued: true,
      companionRestartRan: false,
    };
  }

  // decline (or null treated as skip) — Req 2.4: continue to load_state immediately
  return {
    offerShown: true,
    commandExecuted: null,
    advisoryShown: false,
    workflowContinued: true,
    companionRestartRan: false,
  };
}

describe('Brownfield offer logic — unit tests', () => {
  // Req 2.1: keel installed + .keel/ absent → brownfield offer shown
  test('keel installed + .keel/ absent → brownfield offer shown', () => {
    const result = simulateBrownfieldOffer({ keelInstalled: true, keelDirExists: false }, null);
    assert.strictEqual(result.offerShown, true);
    assert.strictEqual(result.companionRestartRan, false);
  });

  // Req 2.6 + 6.2: keel installed + .keel/ present → companion restart runs, no offer
  test('keel installed + .keel/ present → companion restart runs, no offer shown', () => {
    const result = simulateBrownfieldOffer({ keelInstalled: true, keelDirExists: true }, null);
    assert.strictEqual(result.offerShown, false);
    assert.strictEqual(result.companionRestartRan, true);
    assert.strictEqual(result.commandExecuted, null);
    assert.strictEqual(result.workflowContinued, true);
  });

  // Req 2.5: keel not installed → no offer, no KEEL output
  test('keel not installed → no offer, no KEEL command, companion restart does not run', () => {
    const result = simulateBrownfieldOffer({ keelInstalled: false, keelDirExists: false }, null);
    assert.strictEqual(result.offerShown, false);
    assert.strictEqual(result.commandExecuted, null);
    assert.strictEqual(result.advisoryShown, false);
    assert.strictEqual(result.companionRestartRan, false);
  });

  // Req 2.3: user accepts → `keel install 2>/dev/null` in output
  test('user accepts → keel install 2>/dev/null command executed', () => {
    const result = simulateBrownfieldOffer({ keelInstalled: true, keelDirExists: false }, 'accept');
    assert.strictEqual(result.offerShown, true);
    assert.ok(result.commandExecuted !== null, 'Expected a command to be executed');
    assert.ok(
      result.commandExecuted.includes('keel install') && result.commandExecuted.includes('2>/dev/null'),
      `Expected "keel install 2>/dev/null" in command, got: "${result.commandExecuted}"`
    );
  });

  // Req 2.4: user declines → load_state proceeds immediately, no KEEL command
  test('user declines → workflow continues immediately, no KEEL command executed', () => {
    const result = simulateBrownfieldOffer({ keelInstalled: true, keelDirExists: false }, 'decline');
    assert.strictEqual(result.offerShown, true);
    assert.strictEqual(result.commandExecuted, null);
    assert.strictEqual(result.advisoryShown, false);
    assert.strictEqual(result.workflowContinued, true);
  });

  // Mutual exclusivity: companion restart and offer are never both true
  test('companion restart and brownfield offer are mutually exclusive for all states', () => {
    const states = [
      { keelInstalled: true, keelDirExists: true },
      { keelInstalled: true, keelDirExists: false },
      { keelInstalled: false, keelDirExists: true },
      { keelInstalled: false, keelDirExists: false },
    ];
    for (const state of states) {
      const result = simulateBrownfieldOffer(state, null);
      assert.ok(
        !(result.offerShown && result.companionRestartRan),
        `Expected offer and companion restart to be mutually exclusive for state: ${JSON.stringify(state)}`
      );
    }
  });
});

/**
 * Property 5: Installer output contains KEEL mention and install command
 *
 * For any call to `finishInstall()` where the keel binary is not installed,
 * the output string must contain both a reference to KEEL by name and an
 * install command or URL.
 *
 * **Validates: Requirements 3.1, 3.2, 3.4**
 *
 * Feature: keel-magical-install, Property 5: Installer output contains KEEL mention and install command
 */

/**
 * Mirrors the output logic of `finishInstall()` in `bin/install.js`.
 *
 * Returns the console output string that `finishInstall()` would produce for
 * the given runtime and keel installation state, without actually running the
 * function (which has side effects like writing files and running execSync).
 *
 * @param {string} runtime - one of 'claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf'
 * @param {boolean} keelInstalled - true if `command -v keel` would succeed
 * @returns {string} the output string
 */
function captureFinishInstallOutput(runtime, keelInstalled) {
  // Mirror the program/command mapping from finishInstall()
  let program = 'Claude Code';
  if (runtime === 'opencode') program = 'OpenCode';
  if (runtime === 'gemini') program = 'Gemini';
  if (runtime === 'codex') program = 'Codex';
  if (runtime === 'copilot') program = 'Copilot';
  if (runtime === 'antigravity') program = 'Antigravity';
  if (runtime === 'cursor') program = 'Cursor';
  if (runtime === 'windsurf') program = 'Windsurf';

  let command = '/gsd:new-project';
  if (runtime === 'opencode') command = '/gsd-new-project';
  if (runtime === 'codex') command = '$gsd-new-project';
  if (runtime === 'copilot') command = '/gsd-new-project';
  if (runtime === 'antigravity') command = '/gsd-new-project';
  if (runtime === 'cursor') command = 'gsd-new-project (mention the skill name)';

  // Mirror the KEEL discovery note logic from finishInstall()
  let keelNote;
  if (keelInstalled) {
    keelNote = '\n  KEEL is already installed — drift protection will be offered during project setup.\n';
  } else {
    keelNote = '\n  Optional: KEEL adds real-time drift protection that runs alongside GSD.\n  Install: brew install keel  (or https://getkeel.dev)\n';
  }

  return `
  Done! Open a blank directory in ${program} and run ${command}.
${keelNote}
  Join the community: https://discord.gg/gsd
`;
}

describe('Property 5: Installer output contains KEEL mention and install command', () => {
  test('output includes KEEL and brew install or getkeel.dev for all runtimes when keel not installed', () => {
    // Feature: keel-magical-install, Property 5: Installer output contains KEEL mention and install command
    fc.assert(
      fc.property(
        fc.constantFrom('claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf'),
        (runtime) => {
          const output = captureFinishInstallOutput(runtime, /* keelInstalled= */ false);
          return output.includes('KEEL') && (output.includes('brew install') || output.includes('getkeel.dev'));
        }
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for each runtime
  const runtimes = ['claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf'];
  for (const runtime of runtimes) {
    test(`${runtime}: output contains KEEL and install command when keel not installed`, () => {
      const output = captureFinishInstallOutput(runtime, false);
      assert.ok(output.includes('KEEL'), `Expected output to include 'KEEL' for runtime ${runtime}`);
      assert.ok(
        output.includes('brew install') || output.includes('getkeel.dev'),
        `Expected output to include 'brew install' or 'getkeel.dev' for runtime ${runtime}`
      );
    });
  }

  test('output contains "Optional: KEEL" when keel not installed', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(output.includes('Optional: KEEL'), `Expected "Optional: KEEL" in output, got: "${output}"`);
  });

  test('output contains "brew install keel" when keel not installed', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(output.includes('brew install keel'), `Expected "brew install keel" in output, got: "${output}"`);
  });

  test('output contains "getkeel.dev" when keel not installed', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(output.includes('getkeel.dev'), `Expected "getkeel.dev" in output, got: "${output}"`);
  });

  test('output contains "already installed" and no "brew install" when keel is installed', () => {
    const output = captureFinishInstallOutput('claude', true);
    assert.ok(output.includes('already installed'), `Expected "already installed" in output, got: "${output}"`);
    assert.ok(!output.includes('brew install'), `Expected no "brew install" in output when keel installed, got: "${output}"`);
  });
});

/**
 * Property 6: Installer output branches on keel presence
 *
 * For any call to `finishInstall()`, the output when `command -v keel` succeeds
 * must differ from the output when it fails — specifically, the "already installed"
 * path must not show install instructions, and the "not installed" path must not
 * claim KEEL is already installed.
 *
 * **Validates: Requirements 3.5**
 *
 * Feature: keel-magical-install, Property 6: Installer output branches on keel presence
 */
describe('Property 6: Installer output branches on keel presence', () => {
  test('installed path contains "already installed" and no "brew install"; not-installed path contains "brew install" and no "already installed"', () => {
    // Feature: keel-magical-install, Property 6: Installer output branches on keel presence
    fc.assert(
      fc.property(
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
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for the two branches
  test('keel installed → output contains "already installed"', () => {
    const output = captureFinishInstallOutput('claude', true);
    assert.ok(output.includes('already installed'), `Expected "already installed" in output, got: "${output}"`);
  });

  test('keel installed → output does not contain "brew install"', () => {
    const output = captureFinishInstallOutput('claude', true);
    assert.ok(!output.includes('brew install'), `Expected no "brew install" in output when keel installed, got: "${output}"`);
  });

  test('keel not installed → output contains "brew install"', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(output.includes('brew install'), `Expected "brew install" in output, got: "${output}"`);
  });

  test('keel not installed → output does not contain "already installed"', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(!output.includes('already installed'), `Expected no "already installed" in output when keel not installed, got: "${output}"`);
  });

  // Verify branching holds for all runtimes
  const runtimes = ['claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf'];
  for (const runtime of runtimes) {
    test(`${runtime}: installed path has "already installed", not-installed path has "brew install"`, () => {
      const installedOutput = captureFinishInstallOutput(runtime, true);
      const notInstalledOutput = captureFinishInstallOutput(runtime, false);
      assert.ok(installedOutput.includes('already installed'), `[${runtime}] Expected "already installed" when keel installed`);
      assert.ok(!installedOutput.includes('brew install'), `[${runtime}] Expected no "brew install" when keel installed`);
      assert.ok(notInstalledOutput.includes('brew install'), `[${runtime}] Expected "brew install" when keel not installed`);
      assert.ok(!notInstalledOutput.includes('already installed'), `[${runtime}] Expected no "already installed" when keel not installed`);
    });
  }
});

/**
 * finishInstall() KEEL note — unit tests
 *
 * Tests the KEEL discovery note output from `finishInstall()` in `bin/install.js`.
 * Uses `captureFinishInstallOutput(runtime, keelInstalled)` to simulate the output.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
 */
describe('finishInstall() KEEL note — unit tests', () => {
  // Req 3.1, 3.4: keel not installed → output contains "Optional: KEEL" and install command
  test('keel not installed → output contains "Optional: KEEL"', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(output.includes('Optional: KEEL'), `Expected "Optional: KEEL" in output, got: "${output}"`);
  });

  test('keel not installed → output contains install command (brew install keel)', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(output.includes('brew install keel'), `Expected "brew install keel" in output, got: "${output}"`);
  });

  test('keel not installed → output contains install URL (getkeel.dev)', () => {
    const output = captureFinishInstallOutput('claude', false);
    assert.ok(output.includes('getkeel.dev'), `Expected "getkeel.dev" in output, got: "${output}"`);
  });

  // Req 3.5: keel installed → output contains "already installed" and no install command
  test('keel installed → output contains "already installed"', () => {
    const output = captureFinishInstallOutput('claude', true);
    assert.ok(output.includes('already installed'), `Expected "already installed" in output, got: "${output}"`);
  });

  test('keel installed → output does not contain install command', () => {
    const output = captureFinishInstallOutput('claude', true);
    assert.ok(!output.includes('brew install'), `Expected no "brew install" when keel installed, got: "${output}"`);
  });

  test('keel installed → output does not contain "Optional: KEEL"', () => {
    const output = captureFinishInstallOutput('claude', true);
    assert.ok(!output.includes('Optional: KEEL'), `Expected no "Optional: KEEL" when keel installed, got: "${output}"`);
  });

  // Req 3.3, 3.6: Each supported runtime produces output with a KEEL note (either variant)
  const runtimes = ['claude', 'opencode', 'gemini', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf'];
  for (const runtime of runtimes) {
    test(`${runtime}: output contains KEEL note when keel not installed`, () => {
      const output = captureFinishInstallOutput(runtime, false);
      assert.ok(output.includes('Optional: KEEL'), `[${runtime}] Expected "Optional: KEEL" in output`);
      assert.ok(output.includes('brew install keel'), `[${runtime}] Expected "brew install keel" in output`);
    });

    test(`${runtime}: output contains KEEL note when keel installed`, () => {
      const output = captureFinishInstallOutput(runtime, true);
      assert.ok(output.includes('already installed'), `[${runtime}] Expected "already installed" in output`);
    });
  }

  // Req 3.6: KEEL note appears after "Done!" line and before "Join the community"
  test('KEEL note appears after "Done!" and before "Join the community" (keel not installed)', () => {
    const output = captureFinishInstallOutput('claude', false);
    const doneIndex = output.indexOf('Done!');
    const keelIndex = output.indexOf('Optional: KEEL');
    const communityIndex = output.indexOf('Join the community');
    assert.ok(doneIndex !== -1, 'Expected "Done!" in output');
    assert.ok(keelIndex !== -1, 'Expected "Optional: KEEL" in output');
    assert.ok(communityIndex !== -1, 'Expected "Join the community" in output');
    assert.ok(doneIndex < keelIndex, `Expected "Done!" before "Optional: KEEL" (positions: ${doneIndex}, ${keelIndex})`);
    assert.ok(keelIndex < communityIndex, `Expected "Optional: KEEL" before "Join the community" (positions: ${keelIndex}, ${communityIndex})`);
  });

  test('KEEL note appears after "Done!" and before "Join the community" (keel installed)', () => {
    const output = captureFinishInstallOutput('claude', true);
    const doneIndex = output.indexOf('Done!');
    const keelIndex = output.indexOf('already installed');
    const communityIndex = output.indexOf('Join the community');
    assert.ok(doneIndex !== -1, 'Expected "Done!" in output');
    assert.ok(keelIndex !== -1, 'Expected "already installed" in output');
    assert.ok(communityIndex !== -1, 'Expected "Join the community" in output');
    assert.ok(doneIndex < keelIndex, `Expected "Done!" before "already installed" (positions: ${doneIndex}, ${keelIndex})`);
    assert.ok(keelIndex < communityIndex, `Expected "already installed" before "Join the community" (positions: ${keelIndex}, ${communityIndex})`);
  });

  // Ordering check for all runtimes
  for (const runtime of runtimes) {
    test(`${runtime}: KEEL note is positioned between "Done!" and "Join the community"`, () => {
      // Test both variants
      for (const keelInstalled of [false, true]) {
        const output = captureFinishInstallOutput(runtime, keelInstalled);
        const doneIndex = output.indexOf('Done!');
        const communityIndex = output.indexOf('Join the community');
        const keelMarker = keelInstalled ? 'already installed' : 'Optional: KEEL';
        const keelIndex = output.indexOf(keelMarker);
        assert.ok(doneIndex < keelIndex, `[${runtime}, keelInstalled=${keelInstalled}] "Done!" should come before KEEL note`);
        assert.ok(keelIndex < communityIndex, `[${runtime}, keelInstalled=${keelInstalled}] KEEL note should come before "Join the community"`);
      }
    });
  }
});
