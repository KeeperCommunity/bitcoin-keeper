# Post-clearState failure observations

Frozen diagnostic source `bea6056724dd75d1db99f4ce394ba4896edd10bf`
observed an iOS `LAUNCH_APP` failure after Maestro's clear-state/reinstall,
permission-return and owned `simctl launch` invocation markers. The retained
FBS/operation flags do not identify an underlying error code or rejection cause.
The build/signature and initial installed-byte checks preceded Maestro's
clear-state replacement. They do not prove the replacement's integrity.

This continuation adds only read-only failure observations. Before simulator
cleanup, it queries the exact owned current app container, reuses the existing
strict typed bundle inventory and compares every entry and executable to the
built app. It checks the current instance with `codesign --verify --deep
--strict`, observes ad-hoc identity, and compares complete typed effective
entitlements to the unchanged simulator signing policy. It also counts internal
links without exporting their targets. No bundle transformation is accepted as
equivalent. The existing container admission policy is extracted unchanged and
used by both the original acceptance comparison and this observer.

The final container path and inventory must still match the inspected instance,
and the built artifact must still match the recorded input. A changed container,
inventory or built artifact discards conclusions. Missing, rejected, unsupported,
timed-out and unavailable inputs remain explicit unknown/query states. A
nonzero signature command means `NOT_VERIFIED`, not a diagnosed signing cause.
All tool output stays in unnamed private files with bounded reads and 20-second
query deadlines; the files close on success and failure. Paths, identifiers,
PIDs, plist values, signature text and error messages are not exported.

The existing bound command reader additionally projects up to eight distinct
domain/integer pairs from exact simctl top/underlying error headers in a recorded
failed owned `LAUNCH_APP`. Only the reviewed Apple/OS domain vocabulary and
signed 32-bit integer codes leave the runner. Descriptions are discarded;
unsupported domains, syntax, conflicting shapes or overflow supply `UNKNOWN`
without partial pairs. These codes are observations, not interpreted causes.

Pinned Maestro's Java copy algorithm does not preserve symlink identity in all
cases. Whether this actual app contained affected links, whether its replacement
changed, and why launch was rejected remain unknown until measured. This source
does not change signing, app code, the startup flow or timeouts; it performs no
retry or extra launch. The original failed smoke remains failed even if every
new observation succeeds or the observer itself fails. Initial installed-byte
metadata is not promoted or overwritten by this collector.

Host-side controls use real temporary trees and fake read-only tools. Native
execution on this continuation is **NOT RUN**. The coordinator owns candidate
selection and the next isolated cloud-native window. No protected-base trust,
physical-device result, signing/distribution permission or release authority is
provided by these diagnostics.

## Optional iOS-only diagnostic scheduling

The additional `keeper/ios-diagnostic-only` label is a scheduling modifier for
`Keeper native candidate diagnostics`. On its own it schedules nothing. With
`keeper/native-diagnostic`, it retains the normal iOS diagnostic and skips only
that workflow's Android job. Without the modifier, iOS then Android remains the
default, including Android's existing `always()` behavior after iOS failure.
The separate driver-preflight label keeps its existing meaning. The table below
covers combinations without the Android-only modifier; see
[Android-only scheduling](ANDROID-SKIP-LABEL-DIAGNOSTIC.md#explicit-android-only-scheduling)
for that modifier and fail-closed conflicting selections.

| Labels | Driver preflight | iOS app diagnostic | Android app diagnostic |
| --- | --- | --- | --- |
| None | No | No | No |
| `keeper/ios-diagnostic-only` | No | No | No |
| `keeper/native-diagnostic` | No | Yes | Yes, after iOS |
| Native diagnostic + iOS-only modifier | No | Yes | Skipped |
| `keeper/ios-driver-preflight` | Yes | No | No |
| Driver preflight + iOS-only modifier | Yes | No | No |
| Native diagnostic + driver preflight | No | Yes | Yes, after iOS |
| All three labels | No | Yes | Skipped |

The same-repository/current-head/source checks, R4 exclusion, read-only
permissions, installed-byte/privacy controls and noncancelling serialization
remain unchanged. This option does not grant diagnostic source authority or
trusted acceptance, alter canonical/full acceptance workflows, waive Android
requirements, or transfer any pass from another source. A skipped Android job is
reported as skipped. The coordinator must still verify no overlapping job on the selected platform
and select exact reviewed source before adding any execution label. Under the
user's parallel-work instruction, separate immutable iOS-only and Android-only
sources may run on separate cloud VMs; evidence stays source-specific and
passes are never combined. No labels or native execution are performed by this
preparation.
