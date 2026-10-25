# Protected caller coverage reconciliation

The public automatic-backup workflow still pairs current signed-v3 app code with
the public Relay `838049e537e07eb646a2a0393eb969fba43d0739` v2 fixture.
Its recorded result of 2 passes and 293 failures remains unresolved. This change
leaves that workflow, fixture pin, runner and all 295 original cases unchanged.
It does not convert a failed check into a pass.

Two additive proof files port the actual wallet-rename inspection queue and node
bootstrap caller scenarios to the existing protected fixture. They use genuine
native encrypted Realm, production workers and middleware, explicit enrollment
and repair, signed reads, original namespace/revision/generation/authEpoch tuples,
and complete decrypted image comparison. Scheduling hooks hold genuine replies;
the conflict case commits a real competing signed mutation before requiring 409.
Each case creates a fresh router, preserving its actual admission limits.

These proof files contain app tests only. The separately obtained backend stays
outside public app history. The current source guard, dependency pins, runtime
source and existing protected proof are unchanged.

| Historical suite | Cases | Additive port in this change |
| --- | ---: | --- |
| `automaticWriteRealmRelay.integration.cjs` | 213 | Remaining: broad operation, failure and persistence matrix |
| `automaticInspectionQueue.integration.cjs` | 12 | `protectedInspectionQueue.proof.cjs`: all 12 queue scenarios |
| `automaticNodeBootstrap.integration.cjs` | 20 | `protectedNodeBootstrap.proof.cjs`: all 20 bootstrap scenarios |
| `automaticWalletProducer.integration.cjs` | 11 | Remaining: wallet caller scenarios |
| `automaticLabelProducers.integration.cjs` | 9 | Remaining: label caller scenarios |
| `automaticSignerProducer.integration.cjs` | 9 | Remaining: signer caller scenarios |
| `automaticUSDTProducer.integration.cjs` | 11 | Remaining: paused-USDT caller scenarios |
| `automaticUpgradeProducer.integration.cjs` | 9 | Remaining: original upgrade caller scenarios |
| `automaticRecoveryRestore.integration.cjs` | 1 | Remaining: original recovery scenario |
| **Total** | **295** | **32 candidate ports; 263 original obligations still require mapping** |

The 263 figure subtracts candidate ports from the historical inventory. It is
not an executed test count or a claim that existing protected tests lack all of
those behaviors. A reviewed obligation mapping must determine overlap without
discarding distinct callers, schedules, faults or persistence assertions.
Historical protected evidence and later current-pair evidence retain their
original source attribution; neither is a replacement 295-case result.

Run only the new proof files with the existing current-source admission preload:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedInspectionQueue.proof.cjs \
  tests/recovery/protectedNodeBootstrap.proof.cjs
```

This requires the guard's exact separately obtained backend, its frozen
dependencies, Node 22.23.3, the actual Realm N-API binding and the credential-free
disposable loopback Mongo replica on port 27038. Missing prerequisites fail.
Do not substitute a public v2 adapter or invented successful backup responses.
The command does not rerun the existing 43-case proof or upgraded-account witness.

At preparation, both new files passed Node syntax and whitespace checks. Runtime
validation is pending. A local frozen dependency install failed the
`require-from-string` package integrity check before obtaining the actual Realm
prerequisite; no integrity check, lock or native requirement was weakened.
Record the exact tested app/backend/control revisions and actual pass, failure,
skip and cleanup outcomes when hosted validation completes.

First hosted execution of these new files at app
`b9dc036049561a8edd48f18f7492e2520ce4591c` reported **31 PASS / 1 FAIL**, zero
skips. The retry test counted only its two inspection requests, although its
intervening matched-baseline helper now also performs a genuine signed read.
The correction requires all three captured requests, identifies the helper's
undefined inspection deadline, and compares the first/retried inspection's same
finite deadline. Admission ownership, phase, three-snapshot and zero-mutation
assertions remain. The failed result is preserved; corrected runtime validation
is pending.

The public migration remains incomplete until the remaining obligations are
mapped and ported, a reviewed public/private CI boundary runs the relevant
current-source suites, and failures are dispositioned from real results.
These host proofs do not provide iOS, Android, physical-device or release
acceptance. No production, deployment, merge or personal Mac action is part of
this preparation.
