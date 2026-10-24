# Failed product sample observation

Stage B merges completed #7116 checkpoint
`1bc34890cb8618b2fffd446a63924974e0fe15b5` into the separately frozen Stage A
`ba8c6958b214920a56c06ee78db8c87a40ebf237` by ancestry.
[Producer patch](https://github.com/KeeperCommunity/bitcoin-keeper/compare/76d1c949d91c5d885fc002f689a9ec321c16eafb...1bc34890cb8618b2fffd446a63924974e0fe15b5)
and [original draft #7116](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7116)
retain their original source/check attribution. Stage A's single pure compact-log
classifier, canonical fixed fields and cleanup remain unchanged.

This preparation adds observation only. It changes no application code,
dependencies, Maestro flow, selector, deadline, Metro configuration or lifecycle,
and adds no native query, capture process, retry or validation window.

Run `39846002094`, attempt `1`, source
`23f14e01f3437c213f1443c3167d96022f3a43bc` completed naturally. Android build,
startup smoke, persistence probe, five production-worker scenarios, exact source
receipts and installed APK bytes passed. Full-product sample 1 failed after the
host acknowledged the Skip command, before `start_new_visible`. That optional
marker prefix alone does not identify the failed Maestro command or an app
defect. Samples 2–5, full-product Retry/key-PIN checks and physical checks did not
run. The new reader has not run on a native host, and cannot add evidence to that
older source. Its cause remains undetermined.

Artifact 12458149136 has API/upload/download ZIP SHA256
`4d464ef5f8faa7de4f02292e683f0dad8242544843610da9371f2c675dc183f0`.
The only raw full-product duration was startup-to-passcode 21652.183ms; worker
helper timings do not satisfy the five full-product samples. Installed APK bytes
passed before and after the completed probes and before the failed product
sample; its post-product comparison did not run.

The product coordinator calls `product_failure_diagnosis.py` on failure, before
removing that sample's private output. Observer/import failures yield UNKNOWN
and retain the original exception. Existing sample and outer cleanup still run;
raw JUnit, hierarchy, screenshots, app output and Metro logs remain private and
are removed by the existing cleanup. The Android post-failure four-command
collector is unchanged and retains its separate unknown-freshness scope.

The reader exports three separate observations:

- JUnit: only the pinned Maestro 2.11 XML-text failure format from the expected
  single flow/test case, with status ERROR. A complete first line must equal a
  fixed known assertion/element selector message. Other messages disclose only
  ERROR_RECORDED or UNKNOWN. Failure attributes, custom labels, suffix matches,
  unknown flow files, multiple failures and malformed XML cannot identify a
  selector. No missing PIN marker is converted into a failed command.
- Hierarchy: fixed public IDs and strings for Skip, Start New, recovery/settings,
  welcome/passcode/credential Retry, LogBox and notification permission controls.
  This is explicitly ANY_RETAINED_SNAPSHOT, never the final post-Skip screen or
  proof of current visibility, route, app ownership or tap delivery. Paired
  LogBox/notification controls must occur within one snapshot. Allow/Don't Allow
  alone does not establish a permission dialog. Modern LogBox resource IDs are
  not treated as reliable iOS accessibility IDs.
- Product Metro: immediately before the original Maestro command, bind the
  original owned Popen object, product phase, event count, regular log file
  device/inode and EOF offset. On failure, require the same ownership, phase,
  event and file identity; inspect only newly appended complete lines. Earlier
  warmup and sample bytes are excluded. An exited owned Metro can still supply
  its bound log; its numeric exit status is an observation, not cause proof.

JUnit/hierarchy reads are limited to 1 MiB per file, eight snapshots, 10,000 nodes
per snapshot and depth 128. Oversized, duplicate-key, malformed, invalid-shape or
symlink inputs cannot establish absent UI. Partial coverage keeps unseen flags
null; true flags describe positive observations in a valid retained snapshot.
False flags describe only complete scanned snapshots. No arbitrary hierarchy
attribute, error text, URL, query string, filename or device text is exported.

Metro reads at most the latest 256 KiB appended within the bound window, trims
partial starting/ending lines, and discloses byte counts, truncation, partial
boundaries and growth during reading. Missing, replaced, shrunk or differently
owned logs remain UNKNOWN. Records use LF boundaries, optional CRLF endings and
strict UTF-8; unsupported controls or invalid encoding increase fixed rejected
record counts and cannot establish an error category. Fixed console error categories do not establish
request success, bundle completion, runtime readiness, app health or root cause.

Format evidence is in pinned Maestro `cli-2.11.0` sources, commit
`c8c361be1cc89b2e742f185466a302a22778be6b`:
`JUnitTestSuiteReporter.kt` writes `Failure.message` as XML text;
`TestSuiteInteractor.kt` uses the flow exception message;
`Orchestra.kt`, `Condition.kt` and `ElementSelector.kt` define the exact assertion
and element-selector descriptions. `ArtifactsGenerator.kt` serializes the root
`TreeNode`; the writer omits empty fields. App IDs/public text are defined by
`OnBoardingSlides.tsx`, `NewKeeperAppScreen.tsx` and English localization.
React Native 0.83.9 LogBox sources define its public footer/header strings;
Maestro's `PermissionButtonFinder.swift` supplies the notification prompt phrase.

Host tests cover exact/negative formats, privacy sentinels, malformed/falsey and
duplicate fields, bounded/partial coverage, Metro source/window binding, and
preservation of the original failure plus purge when observation and cleanup
throw. The producer recorded152 Node/246 Python offline controls on its source.
Those counts are preserved at that producer; they are not passes for this
combined Stage B. Fresh exact-commit combined Node/Python, privacy/lifecycle
and workflow checks are recorded in its separate handoff before publication.
These controls provide no native acceptance and select no additional window.
The producer's existing native work is preserved and must finish naturally;
its results remain scoped to that producer SHA. No producer ref/label/job is
changed by this reconciliation.
