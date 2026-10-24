# Wallet and vault signed-v3 caller ports

This additive package ports the 11 scenarios in
`tests/recovery/automaticWalletProducer.integration.cjs` to the current protected
protocol. Its review base is completed PR #7091 at
`b572b28c9cec09e47e1b9cb3b62a51369dd74c51`. The original nine-suite 295-case
lane, its public v2 fixture pin, its recorded **2 PASS / 293 FAIL**, and the
**263-obligation census** remain unchanged. Eleven candidate ports do not retire
eleven historical obligations or establish a replacement matrix result.

The new file is `tests/recovery/protectedWalletVault.proof.cjs`. It selects the
actual production wallet/BHR worker declarations and Manage Wallets deletion
predicate, and dispatches through the production origin middleware. Enrollment,
signed reads, original authority tuples, AES, encrypted native Realm, HTTP and
the transactional backend remain genuine. The original complete, intentionally
unspendable wallet/vault factory fixtures and unrelated UI action adapters remain
explicit boundaries; wallet derivation and rendered native UI are not tested.

| Case | Original obligation | Current proof witness |
| --- | --- | --- |
| 1 | Atomic two-wallet creation | Both native Realm rows exist at the actual incoming mutation boundary; one committed mutation; complete decrypted image and final tuple match; pending clears. |
| 2 | Second insertion rollback | A genuine duplicate-key failure rolls back the entire Realm transaction; zero backup HTTP; original remote revision remains. |
| 3 | Rename survives conflict | Local rename commits; a genuine competing signed CAS advances the remote revision; original caller receives real 409 without borrowing the peer tuple; local success and pending survive; consumed receipt cannot replay. |
| 4 | Wallet Hide/readback/Delete | Local callback fires while the real committed ACK is held; deletion predicate denies Delete; ACK and complete readback enable it; managed entity deletion uses Hide's acknowledged next tuple. |
| 5 | Uncertain Hide denial | Actual backend commits Hide, then its reply is lost; local/remote Hidden survives, Delete stays denied after independent read, and the original receipt cannot retry. |
| 6 | Stale factory/session | Hold original wallet factory completion; switch real account sessions A to B to A; old work cannot insert Realm records or send a mutation. |
| 7 | Stale encrypted payload | A genuine committed receipt retains its original protected base; stale presentation ciphertext is rejected before mutation HTTP, while the current local rename remains. |
| 8 | Vault Hide/Delete | Actual Hide verifies the complete image and opens the predicate; `deleteVaultWorker` removes the managed vault and confirms remote entity removal with its own next tuple. |
| 9 | Shared signer preservation | New vault linking retains existing shared-xpub registration/HMAC and remembered unspendable private fixture material; both vaults match complete readback. |
| 10 | Ordered migration success | Both local effects exist before first mutation admission; genuine intermediate reads show old vault archived before new vault appears; member2 uses ACK1's tuple; full image verifies. |
| 11 | Migration partial failure | A genuine peer CAS after ACK1 makes member2 receive real 409; original tuple is retained; archived old remote vault and both local effects survive, new remote vault is absent, pending remains, no replay. |

Wallet entity deletion uses `deleteAppImageEntity`; vault entity deletion uses
`deleteVaults`. These scenarios preserve their actual caller operations. They do
not substitute whole-namespace `deleteBackup`, claim legacy-copy erasure, or
provide the separate protected-copy tombstone/recovery acceptance.

The observational trace hook records unchanged local Realm state before the
fixture forwards an incoming mutation. A transparent generator wrapper retains
the original queue arguments and delegates to the actual queue worker, allowing
the same genuine receipt/ciphertext to be tested for consumed-receipt rejection.
Neither hook supplies a database result, receipt, ACK, verification or successful
HTTP response. Fault callbacks hold or lose actual upstream replies. Conflicts
come from real competing signed mutations rather than invented status replies.
Each case owns a fresh router and disposable data; held gates are released on
test cleanup.

## Exact environment and command

Use the existing current-source admission preload, without modifying either
historical runner or fixture pin:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedWalletVault.proof.cjs
```

Prerequisites are Node 22.23.3 or a later 22.x patch; frozen app dependencies and
patches; the actual Realm N-API binding; exact separately obtained current Relay
`29597b27eeeb299205bf7d0555db0a90c38cc4be`, clean and input-hash verified by
that preload; frozen backend mongoose 5.13.20/mongodb 3.7.4; and credential-free
disposable loopback Mongo replica on port 27038. Set
`KEEPER_PROTECTED_RELAY_CHECKOUT` and `BACKUP_TEST_MONGO_URL` only to those
disposable inputs. No private backend source belongs in this public package.

Hosted execution must use the bounded private Cloud control coordinated by the
R5 integration owner. Record exact app/backend/control commits, source checks
before and after dependency installation and proof execution, real binding and
transactional-replica checks, raw case outcomes, and all owned cleanup results.
Do not change integrity enforcement or manufacture a pass when a prerequisite
is unavailable. Only this new file needs execution; existing 32, 43+1+3 and
historical 295 results retain their original attribution.

## Validation state

- Node syntax check: PASS during preparation under Node 24.19.0 and under the
  admitted Node 22.23.3 selected by `/workspace/android-toolchain/activate.sh`.
- Whitespace check: PASS during preparation.
- Genuine 11-case execution: **NOT RUN**; requiring Realm in this isolated
  checkout fails with `MODULE_NOT_FOUND`. Node 22.23.3 is available and verified;
  hosted control/source coordination is pending for genuine Realm execution.
- iOS, Android and physical devices: **NOT RUN**. These are host caller/Realm
  proofs, with no product source change or transferred native acceptance.

The exact app head and subsequent actual execution results belong in the draft
PR handoff. No product behavior, production configuration, original tests,
shared fixture, runner, dependency pin, CI gate, deployment or release operation
is changed by this package.
