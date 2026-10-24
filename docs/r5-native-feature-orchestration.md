# R5 scoped native companion orchestration

This integration package preserves the complete producer ancestry for credential
PR #7088 (`dd5fca6707308e3d2a1e3fe664c7fa424455b258`), Version History
(`b8abebb2001ac506eafb560d4ac8980eee8a6858`) and Vault PR #7097
(`b6cb88c0b78e97988ead30f2e40ee4d8e6ef9341`). It does not rewrite their
branches or claim their native acceptance. The original five healthy timings
and separate setup-disconnect Retry fixture retain their existing vocabulary.

The same exact build, owned device and disposable account run key/PIN,
credential, history, then Vault companions. Credential/history require the
original one-wallet account, so Vault runs last and may leave three visible
wallets. Each receipt retains its own scope. The overall R5 release matrix,
OS/hardware credential faults, genuine historical upgrades, protected-backup
native protocol and physical checks remain separate. This package supplies no
new native PASS.

`product_metro.py` selects only fixed committed configurations. Ordinary product
uses the normal Metro configuration and `index.js`; it receives no credential
fixture environment variable. The runner checks ordinary Metro before and after
each companion. A runner-owned harness permits switches only after an exact
allowlisted Maestro invocation on the owned device produces matching successful
JUnit, with a reviewed final `stopApp`. Failed/stale/different reports do not
grant a switch. Reports and diagnostic directories must remain under the private
suite directory, including a recheck after Maestro returns.

The manager rejects an existing listener on8081 rather than adopting or killing
it. It records every newly spawned session/process handle before readiness or
warmup. Switching terminates and waits for only those owned groups; timeout
escalates to kill and another wait. Final cleanup visits all owned handles even
after failed startup, then disposes the device, reverse mappings and private
diagnostics. Metadata/cleanup errors cannot replace an earlier UI failure, and
cleanup failure cannot supply an overall PASS. No shared cache is removed.
Warmups are phase-specific setup evidence, separate from first-wallet timing.

Independent review found that the inherited key/credential/history finalizers
saved metadata before cleanup, allowing a save error to mask the original UI
failure and skip owned server/output disposal. Vault also replaced a primary
failure when server cleanup raised. The integration-only follow-up uses one
shared finalizer: every shutdown, close and private-output purge is attempted
independently; fixed cleanup failures mark the receipt FAIL; final metadata is
written after disposal with one bounded FAIL-save retry. An original exception
remains primary. Initial receipt saves are also inside the cleanup boundary.
The original producer checkpoints remain unchanged. Failure-injection controls
run each actual companion with fake UI adapters, including combined UI/save/
server/purge failures, cleanup after successful UI and initial-save failure.

Receipt/control ports are distinct: setup backend8765, key8766,
credential8767, private protocol control8768, Vault8769. This integration-only
Vault port correction avoids rebind/TIME_WAIT interaction while preserving its
producer checkpoint. No native binary is uploaded or distributed between phases.

## Runtime budget

The standard `macos-15` and `ubuntu-24.04` jobs now have a global240-minute
ceiling, replacing105/90 minutes. Source/build count, runner size, gates,
per-command failure bounds and exact-source checks are unchanged. Platforms stay
sequential and each builds once. No native job was dispatched by this package.

The existing3eb Android diagnostic reported about26.8 minutes compiling plus
about5 minutes preparing dependencies. That is a planning observation for a
different candidate, not an acceptance result for this source. New companion
timings have not been measured. Allow roughly100–150 minutes per platform as an
initial planning range for build/dependencies, initial probes, five product
samples, key/PIN, credential, twelve history phases, their Metro warmups and Vault.
iOS compilation and all new UI estimates remain uncertain until actual execution.

The configured Maestro command ceilings alone sum to178 minutes: six initial
flows60, key12, credential16, history60, Vault30. Slow Metro startup/warmup or
dependency installation can add more than the remaining62 minutes. Therefore the
global240-minute cap does not promise that every command can consume its own
maximum serially. It bounds cost/hangs; a job hitting it is incomplete/failed,
never acceptance. Preserve partial receipts and review actual timings before any
further timeout change. No larger or paid runner, duplicate companion build,
binary transfer or acceptance waiver is introduced.

## Verification

Nine new offline controls exercise owned process cleanup, failed replacement
startup, listener rejection, strict phase/environment selection, private fresh
JUnit binding, primary-failure preservation, companion order and port isolation.
Their fake adapters supply no native acceptance. Full native-harness contracts
passed locally after the cleanup correction:124 Node and125 Python; actionlint
on all three involved native workflows and whitespace also pass. Native iOS and Android for this combined
package are **NOT RUN**. The coordinator reviews this package before any isolated
branch push or exact-candidate scheduling.
