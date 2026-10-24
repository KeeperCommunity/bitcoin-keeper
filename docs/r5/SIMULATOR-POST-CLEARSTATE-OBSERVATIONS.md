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
equivalent. The canonical initial-install acceptance policy remains unchanged.
The observer reuses its owned-device/container/realpath checks with the exact
producer-admitted basename described below; actual inventories always use the
original built app and the queried installed app.

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

## Timestamped replacement name

The frozen `7c00dc22937f94111298350a767466354f239ba9` iOS-only run
`40084560886/attempt1`, job `120844708599`, failed at `LAUNCH_APP` and
returned `UNKNOWN / INSTALLED_CONTAINER_POLICY` from the post-failure observer.
No replacement byte, signature or entitlement result was obtained. Its sole
parsed code pair, `FBSOpenApplicationServiceErrorDomain / 1`, does not establish
the underlying launch-denial cause.

This exposed a diagnostic admission mismatch. Pinned Maestro 2.11
[`LocalSimulatorUtils.kt:260`](https://github.com/mobile-dev-inc/Maestro/blob/c8c361be1cc89b2e742f185466a302a22778be6b/maestro-ios-driver/src/main/kotlin/util/LocalSimulatorUtils.kt#L260)
copies the replacement to `$bundleId-${System.currentTimeMillis()}.app` before
installing it. The original observer required the built app's basename and
therefore rejected the producer's timestamped replacement before measuring it.

The failure-only observer now admits the original basename or the fixed owned
app ID followed by exactly 13 ASCII millisecond digits and `.app`, and requires
the pinned `cli-2.11.0` producer for the latter. It retains the same owned device,
container UUID, namespace and resolved-path checks. Foreign IDs, unsupported
producer versions, other names, symlink escapes and late path/inventory changes
remain unknown. This changes no canonical acceptance caller, normalizes no
bundle content, performs no repair and supplies no app-cause or native pass.

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
The separate driver-preflight label keeps its existing meaning.

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
reported as skipped. The coordinator must still verify a fresh globally idle
native window and select exact reviewed source before adding any execution
label. No labels or native execution are performed by this preparation.
