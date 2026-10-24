# Exact completed Android metadata byte-readout preparation

This isolated preparation adapts the proven #7124 readout at
`2bcf2ff51176831f3b503625faa1c819c1f556e5`. It preserves original ZIP bytes and
changes none of the native source, existing iOS readout, pinned acceptance
evaluator or historical receipts. It never polls, queues, retries or cancels a
native job.

The finite selection is source `1bc34890cb8618b2fffd446a63924974e0fe15b5`, run
`39858617273`, attempt `1`, PR #7116, reusable workflow
`3c44ab6412a8118b183273c402dd08136db05b28`, and Android job `120125972406`.
The completed run and Android job both concluded `failure`. The development app
build concluded `success`, the combined startup/persistence/workers/product step
concluded `failure`, and safe evidence upload concluded `success`. These are job
and step outcomes; the artifact must be independently audited to determine which
acceptance checks actually ran and passed.

The selected immutable artifact is `12466091444`, named
`keeper-diagnostic-native-ANDROID-1bc34890cb8618b2fffd446a63924974e0fe15b5-39858617273-1`,
with ZIP size `8950` bytes and API/upload SHA256
`5c3210a6b0af7bf9ea0cddb61fd1494714e8cfac0db8385960fb6390f92aa545`.
Both scripts contain these exact finite bindings and the observed conclusion
tuple. No environment variable, dispatch input, command-line parameter or
arbitrary artifact selector can replace them. The workflow admits only a push
to `codex/r5-current-android-artifact-byte-readout-20261022` in
`KeeperCommunity/bitcoin-keeper`. Publication and selection remain coordinator
steps; offline preparation has not materialized the current ZIP.

The route keeps read-only API permissions, exact completed run/attempt/source/
repository/referenced-workflow/job/artifact checks, an exclusive0600 temporary
file, independent downloaded size/hash verification, bounded metadata-only
canonical ZIP/JSON validation and deletion before log output. It runs on hosted
macOS15 without a native worker, driver, app build, signing or evaluator process.
Only the original validated ZIP's base64 is emitted between fixed Android
markers. The coordinator must decode and verify the original digest locally,
then run the separately pinned evaluator with explicit current identities.

The public-vocabulary policy is specific to the exact reviewed Android producer
files and the historical23f Android receipt. It records source and member hashes.
Only public source strings, keyword field names, finite source-derived companion
arguments and narrowly bounded owned temporary paths are admitted. Fixed
optional failed-sample/Retry hierarchy receipts and legacy startup observation
are distinguished from raw UI trees. Arbitrary raw fields, private strings, URLs,
unknown keys and extra ZIP byte channels fail closed. Privacy also depends on
the exact reviewed producer/upload boundary and immutable artifact digest.

Offline controls admit the actual production API tuple with mocked API responses
and reject a correct-length download with the wrong digest before file creation
or logging. Fabricated ZIP controls exercise canonical/public validation and
exact-byte base64 transport. They also reject wrong identities, conclusions,
partial bindings, malformed/unsafe ZIPs, private data and cleanup/logging errors.
No test downloads the current artifact or supplies a native acceptance result.

```sh
node --test .github/tests/current-android-artifact-readout.test.cjs
python3 -B -m unittest discover -s .github/tests -p test_current_android_artifact_readout.py
/workspace/scratch/actionlint/actionlint .github/workflows/r5-current-android-artifact-readout.yml
```

The actionlint path is this preparation environment's tool location, not a
runtime dependency. Physical phones, biometrics, camera/NFC/USB and signers
remain NOT RUN. This preparation grants no release, signing, distribution,
merge or deployment approval.
