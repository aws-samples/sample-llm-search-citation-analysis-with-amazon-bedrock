import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  compareVersions, releases, versionProblems 
} from './check-version.mjs'

const CHANGELOG = ['# Changelog', '', '## [2.42.0] - 2026-11-05', '', 'text', '', '## [2.41.1] - 2026-11-01', ''].join('\n')

test('releases are read in file order from well-formed, dated headings only', () => {
  assert.deepEqual(releases(`${CHANGELOG}\n## [Unreleased]\n## [2.0.0]\n`), ['2.42.0', '2.41.1'])
})

test('versions compare numerically, not as text', () => {
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0)
  assert.ok(compareVersions('2.9.9', '2.10.0') < 0)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
})

test('matching packages and changelog pass', () => {
  assert.deepEqual(versionProblems(CHANGELOG, {
    'package.json': '2.42.0',
    'web/package.json': '2.42.0' 
  }), [])
})

test('a package that was not bumped, or carries a non-SemVer version, is reported by file', () => {
  const problems = versionProblems(CHANGELOG, {
    'package.json': '2.42.0',
    'web/package.json': '2.41.1',
    other: '2.42' 
  })
  assert.equal(problems.length, 2)
  assert.match(problems[0], /^web\/package\.json is 2\.41\.1, but the newest CHANGELOG\.md release is 2\.42\.0$/)
  assert.match(problems[1], /not MAJOR\.MINOR\.PATCH/)
})

test('a release added below a newer one, or no release at all, fails', () => {
  const misordered = ['## [2.41.2] - 2026-11-06', '', CHANGELOG].join('\n')
  assert.match(versionProblems(misordered, {})[0], /2\.41\.2 is not above 2\.42\.0/)
  assert.match(versionProblems('# Changelog\n', {})[0], /no release heading/)
})
