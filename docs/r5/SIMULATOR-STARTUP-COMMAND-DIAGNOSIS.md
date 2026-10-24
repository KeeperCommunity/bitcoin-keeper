# Failure-only simulator startup observations

The frozen #7149 source `d27007078808617a97ee460b592eefb44e7e5325`
built, verified its simulator signature and effective entitlements, and verified
the installed bundle bytes. Its startup testcase returned `ERROR` in native
run `40065599904`, attempt 1, iOS job `120788067210`. The #7152 readout passed
but retained no failed-command label, no owned app error record, and no Metro
request in the app window. The startup cause and Keychain correction acceptance
remain unknown. Existing driver connection markers also occurred in an older
run that reached the app, so those markers alone do not establish this cause.

This continuation changes only failure diagnostics. It retains the existing
startup flow, source and installed-byte checks, simulator-only signing, and
native acceptance criteria. It does not change app code or perform another
launch. The original startup result remains failed when observations succeed.

On startup failure, the harness projects the bounded private Maestro
`commands.json` for the exact `Disposable startup and passcode input` flow.
Only a sequence number, fixed command kind, recorded status, and fixed error
marker vocabulary leave the runner. Unknown command names become `OTHER`;
raw selectors, exception messages, stacks, paths and hierarchy are not exported.
Missing, conflicting, malformed or oversized input becomes `UNKNOWN` without
partial command rows. The existing private JSON and path admission kernel is
reused unchanged.

Pinned Maestro 2.11 source at
[`c8c361be1cc89b2e742f185466a302a22778be6b`](https://github.com/mobile-dev-inc/Maestro/tree/c8c361be1cc89b2e742f185466a302a22778be6b)
records clear-state, permission setup and launch as one `launchAppCommand`.
Its `DeviceConnectionException` path can bypass normal command failure handling
and leave the last row `RUNNING`. That status is retained as an observation;
it is not converted to a completed command, a failure cause or app acceptance.
Additional fixed log flags distinguish the observed clear-state/reinstall and
permission markers and the exact owned UUID/app `simctl launch` invocation.
Maestro's “reinstalled and launched” log text follows reinstall and does not
establish launch success. Missing markers do not establish that a stage did not
run, especially when bounded log collection was truncated.

A separate read-only query runs `simctl spawn <owned UUID> launchctl list`
after the startup failure, with a 15-second timeout. Its unnamed private output
file closes on every path. The projection admits at most one exact owned
`UIKitApplication` service label and exports only a fixed running/nonrunning
entry state and count; it never exports the PID, service identifier or output.
No matching entry is reported as `NO_OWNED_ENTRY_OBSERVED`, which does not prove
the app never launched, is absent, or was absent at the original failure.
Unsupported output, nonzero exit, timeout and malformed input remain unknown.

Host-side parser, privacy, binding and cleanup controls are automated. Actual
simulator execution on this continuation has not run. A later coordinator-owned
cloud native campaign must record its exact source; no result transfers from
the failed frozen source or from these offline controls. This work provides no
release signing, installed trust, physical-device or release authority.
