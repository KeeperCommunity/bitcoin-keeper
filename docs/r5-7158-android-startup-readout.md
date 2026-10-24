# Fixed #7158 Android startup observation readout

The Android-only run `40085793409`, attempt 1, at exact source
`3f4e8127e3698accd3760a4a039448964a5285a4` built successfully but failed the
initial **Create a passcode** assertion. Persistence, worker and product checks
did not run. The Skip-target experiment was not exercised. One generic Metro
error header, an owned foreground process and no recognized runtime fault
categories do not establish the cause.

The existing harness also retained a separate startup observer with fixed Metro
reporter events, request options, outer response status and launch-window
categories. This package reads those existing observations from one immutable
artifact; it does not rerun an app or alter the failure.

The fixed identity is run `40085793409` / job `120848340201`, workflow commit
`f83a9a8b182dd8276a732ee2b6338fb6f845640a` at `refs/pull/7158/merge`, artifact
`12557603923`, 6,451 bytes, SHA-256
`f3553f9632eff7bd25f2315c8fb0e5429132455ea0af7d5293d4e4c7cfd8fd40`.
Official source, repository, workflow, attempt, job and critical-step outcomes,
artifact name, size, digest and ownership are checked before and after decoding.
No input or environment selector can substitute another artifact.

The unchanged SHA-256-pinned 044 ZIP/privacy kernel and policy validate a narrow
projection. Only source/outcome identity, startup diagnostics, observer
scope/errors/logcat/Metro/process/foreground and capture/cleanup status can leave
the decoder. Commands, toolchains, hierarchy and unrelated observation members
are omitted. No raw log, UI text, error message, PID, source frame, artifact URL
or private credential is exported. The only added vocabulary consists of the
existing fixed `onboarding-markers` command label and two source-owned Metro
coverage keys, `row_limit_reached` and `emitter_cap_observed`. Those keys require
boolean values at exactly `startup_observation.metro`; other uses reject.

The downloaded original ZIP must contain exactly one canonical ordinary
`android/metadata.json` member. Its exclusive 0600 temporary file is removed
before any observation is logged. The fixed read-only Linux workflow uses no
native runner, provider, release environment or signing secret. The old source,
app inputs, iOS lane, private proposals and acceptance gates remain unchanged.

All output is scoped to **observations only**. An outer HTTP 200 can accompany a
multipart error; a reporter event or current process does not prove UI readiness
or identify a cause. Capped, invalid or missing rows cannot establish absence.
Original native startup remains failed and unaccepted. Native/device acceptance,
merge, signing, upload, distribution and deployment are not performed here.

Local controls use fabricated API responses and synthetic metadata only. Actual
artifact bytes and current observer rows remain unread until the coordinator
reviews this exact source and runs the isolated reader.

## Preserved failed reader and finite correction

Reader `a9c540b855e6808923e2d1b9ab35a386c15a91a8`, run `40097537355`,
attempt 1, failed closed at `DECODE_PROJECTED_METADATA`. Both source guards
passed and no observations were released. That source and failed run remain
unchanged. Source-only comparison against previously retained safe facts found
that the old vocabulary omitted the fixed `Maestro assertion failed: Create a
passcode` receipt. This is a reader admission defect; it does not establish the
cause of the Android failure or prove there are no other rejected observations.

This isolated follow-up admits that exact literal only as a direct string item
of `startup_diagnostics.maestro.testcase_failures`. The member must be a list of
at most ten strings equal to that literal, matching the producer's first-line/ten-failure bound;
alternate types, nested arrays, other paths and arbitrary text reject. The
unchanged source-generated parser is executed by the new test fixture, with its
function segment pinned to the actual Android producer by SHA-256
`4e89c67a3503e4004d013a6845433e10a03f1e62793441d6e9b99a261e18e0c1`.
Missing or empty receipts stay missing or empty and never turn startup into a
pass. The kernel, policy, original artifact identity and privacy checks remain
unchanged. The read-only workflow now selects only the isolated `-r2-` branch.
The actual observer projection has not yet been accepted; application cause is
still unknown and the Skip experiment remains unexercised.
