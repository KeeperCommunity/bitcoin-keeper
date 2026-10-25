# Private combined-candidate diagnostics

This task branch is prepared for the existing private repository
`KeeperCommunity/bitcoin-keeper-private` (repository ID `839671816`). It is based
on private combined candidate `10ea7af866e3b64ee394297cad135f51aca47a1d`.
Its intended destination is a new task-owned branch and draft PR targeting that
repository's existing `sprint`; it does not update `sprint` or any public ref.

The recorded private base is `81561499fb0150c7e7758549bb16a606eb4fca23`.
That base is an ancestor of the candidate. Its sole workflow, `build.yml`, runs
SonarCloud on `sprint` pushes and opened, synchronized or reopened PRs. This
candidate does not contain that workflow. Its deletion is part of the actual
candidate diff against the private base, so it must stay absent in the selected
PR merge tree. Do not restore its SonarCloud action or provide its scan token.

This branch also removes `rag-ingest-release.yml`, which otherwise sends
published release notes to the production Relay RAG endpoint. The removal is
limited to this task branch. No external scanner or publishing workflow is
required for development-app diagnostics. The existing CodeQL workflow remains
an independent GitHub security check; failure or unavailable private-repository
security features must be recorded honestly.

The reviewed ordinary tests, raw-source guards, native dependency patches,
Node22.23.4 floor and security/acceptance checks remain unchanged. The existing
`keeper-native-diagnostic.yml` route opts in only after a same-repository PR
receives `keeper/native-diagnostic`; it checks the exact current head and runs
the existing hosted iOS and Android development-app workers. A draft PR alone
does not opt into native jobs. Preserve noncancelling execution and retain safe
artifacts inside this private repository.

Canonical acceptance and protected release workflows remain gated separately.
Signing and store-upload workers have only `workflow_dispatch` triggers and
retain their original source, evidence, approval and environment checks. A task
branch push, PR or diagnostic label cannot select those operations. Do not
dispatch them as part of this diagnostic task.

Inspect the exact uploaded branch and PR merge tree before opting into native
jobs. Keep this source, native fixtures, results and unsigned artifacts private.
Diagnostic success supplies no protected-base, native security-matrix,
physical-device or release acceptance. The existing private-producer runtime
and canonical source-identity prerequisites remain separate. This preparation
does not change repository settings, shared workflows, credentials or release
authorization. API access to hooks and Actions settings was unavailable; no
additional integration is asserted to exist.
