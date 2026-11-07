#!/usr/bin/env node
/**
 * package.json, web/package.json and the newest release in CHANGELOG.md carry the same version, and that
 * release is numbered above every other release section in the file (CONTRIBUTING.md, "Versioning and
 * changelog").
 *
 * The version-check workflow already asks a pull request that changes what ships for a NEW version; this
 * catches the local half of the same rule before the push: a bump in one package.json only, a CHANGELOG
 * entry for another number, or a release heading added below an older one.
 */
import { readFileSync } from 'node:fs'
import {
  dirname, join 
} from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PACKAGES = ['package.json', 'web/package.json']
const RELEASE = /^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/** Every release version in CHANGELOG.md, in file order (newest first by convention). */
export function releases(changelog) {
  return [...changelog.matchAll(RELEASE)].map((match) => match[1])
}

/** Negative, zero or positive as SemVer `a` is below, equal to or above `b`. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a).slice(1).map(Number)
  const pb = SEMVER.exec(b).slice(1).map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/** Problems found; empty when every package carries the newest release. `packages` maps file → version. */
export function versionProblems(changelog, packages) {
  const all = releases(changelog)
  if (all.length === 0) return ['CHANGELOG.md has no release heading of the form "## [2.42.0] - 2026-11-05"']
  const [newest, ...older] = all
  const problems = []
  const above = older.find((version) => compareVersions(version, newest) >= 0)
  if (above !== undefined) problems.push(`CHANGELOG.md: the first release ${newest} is not above ${above}, listed below it`)
  for (const [file, version] of Object.entries(packages)) {
    if (typeof version !== 'string' || !SEMVER.test(version)) {
      problems.push(`${file}: version ${JSON.stringify(version)} is not MAJOR.MINOR.PATCH`)
    } else if (version !== newest) {
      problems.push(`${file} is ${version}, but the newest CHANGELOG.md release is ${newest}`)
    }
  }
  return problems
}

function main() {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const packages = Object.fromEntries(
    PACKAGES.map((file) => [file, JSON.parse(readFileSync(join(ROOT, file), 'utf8')).version]),
  )
  const problems = versionProblems(changelog, packages)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-version: ${problem}`)
    return 1
  }
  console.log(`check-version: ${PACKAGES.join(', ')} and CHANGELOG.md agree on ${releases(changelog)[0]}`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()
