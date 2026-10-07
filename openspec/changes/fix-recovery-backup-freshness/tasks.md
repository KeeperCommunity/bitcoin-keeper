## Implementation
- [x] Fix enabled incremental backup gate and preserve explicit subscription rejection.
- [x] Check upgraded opted-in accounts without an unsolicited replacement upload.
- [x] Implement comparison, prompt, repair stages, readback verification and manual retry.
- [x] Include both Bitcoin networks, USDT, keys, vaults, labels and nodes; protect detected server-only/conflicting data.
- [x] Persist account-specific verification and interruption state separately from transient running state.
- [x] Serialize local backup writes, coalesce repair requests and invalidate completion during mutations/account switch.
- [x] Add transport abort, stall/deadline bounds, slow status, leave-screen affordance and bounded/chunked crypto work.
- [x] Fix recovered Recovery Key confirmation and existing backup UI failure-as-success branches.

## Verification
- [x] Run targeted production-code recovery/repair/transport/state/UI feedback tests with disposable adapters.
- [x] Run the existing Recovery Key migration/status suite.
- [x] Bundle Android JavaScript and inspect baseline versus candidate TypeScript diagnostics.
- [x] Lint all new modules/screen with the missing Jest plugin supplied to the existing ESLint configuration.
- [x] Bundle iOS JavaScript.
- [x] Run native Android/iOS upgrade and clean recovery using disposable data against a working backend. Final consent follow-up is recorded separately in validation.md.
- [ ] Measure small-screen and increased-text layout, crypto frame time, memory, throughput, foreground/background and kill/restart.
- [ ] Validate deployed request-size limits and approve/tune provisional record, transfer and deadline bounds.

## Release gates
- [x] Implement and test revision-checked atomic repair on the paired relay.
- [x] Protect repaired backups from legacy full replacement, including transaction retries and unchanged-ciphertext races.
- [ ] Validate production transaction topology and relay-first deployment.
- [x] Fix same-ID label-content upserts in the paired relay candidate; verify against real MongoDB and HTTP.
- [ ] Resolve ordinary CLI lint's inherited Jest environment/plugin error.
- [ ] Review and integrate only after applicable checks pass; commit/push/release require established owner approval.
