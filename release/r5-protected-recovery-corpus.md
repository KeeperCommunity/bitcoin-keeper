# Retained mixed recovery corpus — current-protocol selections

This additive two-case package is based on the combined R5 checkpoint
`c8c4e22ffc0137f774e533f167ada81aa673b94a`. It adds only
`tests/recovery/protectedRecoveryCorpus.proof.cjs` and this map. Production
source, original corpus/legacy runner, shared fixture, dependency pins, token
setup and provider behavior remain unchanged. Estimated changed code/test
scope is approximately5–9k tokens, one preserved-data feature/two selections.

The source corpus is synthetic, public and unfunded. Its existing record-building
statements from `automaticRecoveryRestore.integration.cjs:66–157` are selected
unchanged between the fingerprint setup and historical `server.seed` call. The
original file at this base hashes to
`0532b00c25741b2a09d63aa86c3605c614cb8b62cb887ddb21143e27adec763f`.
Only those data-building statements and the existing `cryptoAndRecovery` setup
are evaluated; the old file's tests and public-v2 setup calls are never scheduled.
A source review added a pre-selection barrier checking every recovery collection,
VaultSigner and both history tables plus appCreated false after default tombstone
discovery, so a partial unintended write cannot be hidden by the later restore.
Completed recovery must also report restored status and original Keeper provenance.
The exact selected7016 original statement bytes additionally hash to
`852f8be219994ee9f8e0af5c2da91046f7dc11bd462cbb7d6591e2365ba80ce9`.
They execute as a host-context Node function, like the original sourceFixture;
the proof asserts both byte provenance and the host function prototype. This
preserves Realm.Mixed input constructor identity without JSON conversion,
rewriting records, dropping fields or replacing database/crypto results.
The new proof uses the unchanged current protected server/client fixture and the
actual recovery saga, BIP39/BIP32/BIP85/AES, ESM authority, native encrypted Realm,
Redux observers, signed HTTP router and transactional Relay storage.

## Selections and obligations

| Selection | Real boundary | Required preservation/read-only result |
| --- | --- | --- |
| Protected default | A distinct source provisions the complete controlled packet through actual explicit current-protocol enrollment/repair. A fresh blank encrypted native Realm invokes ordinary getAppImageWorker without an older-copy selection. An available older copy is retained concurrently. | Actual signed default discovery restores all records with protected namespace provenance. No older read, enrollment, mutation, temporary or final consent grant, current verification or write intent. All remote collections remain unchanged. |
| Explicit older after tombstone | The controlled source uses its original committed delete receipt and real signed deleteBackup. Default discovery must report protected-deleted while target Realm stays empty. Only the subsequent confirmed legacy-older selection may invoke the existing real older-copy handler. | Exactly one older read after explicit choice; full restore and truthful legacyMayPredateDeletion provenance. Original protected namespace/tombstone/generation/authEpoch, older records and provider-account records remain unchanged. No repair/recreation, enrollment, upload, consent grant or implicit fallback. |

Source provisioning is fixture setup and is explicitly outside the measured
read-only recovery trace. Its consent, authority and module/store instance are
never copied to the target. Both cases open the target as a separate empty
production-schema Realm using the real encryption key. After recovery, wrong-key
opening must fail and correct-key reopening must retain the complete corpus.
This proves the Node Realm binding and durable encrypted host file, not mobile
UI, native MMKV or historical disk migration.

The mixed corpus obligations are:

- Four wallet records: DEFAULT Testnet BTC, IMPORTED Mainnet BTC, and existing
  DEFAULT/IMPORTED USDT. Both BTC network/type/visibility/presentation records
  remain intact, including address counters9/4/12 and13/6/15. The retained
  outpoint's doNotSpend/isManualOverride choice must survive.
- Both complete USDT records must match, including their fixed public disposable
  private-key vectors, addresses, hidden metadata, cached transaction/history,
  account status, fees and nonce. Static TronWeb address derivation/validation
  is local; no creation/import hook, token chain, transfer, GasFree or provider
  operation runs. General image comparison omits caches, so full-record checks
  are required and add meaningful coverage.
- Two vaults, active and archived, retain schemes, xpub/counter state, shared
  native VaultSigner identity and both registration/HMAC receipts. Every field
  of the cold signer and production-derived Recovery Key survives. The original
  BTC corpus has null private keys/mnemonics; this proof does not establish
  populated hot-BTC private-key recovery.
- The one label and both network-specific node configurations remain intact.
  The actual recovery producer selects only the first restored node locally;
  that transient isConnected change is expected and is asserted separately.
  No node connection or synchronization worker runs.
- Original Keeper ID, public fingerprint, seed and mnemonic survive. Protected
  namespace stays distinct from Keeper identity. Recovery intentionally assigns
  its normal current installed version, SEED backup method and reconstructed
  subscription; the proof does not claim preservation of source billing
  entitlements or that it ran applyUpgradeSequence.

Sensitive comparisons use in-memory boolean equality, so failed comparisons do
not dump fixture keys, namespaces, ciphertext or raw stored documents into TAP.
No source/target image, private value, hierarchy, screenshot or raw request body
is retained as an artifact. The only external resources are owned loopback HTTP,
owned disposable Mongo and owned encrypted temporary Realm files; existing
fixture cleanup closes/drops only those resources. Provider traps must remain
unused. Source/selection failures remain failures rather than manufactured
successes or implicit fallbacks.

## Relation to existing evidence

The 43-case protected proof already covers small BTC/Recovery-Key protected
restore, tombstone suppression and explicit older selection. This package does
not count those properties again as new protocol parity; it extends the two
source selections to the full retained mixed corpus. Private native #171 uses a
small production-derived public vector through ordinary UI and native Realm.
This host corpus is not a replacement or a pass for that native scenario.
Original295 results (**2 PASS /293 FAIL**), the residual census and all other
producer checks retain their original source/run attribution.

## Exact execution and current validation

Use the existing current admission preload before importing the protected
fixture; its historical admission otherwise intentionally selects another pin:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedRecoveryCorpus.proof.cjs
```

Prerequisites are Node22.23.3, frozen app dependencies/patches and actual Realm
N-API binding, exact clean separately obtained Relay
`29597b27eeeb299205bf7d0555db0a90c38cc4be` and its frozen drivers, credential-free
loopback replica keeperQA on port27038, and current backend/source hash admission.
Set KEEPER_PROTECTED_RELAY_CHECKOUT and BACKUP_TEST_MONGO_URL only to those
approved disposable inputs. Backend source never belongs in this public branch.

Preparation validation: Node22 syntax and whitespace PASS. Initial genuine
invocation: **0 PASS /1 file-load FAIL**, MODULE_NOT_FOUND for the missing real
Realm N-API binding, before either case could execute. The two genuine cases
remained **NOT RUN** at that local prerequisite boundary. Preserve that prerequisite failure; no alternate Realm,
source guard bypass or synthetic result is permitted.

The first genuine hosted run [39853116136](https://github.com/KeeperCommunity/bitcoin-keeper-relay/actions/runs/39853116136),
at public92bef/private4d8989/runtime29597, completed **0 PASS /2 FAIL /0 skipped /
0 cancelled**. Both cases failed before source provisioning/recovery, while
building the original USDT fixture: the new proof's VM-context literal
accountStatus.fees reached the real Mixed setter, which rejected its foreign
Object constructor. Existing3 guards, actual Realm N-API, all5 source checks,
owned Mongo PRIMARY startup and confirmed removal passed. These failures remain
retained. The narrow correction compiles only the exact original public builder
statements using their original host constructors and adds byte/prototype
assertions; no product/fixture algorithm or corpus assertion is changed.
Corrected genuine selections remain **NOT RUN** pending a newly admitted exact
public/control checkpoint; the failed run cannot grant them a pass.

The separately reviewed finite private Cloud control should inherit the reviewed
`625f945c48f857925399424a8601285e2682c9a8` policy once cleared, retain all raw
app/backend/control Git-byte checks and an exact two-file delta/hash map, and use
its uniquely labeled owned Mongo helper with fail-closed collision/removal and
fake-Docker fault controls. Public source review/commit must precede public push
and draft creation; private execution control has its own review before push.
No native marker or mobile build is part of this host-proof package.

**iOS, Android, physical devices, actual historic installations and release
readiness: NOT RUN / NOT ESTABLISHED.** Passing these two future host cases
cannot transfer acceptance to a later combined SHA, retire the complete old
matrix, assign unknown5.2, enable paused token features or authorize a merge,
shared-branch promotion, signing, deployment, upload or publication.
