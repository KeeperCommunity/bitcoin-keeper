# Recovery candidate validation — 29 September 2026

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
