# P1B1: private C2 raw receipt validation

This separately reviewable source package extends P1A `694a0f46902cff3c8e2750b7471b9fcf641f9c78`.
Its full dependency ancestry includes the bounded ZIP reader `4d9aefbcc` and
reviewed strict JSON leaf `80ea656cc4adbdd41eac3e140a6c71728eab08bc`.
Its pure validator is based on the authoritative private C2 producer checkpoint
`d434fc69fecb804bf34c4929c1dd6dbab35ef94d` (private draft #186), preserving
all producer ancestors. It performs no Actions, network, Git, filesystem,
process, database or native operation. Its host fixtures are synthetic contract
controls; none is a native result. The public contract includes no provider
endpoint, account secret or raw private app data.

## Fixed input boundary

`private_integration_receipts.cjs` exports `validatePrivateIntegration(rawFiles,
expected)`, `privateIntegrationMembers(platform)` and the fixed eighteen
`RECOVERY_SOURCES` paths. `rawFiles` must contain exactly ten selected-platform
original Buffer members: integration metadata/startup, protected/recovery/account
metadata and final fixture pairs, owned Mongo metadata, and final app metadata.
There is no parsed-object or payload-selected manifest fallback. Every raw hash
uses its original bytes, including whitespace. Fixed per-kind size bounds retain
the producer's startup, worker and fixture reader boundaries. The aggregate's
separate 128 KiB bound accommodates its seven repeated source/build proofs and
actual runner paths; it is not limited to one worker's 32 KiB receipt size.

The independent expected descriptor contains `platform`; `app` and `control`
objects with `repository`, `sha`, `tree`; `backend` with `repository`, `sha`;
`execution` with `repository`, `workflowPath`, `workflowSha`, `ref`, `runId`,
`runAttempt`; and the eighteen independently committed `recoverySources` tuples
`{path, sha256}` in their original order. The execution repository and workflow
SHA identify the actual controller, distinct from the app identity. Expected
identities must come from authenticated readback and committed inputs. The
payload cannot select or supply its own expected identity or source map.
Every original member passes the shared strict JSON parser before composition.
Contradictory duplicate decoded keys, malformed UTF-8, a BOM, overflow, trailing
content and excessive nesting fail before any parsed value supplies facts.

## Checks and limits

The validator checks the exact source/app/controller trees, backend, workflow,
run and attempt; successful build/startup; matching typed installed-byte proofs;
unchanged built executable/APK; three complete raw source guard outputs; and all
seven ordered barriers. Each barrier retains the complete initial source proofs,
same build, exact overlay/listener absence observations, and precisely the prior
immutable receipt hashes. Suite process exit zero, started execution, post-suite
barrier and explicit successful cleanup are mandatory. Missing cleanup is never
credited. The separate owned Mongo receipt must match this run/attempt, platform
runtime kind, pinned version and cleanup disposition. Its macOS vendor-checksum
limitation stays explicit. Authenticated success of the actual workflow cleanup
step remains an ingestion prerequisite; a JSON field cannot replace it.

All fifteen protected, nine fresh recovery and twenty-six account stages must
remain ordered and complete. Each metadata snapshot must match its final fixture
with only `ready` and `cleanup` removed. Successful protocol observations,
independent committed crypto source tuples, distinct recovery/account owners,
read-only recovery/account counts, native UI case counts and same installed
artifact are checked. The protected fixture retains controlled legacy consent
and its narrow retention canary; no all-copy privacy claim is introduced.
Its five explicit fresh-status response gates must all be released, with snapshot
counts also covering the separate repair and Delete acknowledgement readbacks.
The full-stage counter cannot claim success with only one fresh response.
Rejected unrelated route observations remain bounded observations rather than
a newly imposed zero requirement. Physical devices, biometrics, authentic
historical installation, B backend mutation and full-product performance remain
explicitly untested by C2. iOS built bundle-tree and installed inventory digests
use different algorithms and are never equated.

Raw source fingerprints are observations from the three guards, required to agree
throughout all barriers. They are retained with repository/commit/tree identities;
this pure consumer does not pretend to independently reconstruct build overlays
or establish their Actions origin. Original artifact/ZIP, latest run/attempt,
reviewed workflow/source and successful job/step provenance belong to the separate
authenticated ingestion package.

Only copied fixed identities, typed byte proof, original-file hashes and source
fingerprint observations leave this validator. The result is frozen, reports
`public_parent_composition: NOT_FROZEN`, installed trust `UNVERIFIED`, and release
readiness, authorization eligibility, execution permission and authorization
`false`. It emits no parent cases or positive canonical attestation. Parent-five
composition waits for the separately frozen D public-phase proof contract and
independent origin ingestion. No route installation, credential/protection setup,
default promotion, native scheduling or release operation is performed.

## Verification

The host corpus copies the producer's complete fixed schemas and stages, with
explicitly synthetic identities, counters and typed native proofs. Controls
mutate original raw members and correctly rehash complete malicious protocol
corpora, so valid outer hashes do not excuse altered stages, source tuples,
owners, counters, cleanup or bytes. A separate read-only comparison executes the
actual protected metadata function, checks all three producer metadata literals,
and validates synthetic recovery/account shapes through their actual complete
admission functions. These checks require no database or native operation.

The initial twenty correctly rehashed duplicate-key controls failed under the
provisional ordinary JSON parser, confirming that raw-byte integrity alone did
not resolve ambiguous JSON. That failed attempt is retained. Strict parsing is
now shared with the independently reviewed canonical and trusted-origin raw
artifact boundaries rather than reimplemented in this consumer.

The first frozen `bc87184385158b962fc8ff79993f6b8977aa5622` checkpoint is also
preserved. A final source comparison found that its protected gate lower bound
accepted an impossible full-stage one-gate counter after correct hash rebinding.
The descendant derives exactly five gates and at least seven snapshots from the
actual producer's gated stages plus separate repair/Delete readbacks, uses an
eight-snapshot synthetic corpus, and rejects one/four/six gates or insufficient
snapshots. This is a host proof correction, with no native/product pass inferred.

Exact committed checks, independent review, parser dependency and source-clean
receipts are recorded at the frozen checkpoint before publication. Existing
failures, producer refs and all untested acceptance remain preserved. No personal
Mac is required.
