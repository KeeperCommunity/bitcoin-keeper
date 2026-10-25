# Android startup diagnosis without exporting app data

At exact R5 source `3eb92fc8a622a3e09926d49f47243c163e32d009`, run 39824790868
attempt 1 built and installed the Android development APK and verified its actual
installed bytes. The initial **Create a passcode** assertion failed before any
credentials were created. Its metadata has one hierarchy snapshot with no known
startup/redbox signals, generic `METRO_ERROR`, and no recognized Android errors.
These observations establish neither the cause nor a clean runtime.

Normal and lazy Metro bundles and Hermes compilation subsequently passed in the
coordinator's Linux/Node 22 investigation. Those checks are not Android startup
acceptance. Resolver changes, app fixes and timeout increases are unsupported by
the available evidence. Resource pressure is an investigative lead only.

This isolated package adds a metadata-only collector at the existing Android
startup-failure hook. The cause remains `UNDETERMINED`; original build/smoke and
acceptance outcomes are unchanged. There is no new workflow, native scheduling,
app behavior, dependency, Metro worker, timeout or gate change. The separately
active iOS diagnostic [#7094](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7094)
and native retry are preserved. Its bounded 3eb92→ffb213 comparison has no
`hosted_native.py` overlap. Vault UI producer #7097 is unchanged.

The new receipt records:

- Process inventory counts and `PRESENT`/`ABSENT` only from a complete successful
  parse; failed/timed-out/truncated/malformed lookups stay `UNKNOWN`.
- Resumed-activity relation `OWN_APP`, `OTHER_APP`, `NONE` or `UNKNOWN`. This is
  activity metadata, not proof of actual window visibility or UI readiness.
- App-scoped Android exit-history reason enums, with freshness explicitly
  unknown. The parser matches [Android 15's ApplicationExitInfo.dump format](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/core/java/android/app/ApplicationExitInfo.java).
- Fixed JS/native fault categories and known exception types from error records
  matching currently owned process IDs. Historical logcat freshness is unknown;
  PID matching does not prove the process instance or current failure cause.
  Unknown types/tags/messages are never exported; unclassified and unparsed
  record counts remain visible. Failed log queries retain `UNKNOWN`.
- Metro error contexts, known fault/type markers and bounded read coverage.
  Source codeframes and stack paths are excluded. Bundle markers do not imply
  success, and an error marker does not by itself identify a cause.
- Numeric host memory/swap availability and cgroup current/max/OOM counters.
  Missing, failed or malformed reads stay unknown; `max` is explicitly unlimited.
  Snapshots and historical counters do not prove a current OOM/kill event.

No process ID, package/activity text, exception message, path, user data, raw log,
hierarchy, screenshot or secret leaves the new collector. Four read-only adb
queries are limited to 15 seconds each; each parser reads at most a 256KiB prefix
and 256KiB tail, reporting omitted data and parse coverage. New command files are
unlinked immediately and their private directory is removed in `finally`.
Existing Metro/Maestro and legacy Android-error logs retain the established
parent-runner private cleanup boundary; they are never uploaded.

Cloud checks: 105 Python contracts PASS, including 13 new Android controls;
four existing native-diagnostic policy tests PASS with observed Node 24.19.0;
Python syntax and whitespace PASS. Independent review found no remaining
confirmed blocker after source-frame and malformed-record corrections.

Host tests use synthetic subprocesses and adversarial private sentinels. They
cover unknown lookups, truncation, process attribution, source-frame exclusion,
memory values, private disposal and preservation of the failed smoke result.
**Native collection NOT RUN.** Only a new exact-candidate hosted run can produce
actual Android metadata. No passes transfer from source 3eb92 or another SHA.
