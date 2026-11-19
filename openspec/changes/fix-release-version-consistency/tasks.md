> Milestone clarification (25 September 2026): security remediation and Docker contributor packaging are separate from the small test release. Broader Ask/Dust investigation below remains tracked; it does not add feature development to the versioning patch. Apply feature regression gates to actual app-code differences from the chosen release baseline. The user reconfirmed all three public destinations; publication tasks below remain required.

## 1. Release-source investigation

- [x] 1.1 Confirm T-050 and inspect the original version-regression commit.
- [x] 1.2 Read the production Play package's tracks and uploaded version codes without publishing changes.
- [ ] 1.3 Verify App Store Connect uploaded-build baseline and reconcile canonical release source.

- [x] 1.4 Recover the prior Ask Keeper / Dust platform-mismatch context and compare current remote branch tips without modifying any branch.
- [ ] 1.5 Establish the historical build provenance where evidence exists; label the suspected stale Dust iOS source as unconfirmed until artifact/build records support it.
- [ ] 1.6 Prepare one reviewed integration source containing Ask Keeper, Dust Protection and intended fixes; document actual conflicts and preserve unrelated stashes/worktrees.

## 2. Release metadata and tooling

- [x] 2.1 Add an explicit manifest and source-version check/apply commands.
- [x] 2.2 Add regression tests for backwards marketing versions, reused builds, metadata drift and missing store evidence.
- [x] 2.3 Add production preflight to Fastlane and remove independent production build-number increments.
- [x] 2.4 Apply final verified version/build numbers consistently across package.json, Android and all Keeper iOS targets.
- [x] 2.5 Reject stale/wrong packaged metadata and missing feature markers before upload; verify APK signing identity and remove the iOS stale-IPA fallback. Validate markers against fresh optimized bundles for both platforms.

## 3. Native tests and artifacts

- [x] 3.1 Run automated release-tool tests and OpenSpec validation.
- [x] 3.2 Build and test local development apps on Android and iOS; record startup/settings smoke results.
- [ ] 3.3 Build the production IPA, AAB and APK from reconciled source; verify metadata, signing identities, configuration and checksums.
- [ ] 3.4 Provide and record the user's upgrade and basic app regression test checklist.

- [ ] 3.5 Verify Ask Keeper entry and Dust Protection/Report/Donate Dust on both platforms from the same candidate source; include dust coin-selection regression tests. UI-only checks do not prove backend AI responses or transaction signing.

## 4. Publication

- [ ] 4.1 Refresh store baselines and publish the verified iOS build through App Store review.
- [ ] 4.2 Publish the verified Android bundle to Play production.
- [ ] 4.3 Publish the verified APK through the established public release channel with source tag/checksums/signature as required.
- [ ] 4.4 Record actual submission/publication status separately for all three channels and archive only when all tasks are complete.
