# R5 disposable protected-protocol acceptance — 22 October 2026

This receipt covers the actual source and commands below. It does not establish
native app acceptance, the original phone's backup state, or release readiness.
No production endpoint, account, configuration, credential or deployment was
used or changed.

## Exact source and pairing

- App AES source for the local backend suite:
  `c1c4b803039b61b940373c4dc9d08473cf25e042`, the completed
  [5.1 package](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7067).
  It contains R5 core `77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238` and released
  R4 `1d8a86a7462d935cbd0e28b857934b5718c152fc` by verified ancestry.
- Hosted app integration source:
  `e4245b01af4f48d3812f8e2abcae8bcfe65ae06a` from mobile draft #7068.
  Verified ancestry includes the completed 5.1 source above. This is an interim
  integration checkpoint; 5.2 identity/completion remains unverified and this is
  not a final candidate freeze.
- Relay: `29597b27eeeb299205bf7d0555db0a90c38cc4be`, verified against the
  current PR158 head and its [latest owner receipt](https://github.com/KeeperCommunity/bitcoin-keeper-relay/pull/158#issuecomment-6321195858).
  The PR description's earlier `7693ce4b` is stale. The current source includes
  the driver-3 collection-readiness correction. All twelve inputs pinned by
  `scripts/run-protected-upgrade-regression.cjs` match this clean checkout.
- Public SigningServer source remains
  `130d74b5336c40901933d4882db745f0cca811f1`. Its merged source work and the
  unmerged lock-only PR6 (`df9485e9945cdf0bdc231c70329d8905125d42ff`) are distinct
  from deployed service identity. The protected-backup fixture does not invoke
  SigningServer; these results do not attest that service's hosted runtime.

The historical `run-protected-backup-genuine.cjs` pin remains unchanged. Its
`7693ce4b` source result must not be relabeled as a current-source pass.

## Actual environment and checks

Node `22.23.3`, Yarn `1.22.22`, frozen Relay dependencies, TypeScript `5.4.2`,
Mongoose `5.13.20`, and native Mongo driver `3.7.4` were used. MongoDB `7.0.16`
runs in a disposable `keeperQA` replica set, published only at
`127.0.0.1:27038`, with no credentials. The image is pinned to
`mongo@sha256:c630c59342c1493d50345136df2af14a76b9e827dd5316bfabee07a0880a5f3a`.
Provider and full-server bootstrap imports are blocked by the fixture.

The backend fixture verifies the exact app AES source hash. Its pure AES
entry points use the app-declared `crypto-js@4.2.0`, installed in an independent
non-secret tool directory while the full app dependency install proceeds.
This is backend/crypto interoperability evidence, not a native app run.

| Check | Actual result |
| --- | --- |
| Current Relay protected/legacy/readiness suite | **52/52 PASS**, zero failures/skips/cancellations, 19.239 seconds: 39 protected, 6 retained-legacy-read, 7 readiness |
| Current Relay TypeScript `--noEmit` | **PASS**, exit 0, no diagnostics |
| Existing app protected-runner guard tests | **3/3 PASS**, zero failures/skips |
| First backend attempt before AES dependency was available | **13 PASS / 39 hook failures**, retained; missing `crypto-js` prevented protected test bodies from running |
| Current app full protected-v3 proof | **Hosted PASS: 43/43**, 65.869 seconds, on exact app `e4245b01` / Relay `29597b27` pair; zero failures/skips/cancellations/todo |
| Current app 5.1 upgraded-account witness | **Hosted PASS: 1/1**, 8.840 seconds, on the same exact pair; zero failures/skips/cancellations/todo |
| Existing runner guards in that hosted job | **PASS: 3/3**, 85ms; zero failures/skips/cancellations/todo |
| Same app proofs on this managed worker | **BLOCKED locally**: actual normal N-API install exits 1 with proxy CONNECT 403; the successful hosted route supplies the genuine binding |

The successful backend suite exercises real signed HTTP, native signature
verification and transactional Mongo state: enrollment; read-only absence;
all seven mutation operations; full encrypted readback; account/namespace
isolation and tamper denial; original CAS/generation/epoch constraints;
concurrent and lost-acknowledgement cases; rollback; protected-only deletion,
tombstone and explicit recreation; retained legacy recovery reads and hard
legacy-writer fences. Readiness tests reject missing/wrong runtime identity.

Commands, run in the exact Relay checkout:

```sh
yarn install --frozen-lockfile --non-interactive --ignore-scripts
npm ci --ignore-scripts --prefix tests/proof-tools
NODE_PATH=/absolute/path/to/crypto-js-tools/node_modules \
KEEPER_APP_SOURCE=/absolute/path/to/exact-app \
BACKUP_TEST_MONGO_URL=mongodb://127.0.0.1:27038 \
node --test tests/protectedBackup.test.cjs \
  tests/legacyBackupReadOnly.test.cjs tests/protectedBackupReadiness.test.cjs
node node_modules/typescript/bin/tsc --noEmit
```

Successful suite log SHA-256:
`2e377eb9b0f7339726b7bf1a650aad5f0a0ce87a28210f63073e3adbd9776bde`.
Initial environment-failure log SHA-256:
`07712049121a93035385af19e06d0a2cbf82c45f93262a583e13295f3c72f258`.
App runner-guard log SHA-256:
`abefd85be29e45f5adcca8ccdd53e74850d03cadca19ea32bdd38f88046c361f`.
The raw logs remain in the Cloud workspace; private backend source is not copied
into this repository.

## Verified hosted route

After the full frozen app install and six patches completed in Cloud, the normal
Realm prerequisite install was attempted with Node 22.23.3:

```sh
cd node_modules/realm
../.bin/prebuild-install --runtime napi --target 6
```

It exited 1 with `tunneling socket could not be established, statusCode=403`.
No policy bypass or mock substitute was used. The separate private fixed-pair
hosted package [Relay PR160](https://github.com/KeeperCommunity/bitcoin-keeper-relay/pull/160)
uses the existing PR159 route. Its exact control source
`4db6a758a307111137ad6bb4f35a32fa15b17a9d` ran
[Actions39732797761](https://github.com/KeeperCommunity/bitcoin-keeper-relay/actions/runs/39732797761),
job `119671456169`, successfully against the fixed full app and Relay SHAs above.
Frozen installs, all six app patches, actual Realm N-API binding installation,
three exact-source verifications and owned disposable Mongo cleanup passed.
Private fixture source remains in the private repository; no artifact or status
upload, production secret, deployment or publication occurs in this workflow.

The runner was Ubuntu `24.04.5`, image `20261012.334.1`, runner `2.338.0`.
Tests used verified Node `22.23.3`. GitHub warned that the pinned checkout and
setup-node actions declare Node20 and forced their action runtime to Node24;
this did not change the verified test runtime. Any action-pin update needs its
own review. The decoded job log is retained in Cloud; its materialized file
SHA-256 is `05f1f154bc0b4ff11bd60c0c4527dbf32810c89f2a55f7d9cc76ad6dbbe799b7`.

The first hosted attempt
[39732600913](https://github.com/KeeperCommunity/bitcoin-keeper-relay/actions/runs/39732600913)
failed before dependencies/tests: the new control-cleanliness check returned128
because the sparse control checkout omitted unchanged ignore metadata. The
follow-up retains `.gitignore` and adds bounded Git failure categories. No
source guard was relaxed. The unrelated uploader was prevented from starting
for this CI-only branch; its two runs were skipped, and no active job was
canceled. Nine actual local verifier outcomes passed, including rejection of
an unexpected committed runtime path anywhere since the fixed control base.

The 43-case proof covers genuine encrypted Realm, production authority,
account/session isolation, queue and mutation receipts, all seven operations,
complete readback, recovery and retained legacy selection, tombstone/recreation,
CAS conflicts, delayed/lost acknowledgements and native-state interruptions.
The additional 5.1 witness cold-rehydrates legacy saved consent, verifies
never-enrolled read/delete behavior, loses an enrollment response, explicitly
repairs, disables backup, deletes only the protected copy and explicitly
recreates it while preserving local and legacy recovery contents.

## Remaining acceptance

These host integration proofs are not native iOS/Android feature acceptance or
original-phone confirmation. Preserve the public-v2 matrix's inherited
2 PASS / 293 FAIL separately; no test or historical pin was weakened to obtain
these results. Rerun the fixed-pair job on the eventual combined candidate,
including verified 5.2 work when available. The passes above cover only the
reported exact app source. Hosted iOS/Android feature acceptance, genuine
physical-device results, independent security review and release approval
remain separate requirements.
