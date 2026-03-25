/**
 * KEEL Integration Gaps — Preservation Property Tests
 *
 * Property 2: Preservation — Existing KEEL Wiring and KEEL-Absent Behavior Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16**
 *
 * IMPORTANT: These tests MUST PASS on unfixed code.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'get-shit-done', 'workflows');
const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const EXECUTE_PHASE_MD = path.join(WORKFLOWS_DIR, 'execute-phase.md');
const NEW_PROJECT_MD = path.join(WORKFLOWS_DIR, 'new-project.md');
const GUARD_JS = path.join(HOOKS_DIR, 'gsd-workflow-guard.js');
const STATUSLINE_JS = path.join(HOOKS_DIR, 'gsd-statusline.js');

describe('Property 2: Preservation — Existing KEEL Wiring and KEEL-Absent Behavior Unchanged', () => {

  test('P2.1 execute-phase.md validate_phase contains companion start + checkpoint', () => {
    assert.ok(fs.existsSync(EXECUTE_PHASE_MD), 'execute-phase.md must exist');
    const content = fs.readFileSync(EXECUTE_PHASE_MD, 'utf-8');
    const m = content.match(/<step name="validate_phase">[^]*?<\/step>/);
    assert.ok(m, 'validate_phase step must exist in execute-phase.md');
    const block = m[0];
    assert.ok(block.includes('command -v keel >/dev/null 2>&1 && [ -d ".keel" ]'), 'validate_phase KEEL guard must use full two-part guard');
    assert.ok(block.includes('keel companion status 2>/dev/null | grep -q "running" || keel companion start 2>/dev/null'), 'validate_phase must contain companion start fire-and-forget');
    assert.ok(block.includes('keel checkpoint 2>/dev/null'), 'validate_phase must contain keel checkpoint 2>/dev/null');
  });

  test('P2.2 execute-phase.md keel_phase_close contains keel checkpoint', () => {
    const content = fs.readFileSync(EXECUTE_PHASE_MD, 'utf-8');
    const m = content.match(/<step name="keel_phase_close">[^]*?<\/step>/);
    assert.ok(m, 'keel_phase_close step must exist in execute-phase.md');
    const block = m[0];
    assert.ok(block.includes('command -v keel >/dev/null 2>&1 && [ -d ".keel" ]'), 'keel_phase_close must use full two-part guard');
    assert.ok(block.includes('keel checkpoint 2>/dev/null'), 'keel_phase_close must contain keel checkpoint 2>/dev/null');
  });

  test('P2.3 new-project.md bootstrap block contains keel init, keel scan, keel companion start', () => {
    assert.ok(fs.existsSync(NEW_PROJECT_MD), 'new-project.md must exist');
    const content = fs.readFileSync(NEW_PROJECT_MD, 'utf-8');
    assert.ok(content.includes('keel init 2>/dev/null'), 'bootstrap must contain: keel init 2>/dev/null');
    assert.ok(content.includes('keel scan 2>/dev/null'), 'bootstrap must contain: keel scan 2>/dev/null');
    assert.ok(content.includes('keel companion start 2>/dev/null'), 'bootstrap must contain: keel companion start 2>/dev/null');
  });

  test('P2.4 new-project.md bootstrap uses binary-only guard (no [ -d ".keel" ] as actual condition)', () => {
    const content = fs.readFileSync(NEW_PROJECT_MD, 'utf-8');
    const bootstrapIdx = content.indexOf('KEEL guardrail bootstrap');
    assert.ok(bootstrapIdx !== -1, 'KEEL guardrail bootstrap label must exist in new-project.md');
    const bootstrapRegion = content.slice(bootstrapIdx, bootstrapIdx + 400);
    assert.ok(bootstrapRegion.includes('if command -v keel >/dev/null 2>&1;'), 'bootstrap must use binary-only guard');
    // The guard condition line must NOT include [ -d ".keel" ] as an actual shell condition
    // (comments may reference it for documentation purposes, but the if-line itself must be binary-only)
    const ifLine = bootstrapRegion.split('\n').find(l => l.trim().startsWith('if command -v keel'));
    assert.ok(ifLine, 'bootstrap if-line must exist');
    assert.ok(!ifLine.includes('[ -d ".keel" ]'), 'bootstrap if-line must NOT contain [ -d ".keel" ] — intentional bootstrap exception');
  });

  test('P2.5 gsd-workflow-guard.js reads .keel/session/alerts.yaml via path.join', () => {
    assert.ok(fs.existsSync(GUARD_JS), 'gsd-workflow-guard.js must exist');
    const content = fs.readFileSync(GUARD_JS, 'utf-8');
    assert.ok(content.includes("path.join(cwd, '.keel', 'session', 'alerts.yaml')"), "guard must use path.join(cwd, '.keel', 'session', 'alerts.yaml')");
  });

  test('P2.6 gsd-workflow-guard.js is soft advisory (never blocks, outputs additionalContext)', () => {
    const content = fs.readFileSync(GUARD_JS, 'utf-8');
    const exitCalls = (content.match(/process\.exit\(0\)/g) || []).length;
    assert.ok(exitCalls >= 4, 'guard must have at least 4 process.exit(0) calls. Found: ' + exitCalls);
    assert.ok(content.includes('hookSpecificOutput'), 'guard must output hookSpecificOutput');
    assert.ok(content.includes('additionalContext'), 'guard must use additionalContext field');
    assert.ok(!content.includes('"type": "decision"'), 'guard must not output decision-type responses');
  });

  test('P2.7 gsd-statusline.js reads companion-heartbeat.yaml and alerts.yaml', () => {
    assert.ok(fs.existsSync(STATUSLINE_JS), 'gsd-statusline.js must exist');
    const content = fs.readFileSync(STATUSLINE_JS, 'utf-8');
    assert.ok(content.includes('companion-heartbeat.yaml'), 'statusline must read companion-heartbeat.yaml');
    assert.ok(content.includes('alerts.yaml'), 'statusline must read alerts.yaml');
  });

  test('P2.8 gsd-statusline.js displays anchor icon with clean/warn/drift/stale states', () => {
    const content = fs.readFileSync(STATUSLINE_JS, 'utf-8');
    assert.ok(content.includes('\u2693'), 'statusline must display anchor icon for KEEL state');
    assert.ok(content.includes('clean'), 'statusline must have clean state');
    assert.ok(content.includes('drift') || content.includes('warn'), 'statusline must have drift/warn state');
    assert.ok(content.includes('stale') || content.includes('off'), 'statusline must have stale/off state');
    const keelIdx = content.indexOf('companion-heartbeat.yaml');
    const beforeKeel = content.slice(Math.max(0, keelIdx - 200), keelIdx);
    assert.ok(beforeKeel.includes('try {') || beforeKeel.includes('try{'), 'KEEL state block must be wrapped in try/catch');
  });

  test('P2.9a new-project.md KEEL bootstrap block present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-project.md'), 'utf-8');
    assert.ok(c.includes('keel init 2>/dev/null') && c.includes('keel scan 2>/dev/null') && c.includes('keel companion start 2>/dev/null'), 'new-project.md must have bootstrap block');
  });

  test('P2.9b execute-phase.md KEEL blocks present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'execute-phase.md'), 'utf-8');
    assert.ok(c.includes('keel companion start 2>/dev/null'), 'execute-phase.md must have companion start');
    assert.ok(c.includes('keel drift 2>/dev/null'), 'execute-phase.md must have keel drift');
    assert.ok(c.includes('keel checkpoint 2>/dev/null'), 'execute-phase.md must have keel checkpoint');
  });

  test('P2.9c execute-plan.md KEEL blocks present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'execute-plan.md'), 'utf-8');
    assert.ok(c.includes('keel_installed'), 'execute-plan.md must have keel_installed');
    assert.ok(c.includes('KEEL-STATUS.md'), 'execute-plan.md must have KEEL-STATUS.md display');
    assert.ok(c.includes('keel advance 2>/dev/null'), 'execute-plan.md must have keel advance');
  });

  test('P2.9d verify-phase.md KEEL done-gate advisory present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'verify-phase.md'), 'utf-8');
    assert.ok(c.includes('keel done') || c.includes('keel_done_gate'), 'verify-phase.md must have keel done advisory');
  });

  test('P2.9e verify-work.md keel_done_precheck step present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'verify-work.md'), 'utf-8');
    assert.ok(c.includes('keel_done_precheck'), 'verify-work.md must have keel_done_precheck step');
    assert.ok(c.includes('keel done 2>/dev/null'), 'verify-work.md must have keel done 2>/dev/null');
  });

  test('P2.9f resume-project.md companion restart + KEEL-STATUS.md display present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'resume-project.md'), 'utf-8');
    assert.ok(c.includes('keel companion start 2>/dev/null'), 'resume-project.md must have companion start');
    assert.ok(c.includes('KEEL-STATUS.md'), 'resume-project.md must have KEEL-STATUS.md display');
  });

  test('P2.9g discuss-phase.md keel goal sync present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'discuss-phase.md'), 'utf-8');
    assert.ok(c.includes('keel goal 2>/dev/null'), 'discuss-phase.md must have keel goal 2>/dev/null');
  });

  test('P2.9h plan-phase.md keel plan sync present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'plan-phase.md'), 'utf-8');
    assert.ok(c.includes('keel plan 2>/dev/null'), 'plan-phase.md must have keel plan 2>/dev/null');
  });

  test('P2.9i transition.md keel checkpoint present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'transition.md'), 'utf-8');
    assert.ok(c.includes('keel checkpoint 2>/dev/null'), 'transition.md must have keel checkpoint 2>/dev/null');
  });

  test('P2.9j complete-milestone.md keel checkpoint + companion stop present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'complete-milestone.md'), 'utf-8');
    assert.ok(c.includes('keel checkpoint 2>/dev/null'), 'complete-milestone.md must have keel checkpoint');
    assert.ok(c.includes('keel companion stop 2>/dev/null'), 'complete-milestone.md must have keel companion stop');
  });

  test('P2.9k pause-work.md keel checkpoint + companion stop present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'pause-work.md'), 'utf-8');
    assert.ok(c.includes('keel checkpoint 2>/dev/null'), 'pause-work.md must have keel checkpoint');
    assert.ok(c.includes('keel companion stop 2>/dev/null'), 'pause-work.md must have keel companion stop');
  });

  test('P2.9l new-milestone.md keel scan + keel goal present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'new-milestone.md'), 'utf-8');
    assert.ok(c.includes('keel scan 2>/dev/null'), 'new-milestone.md must have keel scan');
    assert.ok(c.includes('keel goal 2>/dev/null'), 'new-milestone.md must have keel goal');
  });

  test('P2.9m autonomous.md full KEEL lifecycle present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'autonomous.md'), 'utf-8');
    assert.ok(c.includes('keel companion start 2>/dev/null'), 'autonomous.md must have companion start');
    assert.ok(c.includes('keel drift 2>/dev/null'), 'autonomous.md must have keel drift');
    assert.ok(c.includes('keel checkpoint 2>/dev/null'), 'autonomous.md must have keel checkpoint');
    assert.ok(c.includes('keel companion stop 2>/dev/null'), 'autonomous.md must have companion stop');
  });

  test('P2.9n fast.md companion start present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'fast.md'), 'utf-8');
    assert.ok(c.includes('keel companion start 2>/dev/null'), 'fast.md must have companion start');
  });

  test('P2.9o quick.md companion start present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'quick.md'), 'utf-8');
    assert.ok(c.includes('keel companion start 2>/dev/null'), 'quick.md must have companion start');
  });

  test('P2.9p progress.md companion start + keel_installed + KEEL-STATUS.md present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'progress.md'), 'utf-8');
    assert.ok(c.includes('keel companion start 2>/dev/null'), 'progress.md must have companion start');
    assert.ok(c.includes('keel_installed'), 'progress.md must have keel_installed');
    assert.ok(c.includes('KEEL-STATUS.md'), 'progress.md must have KEEL-STATUS.md display');
  });

  test('P2.9q health.md KEEL-STATUS.md display + keel_status_check step present', () => {
    const c = fs.readFileSync(path.join(WORKFLOWS_DIR, 'health.md'), 'utf-8');
    assert.ok(c.includes('KEEL-STATUS.md'), 'health.md must have KEEL-STATUS.md display');
    assert.ok(c.includes('keel_status_check'), 'health.md must have keel_status_check step');
  });

  test('P2.10 All keel command invocations in workflow files use 2>/dev/null', () => {
    const workflowFiles = fs.readdirSync(WORKFLOWS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(WORKFLOWS_DIR, f));

    const violations = [];
    for (const wfFile of workflowFiles) {
      const wfName = path.basename(wfFile);
      const content = fs.readFileSync(wfFile, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\s*keel\s+(init|scan|companion|checkpoint|drift|done|advance|goal|plan)\b/.test(trimmed)) {
          if (!trimmed.includes('2>/dev/null') && !trimmed.includes('2> /dev/null')) {
            violations.push(wfName + ': ' + trimmed);
          }
        }
      }
    }

    assert.strictEqual(violations.length, 0, 'All keel commands must use 2>/dev/null. Violations:\n' + violations.join('\n'));
  });

});
