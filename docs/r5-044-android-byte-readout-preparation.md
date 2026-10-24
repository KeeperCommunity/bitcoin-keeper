# Fixed 044 Android metadata byte-readout preparation

This separate profile is based on the reviewed readout at
`97557ae67d86ffb4e7a5d02a633736040b16c7a7`. Existing 1bc readout scripts,
policies, workflows and controls remain unchanged. The new files do not select,
queue, retry, cancel or modify any native job, and no workflow is added here.

The known selection is PR #7131, source
`044ebb6ea2d465f6a70e9116e3feac5a604cd696`, tree
`4856035ece888230674e061c53115de3d6f025ed`, run `39873063291`, attempt `1`,
and reusable workflow `5a7b0c5da0a38197f6dd675ff424f3ba3f441d02` at
`refs/pull/7131/merge`. The run's actual API head branch is
`codex/r5-startup-credential-failure-observation-20261022`.

The Android job ID, immutable artifact ID, byte count, ZIP digest and completed
run/job/build/probe conclusions are unavailable constants. Both new scripts
reject this preparation before API or filesystem access. They accept no
environment, CLI or workflow input that can replace a selection. A coordinator
must bind the actual completed Android job, unique build/probe/upload step
outcomes, artifact API identity/digest/size and upload digest before publication
of a concrete readout. Synthetic test bindings supply no native result.

The new profile preserves the canonical one-member `android/metadata.json` ZIP
envelope, original bytes, metadata schema 1, 1 MiB payload and 64 KiB policy
limits, 512 command cap, finite public vocabulary, duplicate-key rejection,
bounded JSON walk, control-character rejection, read-only repository/run/attempt/
job/artifact/workflow checks, independent downloaded size/hash check, exclusive
0600 temporary file and deletion before log output. Unknown fields and private
strings still reject the entire artifact. No raw UI, arbitrary error message,
stack, PID, marker string, query or URL exemption is added.

The compact policy contains 1,856 finite literals: the existing reviewed Android
set plus 59 specific exported keys/enums. Its 57,562 bytes fit the unchanged
65,536-byte limit; pretty serialization would exceed that limit. Its SHA256 is
`f42cc4bacbfa28e4a69f1795384a773cba57dc6323a98cc9ac2e3dd4ec6ac3e7`.
The policy records the exact 044 source/tree, all 13 reviewed native producer
hashes and six app-boundary hashes. Historical receipt hashes remain explicitly
historical; they do not claim to describe a future 044 artifact.

Three additions have strict path and shape checks:

- `onboarding_boundary_observation` is admitted only under startup Android
  runtime facts or failed sample/Retry Android runtime facts. Its normal and
  reduced unavailable shapes contain fixed scope/freshness/coverage, five
  `true|null` stage flags, bounded counters and exact producer/consumer limits.
  The consumer can retain 64 records even though each producer process caps
  emissions at four per stage and 20 total. Missing stages remain unknown;
  guest-clock freshness is unverified.
- `diagnostic_marker_records` is a nonnegative bounded integer only under those
  runtime-error fact objects. Diagnostic markers remain separate from runtime
  fault counts.
- `failed_assertion_snapshot` is adjacent to a failed sample/Retry's unchanged
  four-field `failure_observation`. Normal and unavailable shapes contain only
  fixed assertion identity, bounded sequence/node/count/coordinates and nullable
  public Skip flags/conflicts. Its scope is
  `POST_FAILED_ASSERT_OUTCOME_NOT_TAP_TIME`; tap coordinates and visibility are
  `NOT_RECORDED`. No raw hierarchy key exemption is needed for this receipt.

These optional observations establish neither cause nor acceptance. An exact
readout must still be decoded and verified against the actual API/upload digest
locally, then independently audited with explicit source/run/attempt identities.
Physical checks remain unrun. This preparation grants no release, signing,
upload, distribution, merge or deployment approval.

```sh
node --test .github/tests/044-android-artifact-readout.test.cjs
python3 -B -m unittest discover -s .github/tests -p test_044_android_artifact_readout.py
node --test .github/tests/current-android-artifact-readout.test.cjs
python3 -B -m unittest discover -s .github/tests -p test_current_android_artifact_readout.py
```

The new controls exercise unavailable and partial bindings before I/O, exact
synthetic provenance, wrong digest/size, privacy and wrong receipt paths, bounded
normal/fallback shapes, falsey and malformed types, canonical ZIP rejection,
original byte transport and cleanup/error priority. They perform no network,
artifact download, native app operation or acceptance evaluation.
