# Canonical bounded iOS startup observations

Stage A reconciles the completed [#7115](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7115)
source `eceb5551a430a0e31cff7a32d70181ee55007b69` already included in
`80199f90b3f64869d9998e0984450c1b670c87b4` with the original completed
[#7116](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7116) startup
checkpoint `76d1c949d91c5d885fc002f689a9ec321c16eafb` by ancestry.
[Original #7115 patch](https://github.com/KeeperCommunity/bitcoin-keeper/compare/c8c4e22ffc0137f774e533f167ada81aa673b94a...eceb5551a430a0e31cff7a32d70181ee55007b69)
and [original #7116 startup patch](https://github.com/KeeperCommunity/bitcoin-keeper/compare/23f14e01...76d1c949d91c5d885fc002f689a9ec321c16eafb)
retain their producing sources and receipts. Stage B preserves the frozen Stage A source and merges product-failure
observation at `1bc34890cb8618b2fffd446a63924974e0fe15b5` by ancestry; see
[its separate observation contract](product-failure-observation.md).
No original producer or main integration branch is rewritten.

## Compact-log receipt

`ios_startup_errors.py` remains the sole pure classifier. The harness delegates
to it; there is no second compact parser or legacy category alias. The canonical
`category_record_counts` keys from #7115 remain, with fixed `HERMES_ERROR` and
`ATS_BLOCKED` markers plus bounded bundle/dyld/React-fatal patterns. Counts mean
records containing text markers, not exception totals or authenticated causes.
`parse_status` is UNKNOWN, PARSED or PARTIAL; `cause` remains UNDETERMINED.

The classifier retains exact validated executable prefixes, real calendar/time
validation, strict input types, allowed compact severities/PIDs, control-character
rejection, multiline non-attribution, and limits of 1MiB input, 16KiB per record,
4096 scan lines and 4096 own-process records. Malformed, oversized, replacement
or truncated input cannot establish a complete observation. The existing
failure-only query stays restricted to the built executable on the fresh owned
simulator; its command, timeout, query outcome and private stderr separation
remain unchanged. Failed or missing queries remain UNKNOWN.

## Metro and hierarchy receipts

The normal Metro configuration, resolver, transformer, supported CLI reporter,
request/response bodies, streaming and backpressure remain intact. The existing
observer uses each request's platform and the actual development app ID. iOS
capture creates only a timestamp handle; it starts no extra native process or
service query. Android command execution and its existing receipt fields remain
unchanged.

For iOS, Metro facts disclose producer/export limits of 512 rows and a scan limit
of 1024 lines, scanned/valid/exported counts, invalid rows, input/export/scan
truncation and whether the producer limit may have been reached. Valid rows have
only allowlisted fixed fields. Future-dated rows retain UNKNOWN stage. Missing
input gives UNKNOWN coverage and no rows. Invalid rows, truncation or a possibly
reached producer cap give PARTIAL_OR_CAPPED coverage when valid rows exist.
BOUNDED_INPUT_ONLY describes the supplied input; it grants no launch-window,
HTTP multipart terminal-status, JavaScript execution or UI acceptance.

The bounded iOS hierarchy recognizes fixed Login, Welcome Back, credential-error,
Retry and modern LogBox phrases. At most eight complete private snapshots with
valid node/attribute/children containers and 10000 nodes per snapshot are parsed.
Missing, malformed, oversized, invalid-shape or excess snapshots leave UNKNOWN
with null flags. A parsed snapshot has SNAPSHOTS_PARSED state and fixed boolean
presence flags. The scope is ANY_RETAINED_SNAPSHOT_NOT_FINAL_ROUTE_OR_VISIBILITY_PROOF;
no flag establishes the final route, delivered tap or current UI visibility.
The iOS process-state receipt explicitly remains UNKNOWN because it is not queried.

## Privacy, cleanup and acceptance

Only fixed categories, bounded counts and public marker flags leave the runner.
Private log text, UI text, arbitrary attributes, paths, request bodies, credentials
and stacks are never copied into receipts. Existing cleanup attempts every owned
resource and private-file purge and preserves the original smoke failure even
when collection, receipt I/O or cleanup also fails. The startup integration
controls retain those failure/ordering assertions and unchanged UI command and
deadline arguments.

The preserved 23f native window's first iOS passcode assertion and Android's first
full-product sample failed. Android progress through Skip does not identify the
failed action or a cause. This package supplies source/host diagnostic controls
only. Its own native execution, five startup/first-wallet sample pairs, Retry,
key/PIN, physical and full backend acceptance remain NOT RUN or incomplete.
There is no selector/app fix, performance pass, trusted-gate clearance or release
readiness claim. No native opt-in, scheduling, signing or release operation is
selected here; a later combined candidate needs fresh independent review and
exact-source hosted evidence. Work-package 5.2 remains unidentified and excluded.
