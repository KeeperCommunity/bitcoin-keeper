> Current R4 contract: [protected backup integration](protected-backup-integration.md) supersedes the historical v2 protocol and whole-copy Delete language below. Prior checked source/fixture boxes are SHA-scoped historical evidence, not protected-v3, native, hosted or release acceptance. Delete now applies only to the new protected copy; older encrypted copies remain read-only. All-copy erasure is outside approved R4 scope, unimplemented and unscheduled.

# R4 recovery validation — current gates and historical evidence

## Current automatic-write status — 13 October 2026

Audit starting app source: `b160656218dc6065ad12af9db220c974255bfc23`. The automatic fix and disposable proof are mandatory R4 requirements; critical native iOS/Android backup acceptance also precedes release. Physical-device-only follow-up does not waive the fixture/native safety checks.

Current exact-source results live in [automatic-write-validation.md](automatic-write-validation.md), with a sanitized [October source-proof record](evidence/automatic-backup-source-proof-2026-10-13.md). Source local-first generation/session/payload proof and disposable host Realm/HTTP outcomes are now recorded; required IOS/ANDROID native backup acceptance and hosted deployment remain open. The source flag permits development loopback testing only; hosted rollout remains fenced. See [tasks](tasks.md) for evidence-backed completion and remaining gates.

The baseline automatic transport fails closed before network until end-to-end local commit/generation, originating-session/payload proof, revisioned fanout and final complete readback are implemented and proved. Earlier success of manual repair or a pre-persistence automatic writer does not establish readiness for this contract. A lost write acknowledgement leaves its originating operation pending; a content-only match is not an acknowledged write or fanout completion.

## Historical recovery candidate — 29 September 2026

The material below preserves prior recorded results and their original source/artifact boundaries. It has not been rerun in this reconciliation. References to local uncommitted source, earlier versions/counters, native completion or remaining gates describe that September candidate, not the final R4 source. In particular, older tests requiring upload before local commit are superseded by the local-first model; their logs remain unchanged as provenance.

Local, uncommitted public source at `/Users/devaccount/Workspace/keeper-recovery-t060`, based on `7fdd502702a8aa149f5a3ad87aac7a274a61e6e8`. Paired relay source at `/Users/devaccount/Workspace/keeper-recovery-relay`, based on `5551550d7ba0e84ce239a7f154f34613081c5c20`. No production deployment, commit, push or store submission has occurred. T-060 remains Now.

## Automated evidence

- 162 Node recovery tests pass against production functions and real AES with disposable storage/transport adapters. Includes wallet/key lifecycle, exact key identity, shared registration updates, USDT metadata, manual coin choices, explicit last-node deletion, strict restore, repair races, readback, failures and transport limits.
- 20 related Jest tests pass: 10 Recovery Key migration/status, 6 Version History and 4 PIN.
- 32 relay tests pass against a disposable real MongoDB replica set, including atomic repair, rollback, ownership, archive state, node replacement, old/new writer races and HTTP failure responses. TypeScript compilation passes under Node 22.
- 3 paired real HTTP tests pass using production encryption and comparison.
- Release tooling: 11 Node plus 7 Python tests pass. Existing source version consistency passes at 2.5.16 / Android 623 / iOS 616; those counters cannot be reused for a new store upload.

## Native evidence and final follow-up

Fresh Android development and iOS Debug simulator builds installed over existing disposable QA apps. Android mismatch → Back Up Now → Backup verified passed. Clean native restoration of the same encrypted backup passed on both platforms: one hot wallet, seven signer records and two vault records (active and archived). Native key cards include Mobile Key and five imported Seed Keys; the Recovery Key signer is intentionally hidden. Android retained wallet/key data on upgrade. iOS retained the wallet and showed Recovered Wallet in Version History. PIN creation, mismatch/correction and login checks passed where recorded.

An actual local database outage produced a retryable iOS recovery failure; the same Recovery Key succeeded after the database restarted. This is evidence for that failure/retry, not the full native interruption matrix.

A subsequent iOS check found that recovery's transient `seedConfirmed=true` signal could be replayed by the Recovery Key backup page and enable Assisted Server Backup. Recovery now clears this transient signal while retaining persistent confirmed Recovery Key status/history. A regression exercises recovery and the actual health-check effect; 162 tests pass. The refreshed Android QA artifact is 2.5.17-qa.3 (626), signature-verified and installed as an upgrade. Final-source clean iOS recovery passed again; opening Recovery Key retained confirmed status while Assisted Server Backup remained off. Evidence: ios-recovered-consent-preserved.log and evidence/ios-final-recovery.log.

Evidence root: `/Users/devaccount/Workspace/keeper-local-dev/now-candidate-2026-09-29`. Artifact manifests identify exact source hashes and the distinction between embedded Android JS and iOS Metro JS. Earlier APK results must not be represented as final post-follow-up binaries.

## Compatibility and recovery guarantees

Successful revisioned repair marks the backup as requiring the new full-write contract. Legacy full replacement checks that marker inside the transaction, including retries, and returns 409 after repair. Before repair it rejects omissions and preserves archive state. Incremental routes remain compatible; stale same-ID writes by older clients are not universally prevented, and the comparison must detect subsequent differences.

All recovery records are decoded and checked before persistence. Failed Realm writes and regenerated Recovery Key identity mismatches prevent success. Local Realm writes remain sequential; a failed attempt can leave partial records without completing recovery. Native interrupted-recovery acceptance remains open.

## Remaining gates

- Native large/single-large-record performance, enlarged text/accessibility, interruption/relaunch and slow-network acceptance; desktop stress results are not phone performance evidence.
- Production transaction topology, endpoint authorization/request limits and relay-first rollout.
- Final clean reviewed source, refreshed store history/counters, production signed artifacts and artifact-level upgrade/smoke checks.
- Whole-repository lint/typechecking retain inherited failures. Focused new modules were linted via the installed nested Jest plugin; no repository-wide clean pass is claimed.

No physical tester onboarding or automation programme is required by this candidate; that work is deferred separately by the owner.
