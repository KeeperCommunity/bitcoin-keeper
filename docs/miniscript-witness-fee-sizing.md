# Miniscript witness fee sizing: bounded CodeQL correction

## Source and alert evidence

The investigation starts at R5 PR #7082, commit
`3eb92fc8a622a3e09926d49f47243c163e32d009`. Its operations module is blob
`db29ee432496e84bc70be82b0d9a3017e154888d`. The fee-input helper is byte-identical
in `sprint` at `def0d6a90c80287edb4f58ae272cbfc340f00d73` (module blob
`7401a3ffcc234cb948f282f27fd36976176020a7`). This separate PR targets `sprint`
with only the correction and regression evidence; it does not integrate R5.

[Security check 119985857101](https://github.com/KeeperCommunity/bitcoin-keeper/runs/119985857101)
reports one High finding at `operations/index.ts:110–111`: **Incomplete
multi-character sanitization**, with the message that the string may still
contain `<script`. The annotation has no alert number or dataflow details.
Both the alerts API and analyses API returned HTTP 403, `Resource not accessible
by integration`. No inaccessible alert details or source-to-sink path are claimed.

The [#7082 analysis run](https://github.com/KeeperCommunity/bitcoin-keeper/actions/runs/39824740985)
completed successfully on PR merge `e3758088d08c9b2e4710eac4d3ae38ad22568b78`;
that execution result is separate from the failed security check. A newer
[same-head #7068 run](https://github.com/KeeperCommunity/bitcoin-keeper/actions/runs/39830650673)
used merge `4c161666a4bf88478abc62b47f941de0bd54d2ce`. Both merge the same R5
head into the same `sprint` base. Both had no downloadable workflow artifacts.

The logs identify CodeQL 2.27.2 / JavaScript queries 2.4.7. The
[matching query source](https://github.com/github/codeql/blob/codeql-cli/v2.27.2/javascript/ql/src/Security/CWE-116/IncompleteMultiCharacterSanitization.ql)
declares `@kind problem`, security severity 7.8, and ID
`js/incomplete-multi-character-sanitization`. It detects a destructive replacement
pattern; an HTML sink is not a prerequisite. Tracing this string into numeric
fee sizing therefore does not clear the finding.

## Recovery and independent behavior evidence

No accessible successor to the earlier uncommitted candidate was recovered from
342 fetched origin refs, 51 distinct operations-module blobs, relevant all-ref
history, recent PRs/searches, or the inspected CodeQL artifacts. This bounded
search cannot exclude inaccessible or unpushed work. The historical 140 + 104
comparisons do not validate this correction.

Fresh prepatch characterization used `@bitcoinerlab/miniscript@1.4.0`, with the
tarball integrity checked against `yarn.lock`: 78 sane policies and 927 generated
non-malleable witnesses across thresholds 1 through 6, initial timelocks,
inheritance and emergency paths. Old and proposed selector counts and the
existing complete input-size formula agreed for every generated witness.
Durable tests additionally execute the actual production helper and fee callers
against frozen R5 baseline results; the fixture records their provenance.

With repository dependencies installed, reproduce the immutable baseline without
rewriting fixtures, then exercise the checked-out source:

```sh
git fetch origin 3eb92fc8a622a3e09926d49f47243c163e32d009
node tests/services/miniscriptFeeSizingBaseline.cjs
npm test -- --runInBand --runTestsByPath tests/services/miniscriptFeeSizing.test.js --coverage=false
```

The verifier checks the original operations blob, compiler/witness digests, 927
input allowances and 120 complete financial API-result digests. Explicit and
default input cases use the same eligible funds; they cover both dispatch paths,
not different coin-selection pools. Hand-calculated anchors provide additional
checks independent of the frozen results.

The pinned satisfier emits space-separated signature placeholders, public-key
placeholders and literal `0` / `1` elements. Timelocks are metadata. Keeper's key
identifiers can contain nested multipath suffixes such as `K1<0;1>`, `IK1<2;3>`
and `EK1<0;1>`, but no spaces. In the old code, placeholder stripping consumed
through the first `>` and the following replacement removed residual `)` / `>`.
For these generated witnesses, the only remaining nonempty tokens were exactly
the literal selectors. Counting those complete tokens directly gives the same
result without constructing a partially stripped string.

Only this count changes. Signature/public-key counts, script compilation and
sizing, the two-byte allowance per literal, rounding, the existing 1-of-4-or-more
key-count fallback, and other wallet script branches retain their existing logic.

Malformed or unsupported tokens intentionally differ: `<x>0`, `0<x>`, `((0))`,
`10`, `01` and nested HTML-like text are not literal witness elements. They no
longer contribute to the selector count. This is not a general witness parser,
an HTML sanitizer, or a change to signing/finalization validation. The equivalence
claim is bounded to the pinned generated witness grammar.

## Remaining acceptance

Record current-head test and CodeQL execution/security outcomes on the separate
PR. Analysis execution success alone is insufficient. API permission failures,
other findings and inherited R5 failures remain unresolved unless independently
verified. This correction does not establish full wallet security, native
acceptance, R5 integration or release readiness. Hosted iOS/Android fee-flow
checks remain required for the eventual combined candidate.
