#!/usr/bin/env python3
"""Cross-boundary contract checks: what one layer produces, another must consume.

The per-language dead-code tools (knip, vulture) answer "is this symbol
referenced?". These checks answer a different question at the seams none of
them can see across:

  env      Environment variables the CDK stack sets on Lambda functions versus
           the names Lambda code actually reads. A variable set and never read
           is dead configuration; a variable read with no fallback and never
           set is a cold-start failure waiting for a deploy.

  types    Members of the dashboard's response/domain types (web/src/types)
           that no non-test dashboard code ever reads. A field the backend
           emits and the type declares but nothing consumes is a payload
           nobody looks at.

Usage:
    scripts/check-contracts.py            # both checks; exit 1 on any failure
    scripts/check-contracts.py env        # one check
    scripts/check-contracts.py types

Exit status 1 when a gated finding exists. Informational findings (optional
env reads with defaults that CDK does not set; type members no Lambda emits as
a literal) are printed but never fail the run — they need a human's judgement.

Scope and limits, so nobody over-trusts the output:
  * env is a whole-stack comparison, not per function: a variable set on one
    Lambda and read only by another's code passes. Reads through f-strings
    (``os.environ.get(f"BEDROCK_TIER_{role.value.upper()}")``) are expanded
    against the StrEnum values declared in Lambda code, so they name exactly
    the variables the runtime can read.
  * types matches member names as whole words anywhere in non-test dashboard
    source (declaration lines excluded), so a name that also occurs as an
    unrelated identifier is a false negative, never a false positive. Dynamic
    access (``row[key]``) is invisible; allowlist such members with a reason.
"""

from __future__ import annotations

import ast
import re
import sys
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LAMBDA = REPO / 'lambda'
LIB = REPO / 'lib'
WEB_SRC = REPO / 'web' / 'src'
WEB_TYPES = WEB_SRC / 'types'

# Vendored code and build artifacts under lambda/ that are never ours.
LAMBDA_EXCLUDED_PARTS = frozenset({'python', '.deps', '__pycache__', 'testing', 'node_modules'})

# --- allowlists -------------------------------------------------------------
# Every entry needs a reason a reviewer can check. Keep them short-lived.

# CDK sets these, no Lambda reads them.
ENV_SET_BUT_UNREAD_ALLOWED: dict[str, str] = {}
# Lambda requires these, CDK does not set them.
ENV_REQUIRED_BUT_UNSET_ALLOWED: dict[str, str] = {}
# Prefixes the Lambda runtime itself provides.
RUNTIME_PROVIDED_PREFIXES = ('AWS_', 'LAMBDA_', '_HANDLER')
# Lambda-side helpers whose first argument names a variable read with a default.
OPTIONAL_READ_WRAPPERS = frozenset({'_integer_env'})

# Type members nothing in web/src reads by name.
TYPE_MEMBER_UNREAD_ALLOWED: dict[str, str] = {}


# --- env: CDK side ------------------------------------------------------------

_CDK_KEY = re.compile(r"^\s+'?([A-Z][A-Z0-9_]+)'?\s*:", re.MULTILINE)
_CDK_ADD_ENV = re.compile(r"addEnvironment\(\s*'([A-Z][A-Z0-9_]+)'")


def cdk_env_keys() -> dict[str, list[str]]:
    """Every UPPER_CASE key the stack files declare, with the files declaring it."""
    keys: dict[str, list[str]] = {}
    for path in sorted(LIB.rglob('*.ts')):
        if path.name.endswith(('.spec.ts', '-fixtures.ts')):
            continue
        text = path.read_text(encoding='utf-8')
        for match in (*_CDK_KEY.finditer(text), *_CDK_ADD_ENV.finditer(text)):
            keys.setdefault(match.group(1), []).append(str(path.relative_to(REPO)))
    return keys


# --- env: Lambda side ---------------------------------------------------------

@dataclass
class EnvReads:
    """What Lambda production code reads from the environment."""

    # name -> files; `required` reads have no fallback and raise when unset.
    required: dict[str, set[str]] = field(default_factory=dict)
    optional: dict[str, set[str]] = field(default_factory=dict)
    # Groups where at least one member must be set (resolve_table_env legacy chains).
    required_any_of: list[tuple[tuple[str, ...], str]] = field(default_factory=list)
    # f-string reads, as (literal prefix, file); expanded against enum members
    # so `os.environ.get(f"BEDROCK_TIER_{role.value.upper()}")` means exactly
    # the six BEDROCK_TIER_<ROLE> names, not "anything starting with BEDROCK_TIER_".
    templated: list[tuple[str, str]] = field(default_factory=list)
    enum_values: set[str] = field(default_factory=set)

    def names(self) -> set[str]:
        names = set(self.required) | set(self.optional)
        for group, _file in self.required_any_of:
            names.update(group)
        for prefix, _file in self.templated:
            names.update(prefix + value.upper() for value in self.enum_values)
        return names

    def is_read(self, key: str) -> bool:
        return key in self.names()


def lambda_production_files() -> Iterator[Path]:
    for path in sorted(LAMBDA.rglob('*.py')):
        if LAMBDA_EXCLUDED_PARTS.intersection(path.relative_to(LAMBDA).parts):
            continue
        if path.name.startswith('test_') or path.name == 'conftest.py':
            continue
        yield path


def _is_environ(node: ast.AST) -> bool:
    """``os.environ`` as an attribute chain."""
    return isinstance(node, ast.Attribute) and node.attr == 'environ' and isinstance(node.value, ast.Name) and node.value.id == 'os'


def _is_environ_get(func: ast.AST) -> bool:
    """``os.environ.get``."""
    return isinstance(func, ast.Attribute) and func.attr == 'get' and _is_environ(func.value)


def _is_os_getenv(func: ast.AST) -> bool:
    """``os.getenv``."""
    return isinstance(func, ast.Attribute) and func.attr == 'getenv' and isinstance(func.value, ast.Name) and func.value.id == 'os'


def _string_prefix(node: ast.AST) -> str | None:
    """A constant string, or the literal prefix of an f-string before its first placeholder."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr) and node.values and isinstance(node.values[0], ast.Constant):
        return str(node.values[0].value)
    return None


class _EnvVisitor(ast.NodeVisitor):
    def __init__(self, reads: EnvReads, file: str) -> None:
        self.reads = reads
        self.file = file

    def _record(self, node: ast.AST, *, required: bool) -> None:
        name = _string_prefix(node)
        if name is None:
            return
        if isinstance(node, ast.JoinedStr):
            self.reads.templated.append((name, self.file))
            return
        bucket = self.reads.required if required else self.reads.optional
        bucket.setdefault(name, set()).add(self.file)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        """Collect the string values of every StrEnum so templated reads can be expanded."""
        if any(isinstance(base, ast.Name) and base.id == 'StrEnum' for base in node.bases):
            for statement in node.body:
                value = getattr(statement, 'value', None)
                if isinstance(statement, ast.Assign) and isinstance(value, ast.Constant) and isinstance(value.value, str):
                    self.reads.enum_values.add(value.value)
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        if _is_environ(node.value):
            self._record(node.slice, required=True)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if _is_environ_get(func) or _is_os_getenv(func):
            if node.args:
                self._record(node.args[0], required=False)
        elif isinstance(func, ast.Name) and func.id == 'resolve_table_env':
            self._record_table_env(node)
        elif isinstance(func, ast.Name) and func.id in OPTIONAL_READ_WRAPPERS and node.args:
            # Validating wrappers such as `_integer_env('NAME', default, minimum=...)`
            # fall back to their default, so the variable is an optional read.
            self._record(node.args[0], required=False)
        self.generic_visit(node)

    def _record_table_env(self, node: ast.Call) -> None:
        names = tuple(n for n in (_string_prefix(arg) for arg in node.args) if n)
        if not names:
            return
        keywords = {kw.arg: kw.value for kw in node.keywords}
        required_kw = keywords.get('required')
        optional = isinstance(required_kw, ast.Constant) and required_kw.value is False
        if optional:
            for name in names:
                self.reads.optional.setdefault(name, set()).add(self.file)
        else:
            self.reads.required_any_of.append((names, self.file))


def lambda_env_reads() -> EnvReads:
    reads = EnvReads()
    for path in lambda_production_files():
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        _EnvVisitor(reads, str(path.relative_to(REPO))).visit(tree)
    return reads


def check_env() -> int:
    failures = 0
    cdk = cdk_env_keys()
    reads = lambda_env_reads()

    print('== env: set by CDK, read by no Lambda')
    for key in sorted(cdk):
        if reads.is_read(key):
            continue
        if key in ENV_SET_BUT_UNREAD_ALLOWED:
            print(f'   allowed  {key}: {ENV_SET_BUT_UNREAD_ALLOWED[key]}')
            continue
        failures += 1
        print(f'   FAIL     {key}  (declared in {", ".join(sorted(set(cdk[key])))})')

    print('== env: required by a Lambda, set by no CDK function')
    for name, files in sorted(reads.required.items()):
        if name in cdk or name.startswith(RUNTIME_PROVIDED_PREFIXES):
            continue
        if name in ENV_REQUIRED_BUT_UNSET_ALLOWED:
            print(f'   allowed  {name}: {ENV_REQUIRED_BUT_UNSET_ALLOWED[name]}')
            continue
        failures += 1
        print(f'   FAIL     {name}  (read in {", ".join(sorted(files))})')
    for group, file in reads.required_any_of:
        if not any(name in cdk for name in group):
            failures += 1
            print(f'   FAIL     one of {"/".join(group)} must be set  (read in {file})')

    print('== env: optional reads (have a default) that CDK never sets — informational')
    for name, files in sorted(reads.optional.items()):
        if name in cdk or name.startswith(RUNTIME_PROVIDED_PREFIXES):
            continue
        print(f'   info     {name}  (read in {", ".join(sorted(files))})')
    return failures


# --- types --------------------------------------------------------------------

_MEMBER = re.compile(r'^\s+(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:', re.MULTILINE)
_BLOCK_START = re.compile(r'^\s*(?:export\s+)?(?:interface\s+\w+|type\s+\w+\s*=)\b.*\{\s*$', re.MULTILINE)


def type_members() -> dict[str, set[str]]:
    """Member name -> files declaring it, for every interface/type block under web/src/types."""
    members: dict[str, set[str]] = {}
    for path in sorted(WEB_TYPES.rglob('*.ts')):
        if path.name.endswith('.spec.ts'):
            continue
        text = path.read_text(encoding='utf-8')
        for block in _type_blocks(text):
            for match in _MEMBER.finditer(block):
                members.setdefault(match.group(1), set()).add(str(path.relative_to(REPO)))
    return members


def _type_blocks(text: str) -> Iterator[str]:
    """The brace-balanced body of each interface / object-type declaration."""
    for start in _BLOCK_START.finditer(text):
        depth = 0
        for index in range(start.end() - 1, len(text)):
            if text[index] == '{':
                depth += 1
            elif text[index] == '}':
                depth -= 1
                if depth == 0:
                    yield text[start.end():index]
                    break


def _consumer_sources(root: Path) -> Iterable[str]:
    """Non-test dashboard source; under web/src/types only the member declaration lines are removed.

    The decoders that live beside the type declarations are real readers
    (``isStringArray(value.removed)``), and an object literal elsewhere such as
    ``{ extract_brands: true }`` is the dashboard *producing* a field the
    backend consumes — both must count as uses, so only the declarations are
    stripped, and only where declarations live.
    """
    for path in sorted(root.rglob('*.ts*')):
        if '.spec.' in path.name or path.name.endswith(('-fixtures.ts', '-fixtures.tsx', 'Fixtures.ts', 'Fixtures.tsx')):
            continue
        if 'test' in path.relative_to(root).parts:
            continue
        text = path.read_text(encoding='utf-8')
        yield _MEMBER.sub('', text) if WEB_TYPES in path.parents else text


def check_types() -> int:
    failures = 0
    members = type_members()
    # Everything non-test in web/src consumes; see _consumer_sources for what is stripped.
    dashboard = '\n'.join(_consumer_sources(WEB_SRC))
    lambda_source = '\n'.join(path.read_text(encoding='utf-8') for path in lambda_production_files())

    print(f'== types: {len(members)} distinct members declared under web/src/types')
    print('== types: declared, read by no non-test dashboard code')
    unread = sorted(name for name in members if not re.search(rf'\b{re.escape(name)}\b', dashboard))
    for name in unread:
        if name in TYPE_MEMBER_UNREAD_ALLOWED:
            print(f'   allowed  {name}: {TYPE_MEMBER_UNREAD_ALLOWED[name]}')
            continue
        failures += 1
        print(f'   FAIL     {name}  (declared in {", ".join(sorted(members[name]))})')

    print('== types: read by the dashboard, never emitted as a literal by any Lambda — informational')
    unemitted = sorted(
        name for name in members
        if name not in unread and not re.search(rf"['\"]{re.escape(name)}['\"]", lambda_source)
    )
    print(f'   {len(unemitted)} candidates (UI-only fields, DynamoDB pass-through rows and camelCase view models are expected here):')
    print('   ' + ', '.join(unemitted))
    return failures


CHECKS = {'env': check_env, 'types': check_types}


def main(argv: list[str]) -> int:
    selected = argv or list(CHECKS)
    unknown = [name for name in selected if name not in CHECKS]
    if unknown:
        print(f'unknown check(s): {", ".join(unknown)}; choose from {", ".join(CHECKS)}', file=sys.stderr)
        return 2
    failures = sum(CHECKS[name]() for name in selected)
    if failures:
        print(f'\n{failures} contract failure(s). Fix the producer or the consumer; allowlist only with a reason.')
        return 1
    print('\nContracts hold.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
