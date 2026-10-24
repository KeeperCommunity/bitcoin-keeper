# Protected cloud worker core — Phase B2

This separate core package extends #7072's preparation. It supplies executable future authorization/platform adapters and offline contracts; **no worker workflow entry point or upload Fastfile is installed by this core package alone**. The separate Phase B3 package supplies that orchestration/uploader layer. No signed build, signing credential operation, release workflow dispatch, upload or provider API call was performed while preparing either package.

The trusted driver requires installed canonical source for signing, protected exact source/version/build evidence, fresh exact-owner receipts, pinned certificate/config/artifact identities and post-environment revalidation. Only exact current-run/current-attempt worker checks are excluded to prevent self-deadlock; unrelated failed/pending/security/native checks remain blocking. Native setup admits only a source/hash-bound nodeify mapping overlay, including staged-change protection. Platform adapters verify signatures and metadata, use transient credentials and fail before a success receipt if iOS keychain/profile cleanup fails. Upload producer lineage, payload digest, ZIP traversal/duplicate/symlink rejection and separate operation receipts are included in the contracts.

Actual operation remains **NOT EXECUTED / NOT VERIFIED**. Prerequisites include approved protected environment enforcement/custody, independent security/Claude review, complete exact-canonical native evidence, compatible reviewed frozen native/Ruby inputs, and the separate orchestration layer. Current inherited CocoaPods/xcodeproj locks are explicitly rejected before credentials; no lock regeneration or credential provisioning occurred. A normal PR merge creates a new source SHA: PR-head native passes must never be transferred to canonical source. A separately reviewed exact-canonical attestation route is required before signing can become operational.

The adapters intentionally fail closed if the Phase B3 standalone uploader/installed Phase A helper is absent. They never fall back to legacy dev/live/auto-certificate lanes or to the personal Mac. `protected-release-plan.cjs` remains preparation-only when invoked directly; actual future execution requires the separate protected worker driver. Production configuration/signing/upload material must never be supplied to host tests.

Validation commands (synthetic/fake actions only):

```sh
node --test scripts/protected-release-plan.test.cjs scripts/protected-release-worker.test.cjs
python3 -B -m unittest discover -s scripts -p 'test_cloud_release_worker.py'
```
