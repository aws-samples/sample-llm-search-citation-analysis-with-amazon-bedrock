// The scheduling of scripts/validate.sh, driven through --list and --dry-run (every command a no-op), so the
// runner's lanes, selection, failure report and --failed re-run are tested without running a single gate.
// /bin/bash on purpose: on macOS that is bash 3.2, the oldest shell the script promises to run under.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync, readFileSync, readdirSync, rmSync 
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = new URL('./validate.sh', import.meta.url).pathname

function runValidate(args, env = {}) {
  const result = spawnSync('/bin/bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      GITHUB_ACTIONS: '' 
    } 
  })
  return {
    status: result.status,
    out: `${result.stdout}${result.stderr}` 
  }
}

function withLogRoot(body) {
  const root = mkdtempSync(join(tmpdir(), 'validate-test-'))
  try {
    body(root)
  } finally {
    rmSync(root, {
      recursive: true,
      force: true 
    })
  }
}

test('--list names every step with its lane, and --lane / --only narrow it', () => {
  const all = runValidate(['--list'])
  assert.equal(all.status, 0)
  const lanes = new Set(all.out.trim().split('\n').map((line) => line.split(/\s+/)[0]))
  assert.deepEqual([...lanes].sort(), ['lint', 'py', 'sec', 'test', 'tsc', 'web'])
  const py = runValidate(['--list', '--lane', 'py']).out.trim().split('\n')
  assert.ok(py.every((line) => line.startsWith('py ')))
  assert.ok(py.some((line) => line.endsWith(' pytest')))
  const web = runValidate(['--list', '--only', 'web']).out
  assert.match(web, /vitest: dashboard/)
  assert.doesNotMatch(web, /pytest/)
})

test('an unknown lane, group or option is refused with exit 2', () => {
  assert.equal(runValidate(['--lane', 'nope']).status, 2)
  assert.equal(runValidate(['--only', 'nope']).status, 2)
  assert.equal(runValidate(['--nope']).status, 2)
})

test('a dry run schedules every lane and passes', () => {
  withLogRoot((root) => {
    const {
      status, out 
    } = runValidate(['--dry-run'], { VALIDATE_LOG_ROOT: root })
    assert.equal(status, 0, out)
    assert.match(out, /validate: \d+ step\(s\) in 6 lane\(s\)/)
    assert.match(out, /npm run validate:help/)
    assert.match(out, /validate: every gate passed/)
  })
})

test('a failing step fails the run, prints its log, and --failed re-runs only what did not pass', () => {
  withLogRoot((root) => {
    const failed = runValidate(['--dry-run', '--keep-going'], {
      VALIDATE_LOG_ROOT: root,
      VALIDATE_DRY_RUN_FAIL: 'ruff' 
    })
    assert.equal(failed.status, 1)
    assert.match(failed.out, /FAIL\s+\d+\s+py\s+ruff/)
    assert.match(failed.out, /======== FAILED: ruff \(exit 1\)/)
    // The rest of the py lane never ran; the other lanes finished (--keep-going).
    assert.match(failed.out, /not-run\s+-\s+py\s+pytest/)
    assert.match(failed.out, /ok\s+\d+\s+web\s+vitest: dashboard/)
    const [run] = readdirSync(root)
    const statuses = readFileSync(join(root, run, 'timings.tsv'), 'utf8')
    assert.match(statuses, /^FAIL\t/m)

    const rerun = runValidate(['--dry-run', '--failed', '--list'], { VALIDATE_LOG_ROOT: root })
    const steps = rerun.out.trim().split('\n').filter((line) => !line.startsWith('validate:'))
    assert.ok(steps.length > 0)
    assert.ok(steps.every((line) => line.startsWith('py ')), rerun.out)
  })
})

test('--help explains the lanes, the agent workflow and lists every step', () => {
  const {
    status, out 
  } = runValidate(['--help'])
  assert.equal(status, 0)
  for (const heading of ['WHAT IT DOES', 'LANES', 'OPTIONS', 'LOGS', 'PREREQUISITES', 'FOR AI AGENTS', 'STEPS']) {
    assert.match(out, new RegExp(`^${heading}`, 'm'))
  }
  const listed = runValidate(['--list']).out.trim().split('\n').map((line) => line.split(/\s{2,}/).at(-1))
  for (const step of listed) assert.ok(out.includes(step), `--help lists ${step}`)
})
