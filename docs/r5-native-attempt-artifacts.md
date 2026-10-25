# Preserve native metadata across retries

This narrowly scoped follow-up to candidate `3eb92fc8a622a3e09926d49f47243c163e32d009`
changes only the reusable platform worker's metadata artifact name. It does not
change native execution, scheduling, dependency inputs, timeouts, trust or gates.
The current native run and all producer branches/artifacts remain untouched.
This is a new source SHA; prior native results cannot transfer to it.

The previous name contained route, platform and source only. Run39824790868
already retained iOS artifact12446402968 and Android artifact12448718229 with
those names. A same-source rerun of that run can attempt the same immutable
artifact name. Do not delete or overwrite earlier failure evidence to make a
retry upload work. The future worker now names each artifact:

```text
keeper-<diagnostic|release>-native-<IOS|ANDROID>-<source_sha>-<run_id>-<run_attempt>
```

Retention remains metadata-only,7days, `if:always()` and `overwrite` unset.
Existing artifacts keep their original names. This source correction cannot
change an already running attempt or repair a missing/colliding upload in it.
The actual upload outcome must be recorded separately; a collision is not
assumed to have occurred merely because the old source could collide.

## Reading and reporting evidence

For this worker's future artifact, select the exact full name including run and
attempt, verify the original artifact API record's run/source association and
digest, then require matching metadata `source_sha`, `run_id`, `run_attempt` and
workflow identity. Reject an earlier-attempt payload even when its source is
unchanged. Record actual stage results; an artifact name, successful upload or
rerun does not establish native acceptance.

The existing `release_evidence.cjs` and local validation gate consume original
Actions jobs for the latest exact run/current attempt rather than artifact names.
Their checks remain unchanged and reject stale jobs, failed/skipped/pending work
and diagnostic workflow identity. Canonical artifacts are already attempt-scoped
and remain unchanged. The separate #7094 driver-only diagnostic and the #7070
producer are not rewritten or folded into this package.

Preserve the actual failed iOS result from original run39824790868. The separate
#7094 diagnosis at `ffb2131e4e4478e6befc93c9124941fcff4abb31`, run39832536511,
also failed driver readiness and retained artifact12450545303. Its runner lookup
timed out (exit124): `runner_installed:false` is therefore an UNKNOWN lookup
outcome, not proof of absence. A permission category/newer runner SDK remains an
investigative lead. No Keeper build/smoke/features ran in that diagnosis. This
package neither changes those outcomes nor claims their cause was established.

## Verification limits

Offline controls render the actual workflow name across routes/platforms/sources/
runs/attempts, detect same-source retry collisions and forbid overwrite. A fake
recording control verifies that metadata retains its actual run/attempt and all
native/signing stages remain NOT RUN. Existing current-attempt provenance tests
remain in the suite. These are naming/source contracts, not a hosted retry or
native feature test. No workflow is dispatched, active work interrupted, artifact
deleted, signing performed or release authorized by preparing this patch.
