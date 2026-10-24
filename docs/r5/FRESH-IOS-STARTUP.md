# First launch on a fresh iOS simulator

This source proposal starts from frozen dependency-diagnostic commit
`18329359f8e7e56a03dfd28834c114102e245ded`. The active dependency-only run
and its source are unchanged. Native execution on this proposal is **NOT RUN**.

The initial iOS startup harness already creates a new simulator, validates its
returned UUID, boots that exact device, installs the original built app, and
verifies the complete installed bundle before Maestro starts. It neither chooses
an existing device nor clones an earlier simulator. Cleanup shuts down and deletes
the created device. Invalid creation output is rejected before it acquires cleanup
ownership, so an alias such as `booted` cannot reach installation or disposal.

Previously the first Maestro launch also requested `clearState: true`. Pinned
Maestro 2.11 implements iOS clear-state by copying, uninstalling and reinstalling
the app. That second installation is redundant on this freshly created device and
replaces the instance whose bytes were just verified. The failure-only observer
does not turn a changed replacement into accepted original bytes.

The shared startup flow now chooses one platform-specific launch. iOS launches the
existing fresh, verified installation with `clearState: false`; Android retains
`clearState: true`. Both branches still deny all permissions. The same first-screen
wait, PIN digits, confirmation assertions, stop command and host deadlines follow.
Probe, feature and product flows, production app code, dependency inputs, signing,
workflows and canonical acceptance controls are unchanged.

The syntax is supported by the pinned producer's
[`YamlRunFlow`](https://github.com/mobile-dev-inc/Maestro/blob/c8c361be1cc89b2e742f185466a302a22778be6b/maestro-orchestra/src/main/java/maestro/orchestra/yaml/YamlRunFlow.kt),
[`YamlCondition`](https://github.com/mobile-dev-inc/Maestro/blob/c8c361be1cc89b2e742f185466a302a22778be6b/maestro-orchestra/src/main/java/maestro/orchestra/yaml/YamlCondition.kt)
and
[`YamlLaunchApp`](https://github.com/mobile-dev-inc/Maestro/blob/c8c361be1cc89b2e742f185466a302a22778be6b/maestro-orchestra/src/main/java/maestro/orchestra/yaml/YamlLaunchApp.kt).
The [iOS clear-state producer](https://github.com/mobile-dev-inc/Maestro/blob/c8c361be1cc89b2e742f185466a302a22778be6b/maestro-ios-driver/src/main/kotlin/util/LocalSimulatorUtils.kt#L260)
documents the replacement path. Possible copy/signature effects are not measured
here and are not asserted to explain the earlier launch denial.

Host controls execute the actual startup function with controlled native tool
boundaries. They check fresh UUID creation, exact-device boot/install, original
installed-byte verification before the single intended launch, unchanged launch
timeout, cleanup ownership, and rejection before UI on failed installed bytes.
These are orchestration controls, not proof of native launch or UI success.

This flow is for the owned disposable harness. It must not be used to claim a
fresh-state test on a reused simulator. Existing iOS launch failures and the
CocoaPods installation failure remain failed; this is a targeted setup correction
awaiting exact-source review and a separately selected cloud startup check.
