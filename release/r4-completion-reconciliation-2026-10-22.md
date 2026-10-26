# R4 / 2.6.4 completion reconciliation

Original evidence checkpoint: 22 October 2026; GitHub/publication refresh:
24 October 2026. This record distinguishes source completion,
submitted builds, deployed services and actual acceptance. It grants no merge,
deployment, signing, resubmission or public-release authority. The dated 22 October
checkpoint retains its release hold; this refresh makes no new store/publication
state claim. Existing approvals, source refs and running R5 jobs remain intact.

## Resume and publication check — 24 October 2026

The existing work is already published. Before editing, the local and remote
ledger branch `docs/r4-completion-evidence-20261022` both pointed to
`5d6ab0ab475b46948b09b276d8fe5b6318352b80`; its five exact-head checks all
passed: Tests, Lint, CodeQL, analysis execution and local-validation gate.
The worktree was clean. Desktop #103/#104, private Relay #161 and documentation
#7089/#7090 are also published with no local-only implementation to push.
This refresh uses existing [#7092](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7092),
not a duplicate PR. Historical check results remain bound to their tested heads.

### Adopt the completed submitted-R4 caller batch

[Mobile #7151](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7151),
`93489d8a8eeb5d99f85ff8aaf74fb447795a56a5`, is directly based on submitted
`1d8a86a7462d935cbd0e28b857934b5718c152fc`. Its only changes are three added
paths: two wallet/label proof files and their coverage map. Existing runtime,
native, dependency, configuration and fixture inputs are unchanged.

Private [Relay #191](https://github.com/KeeperCommunity/bitcoin-keeper-relay/pull/191),
control `fe45a8c895c0ab9579ec6e55b0549e708da0e1d1`, selected accepted backend
`29597b27eeeb299205bf7d0555db0a90c38cc4be` through the unchanged reviewed #161
admission. [Run 40066799617 / job 120791660796](https://github.com/KeeperCommunity/bitcoin-keeper-relay/actions/runs/40066799617/job/120791660796)
completed **SUCCESS: 20/20 caller cases and 14/14 raw-source/cleanup controls
PASS**, zero failures/skips/cancellations/todo. All three source/purity checks,
frozen installs/six patches, actual encrypted Realm, transactional loopback Mongo
and verified owned cleanup passed. Actual decoded-log totals were checked;
the proof batch was not rerun or reimplemented in this resume.

The [owner's exact receipt](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7092#issuecomment-6380553077)
explicitly classifies the remaining **275 original obligations as engineering
coverage backlog, not a new blanket release condition**. No deferred scenario is
reopened. The public **2 PASS / 293 FAIL** result is unchanged; the submitted-R4
43+3 and production 14-request receipts remain separate. #7091's 32 ports and
#7150/private #190's 20 cases use an R5-derived baseline and are not transferred
to submitted R4. Do not duplicate those packages or backport R5 product code.

### Availability, continuity and remaining work

- Original Desktop Actions artifact **11615331902 now returns 404** after its
  23 October expiry. Unchanged #104's pinned download cannot run from that URL.
  The retained 20,064,440-byte archive remains available in owner-only Drive;
  24 October metadata readback confirms its size and owner-only permissions.
  Its complete download/hash/byte comparison was verified on 22 October.
  Use that existing archive through the separately coordinated cloud route;
  do not rebuild it or infer that Actions still hosts it. Sanitized outcome
  artifact 12450860782 remains available through 21 November.
- Mobile #7045 remains submitted `1d8a86a…`, with selected Tests/local gate PASS
  and existing public-v2/CodeQL failures. No newer authenticated store receipt or
  2.6.4 GitHub release/assets was found. Fresh store access and the original signed
  mobile files remain unavailable here; no counter allocation or resubmission.
- SigningServer #6/#3 and Desktop source/CI follow-ups are unchanged. The recorded
  approval-rule settings, deployed SigningServer compatibility, Desktop QR/paired
  acceptance and production packaging/signing/notarization/PGP gaps remain open.
- The separate Sonar result reported in #191 remains red: #162's actual scanner
  run 39833007649, attempt 2/job 120786642230 failed a configured-server connect
  timeout during server-version query. Service-owner reachability repair remains
  separate; no DNS, TLS, authentication or quota cause was established.
- R5 #7068 has progressed to `8b56c6b51831e69f4b67a77754f431f5dcf4711c`.
  #7090 is still a proposal against fixed historical base `3eb92fc8…`, not an
  incorporated correction to current R5. Preserve its review history and the
  current coordinator's owner-attributed baseline statements; do not reset or
  blindly apply the old proposal to the moving integration branch. Source
  ancestry and owner reports remain distinct from fresh store readback.
- Native continuation #7149 and its diagnostic window are coordinated separately.
  **This resume starts no native build, acceptance attempt or workflow rerun**,
  and supplies no new native/physical credit. Existing recovery/Delete/C8/navigation
  scope decisions, failures and post-release follow-ups remain unchanged.

No merge, deployment, release signing, store action or public release is performed
by this documentation publication. R4 closure remains the owner's decision.

## Preserved 22 October evidence

| Work package | Verified checkpoint | Remaining work |
| --- | --- | --- |
| [Mobile #7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045) | Submitted source `1d8a86a7462d935cbd0e28b857934b5718c152fc`, draft/open/unmerged. Required Tests and `keeper/local-validation` pass. [Store receipt](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6313099996) records signed iOS 620 uploaded/VALID, manual release, WAITING_FOR_REVIEW; Android 627 IN_REVIEW with 626 PUBLISHED and Managed publishing ON. APK checksums and both Keeper PGP signatures already verified. | Fresh authenticated Apple/Play readback is unavailable in this cloud session: no store credentials or store connector. Do not infer current review/public status from the 21 October receipt. Do not rebuild, allocate counters or resubmit. Current CodeQL security-result and public-v2 genuine-backup checks still fail. |
| [Private Relay #158](https://github.com/KeeperCommunity/bitcoin-keeper-relay/pull/158) | [Accepted production result](https://github.com/KeeperCommunity/bitcoin-keeper-relay/pull/158#issuecomment-6321195858): `29597b27eeeb299205bf7d0555db0a90c38cc4be` selected, process readiness matched, health 200, old-writer fence 403, 14-request synthetic hosted-v3 acceptance passed, external TCP/3000 denied, temporary access cleaned. | This is completed deployment/hosted-protocol evidence. It does not pass installed-app/device or affected-account acceptance. Do not redeploy or treat the older undeployed/readiness wording as current. |
| [Website #19](https://github.com/KeeperCommunity/bitcoin-keeper-website/pull/19) | Merged and deployed; final website source `ddba13bd289e8899b16a6f653cf5c1ea66be6243`, production 7244276168. [Strict public HTTP run 39726344502](https://github.com/KeeperCommunity/bitcoin-keeper-website/actions/runs/39726344502) passed 8/8, including exact association/fallback bytes and direct JSON 200 without redirects. | Installed iOS/Android cold/warm link association, absent/present fallback, return-to-app and phone-to-Desktop acceptance remain unrun. No website rebuild or deployment is needed. |
| [Desktop #100](https://github.com/KeeperCommunity/keeper-desktop/pull/100) | Approved source `ef050663d33be51f25fb10310d5a0549b111e273`, CI successful. QA artifact 11615331902 was downloaded and durably retained privately. Hosted macOS verifies its source/hashes/identity/strict code signature; native process launch and connected Welcome **PASS**. | QR/channel smoke is blocked at Get Started; cause unresolved. Full Desktop/phone/signing acceptance remains unrun. Historical mobile pointer `d25d…` does not identify submitted mobile `1d8a86a…`. Keep #100 approval and head intact. |
| [Desktop #102](https://github.com/KeeperCommunity/keeper-desktop/pull/102) | Peer-reviewed, green draft `06233e6a576ae1c9d0a49a34c253b3e9354b9efc`; PGP handoff preflight guards are implemented. Isolated [#103](https://github.com/KeeperCommunity/keeper-desktop/pull/103) `23284ec1dd02b305355525290f2f8aa42cca54d0` adds those 12 guards to ordinary CI. [Full hosted CI 39831840277](https://github.com/KeeperCommunity/keeper-desktop/actions/runs/39831840277) passed, including all 12 guards; original #102 is preserved. | CI tested initial main-based synthetic merge `a6882cf28e8b2f9eac67633e9c32107881cd6891`; subsequent retarget to #102 changes review scope only, with no new acceptance claimed. This is CI proof, not native/signing acceptance. |
| [SigningServer #6](https://github.com/KeeperCommunity/SigningServer/pull/6) | Source-complete six-field lock correction `df9485e9945cdf0bdc231c70329d8905125d42ff`; hosted tests and both secret scans pass. Fresh runtime-dependency audit: zero critical/high/moderate, one existing Low AWS SDK advisory. | [Ruleset 24651096](https://github.com/KeeperCommunity/SigningServer/rules/24651096) still requires one approval and last-push approval, despite optional-human policy draft #3. No service build artifacts/releases are published. Deployed version, health and mobile/provider compatibility are unverified; source CI cannot establish these. |

The mobile local-validation pass is the owner-selected subset, with unchanged-app
input carry-forward from `ffb89f28ace014bc581c53895b16260f2c8f4dd8` to the
metadata-only `1d8a86a…` head. It does not claim a new full native run. Preserve
[exact-source physical deferral](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6312155011)
and [qualified validation](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6312169993).
Developer review remains optional under the [recorded owner decision](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6309829901); existing
requests/approvals are retained. A CodeQL analysis finishing successfully does
not pass its separate high-severity security result. Numeric-only fee-consumer
evidence supports review of the inherited warning; it is not a dismissal.

### New submitted-source paired CI

Isolated private [Relay #161](https://github.com/KeeperCommunity/bitcoin-keeper-relay/pull/161),
control `921a475752eb6c69765709d16dc8af9d6cc92c8e`, pairs submitted mobile
`1d8a86a7462d935cbd0e28b857934b5718c152fc` with accepted backend
`29597b27eeeb299205bf7d0555db0a90c38cc4be`.
[Hosted run 39832222599 / job 120011029067](https://github.com/KeeperCommunity/bitcoin-keeper-relay/actions/runs/39832222599/job/120011029067)
**PASS: 43/43 protected cases and 3/3 historical guards, zero failures/skips**.
Frozen installs, six app patches, actual encrypted Realm prerequisite, loopback
Mongo and all three source verifications passed; owned cleanup completed.
Independent exact-source safety review passed before execution. Original #159,
#160, app and backend refs were unchanged; Build/Sonar was skipped for this lane.

This closes the submitted-source/current-backend **cloud integration** gap. The
public-v2 295-case lane still reports **2 PASS / 293 FAIL / 0 skips** on submitted
source; porting/reviewing that current-protocol matrix remains separate source/CI
work. The new private result neither ports that matrix nor waives its red result,
native/physical tests, CodeQL security disposition, store state or artifact access.

### Desktop hosted native subset and exact blocker

Isolated [Desktop #104](https://github.com/KeeperCommunity/keeper-desktop/pull/104)
adds only disposable cloud-test tooling, stacked on unchanged approved #100.
Final tooling `72c56adcb07fbe020094bee3625d899dd0ba8460`,
[run 39834105821 / job 120017732757](https://github.com/KeeperCommunity/keeper-desktop/actions/runs/39834105821/job/120017732757),
is **BLOCKED**, not full native acceptance. Existing QA bytes were never rebuilt
or re-signed. The macOS ARM64 runner reports 26.6.2/build 25G83.

- Artifact source/provenance, all hashes, QA app identity/version/live endpoint,
  strict deep code signature, native process launch and connected Welcome: **PASS**.
- Accessibility, event-posting and screen-capture permissions all read true;
  exact-process activation read true. After a settled fresh-screen click and one
  Welcome-only retry, Get Started remained visible, Scan Me was absent and QR
  count was zero. Root cause remains unproved; this is not an established app defect.
- QR/channel acceptance: **BLOCKED**. Malformed/valid channel packets, actual mobile pairing, camera scanning,
  reconnect/rotation matrix, hardware and PSBT round trip: **NOT RUN**. No test
  packets were sent. No Continue/signing action ran.

Preserved attempts: initial `49927b13…` run 39832690264 failed in Vision after
launch; CPU-only fix `cd36015f…` run 39833213888 reached connected Welcome;
diagnostic `ed2220bf…` run 39833708602 identified the unchanged Welcome and true
permissions; final focus/click fix above retained the same blocker. Each change
received independent source/safety review before execution. Sanitized final
artifact 12450860782 expires **21 November 2026 18:46:34 UTC**; no screenshots,
OCR text, QR key/room or app logs were uploaded.

Next acceptance route is an authorized **interactive cloud QA session**, or a
demonstrated correction to this harness, followed by the remaining QR/channel
cases and separately recorded phone/signer checks. Do not substitute a personal
Mac requirement or report these unrun cases as passed.

## Artifact availability

Mobile production bytes are identified in the store receipt:

| Artifact | SHA-256 |
| --- | --- |
| IPA 2.6.4 (620) | `c2ab7c0a49a3f0ccc5cbb1da6be1edcd6e3d71d0e8b9eba3acf57ea4d6174036` |
| AAB 2.6.4 (627) | `48e082dbe9cbc03280cef57cc65edecc004d9f2ee8991fadb2f73602052309ae` |
| APK 2.6.4 (627) | `cf0a84e2e1d73866a7c7b0fff00cbddefab01d06e49d15e4981157c9768090b2` |
| SHA256SUM.asc | `9f2b5125f232ee80c75b81c9b7a3ef53387956a77f57bc5aafbea347d43b5384` |
| KEEPER_DETACHED_SIGN.sign | `c2c1f37498c80506ff2229561c0d3cb1ba306e873ca41c32dccbd41e726302d5` |

The PGP fingerprint is `389F4CADA0785AC0E28A0C181BEBDE261DC3CF62`.
No 2.6.4 GitHub release/draft/assets are currently available; the inspected
current mobile CI run has zero artifacts. Store acceptance of an upload and
recorded hashes do not make the original IPA/AAB/APK/PGP files retrievable from
this workspace. A custodian must place the **existing bytes** in an approved
private cloud location; verify them against the receipt without rebuilding,
resigning, resubmitting or publishing. Do not make a personal Mac the ongoing
release route.

Desktop artifact 11615331902 was preserved at
`/workspace/r4-desktop-evidence/desktop-qa-11615331902.zip`; provenance receipt:
`/workspace/r4-desktop-evidence/artifact11615331902-revalidation.json`.
These workspace paths are session copies. An additional **owner-only Google Drive
retention copy** was created and read back in full: 20,064,440 bytes, SHA-256 and
byte comparison match the original. File metadata confirms not shared and only
the owner permission. Its private link is delivered to the owner separately.
The GitHub copy retains its stated expiry; the private retained copy removes
that availability deadline. No release distribution or public publication occurred.
Connected Drive searches for 2.6.4, IPA/AAB/APK and PGP files found no original
mobile release artifacts.

Desktop outer ZIP SHA-256:
`2a3ca33dd9a539323f41639d98fb36ab8d2cdc670f1b17b20f861b3528eaeea5`;
inner QA ZIP:
`9ae0c39eefafd85a9234bf7a599f75e3b13a481ab0ad7f9418eee66990c34a69`;
executable:
`13e252b7a7f339d24e327d8d14d7956946f21b929c037970edffa9e6e90fcb70`.

This is macOS ARM64 **QA 0.2.6-qa.1**, identifier
`com.keeper.desktop.r3qa`, with an ad hoc signature. It is not a notarized
production package or a cross-platform distribution set. Fresh authenticated
Desktop release inventory has no 0.2.6 release/draft and no release targeting
`ef050663…`; latest production remains `keeper-desktop-v0.2.5`, published
6 October, source `0b5c18b8d5897a94ded9196cde9a2022d6e17d1a`. Final source/version,
OS package matrix, production signing/notarization and checksummed PGP assets
remain separate, with operation-specific authorization required. #102 provides
preflight guards; it has not executed a signing route or release manifest.

## Explicit deferred and unresolved acceptance

- Older-copy recovery, protected Delete/tombstone/recreate, original-order
  bootstrap/reconnect and additional native safety permutations remain
  **NOT RUN / OWNER-DEFERRED** under the reduced R4 scope. Existing recovery
  record/cold passes retain their exact-source limits; the two-extra-default-node
  whole-image equality difference remains a difference. No new campaign is started.
- C8 / [#7056](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7056)
  remains **FAILED / PARKED, Later**: lost reply produced a second mutation
  request, despite one commit and later matching readback. It is not a pass.
- [#7057](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7057)
  restored-fixture iOS navigation remains **NOT ACCEPTED / PARKED**, cause unproved.
  [#7055](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7055) Android
  More-to-Wallets remains a separately tracked R5 follow-up if reproduced/in scope.
- Physical phones/cameras/NFC/USB/signers remain **NOT RUN / OWNER-DEFERRED** for
  the exact R4 source. Desktop and installed-link acceptance receive no credit
  from unit, synthetic protocol or HTTP-only checks. Use hosted/remote devices
  where available; no personal-Mac handoff is requested.
- [#7066](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7066) preserves
  the owner's report of an App Store-updated iPhone showing 2.6.4, unverified
  backup and unconfirmed Delete. Accept the owner-reported installed version;
  stale in-app history is not a reason to ask them to repeat that check. This
  report alone does not establish global store state or exact installed build
  provenance. Separate R5 [#7067](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7067)
  already implements the focused backup/history/UI correction and is included
  in [#7068](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7068).
  Native corrected-pair and non-destructive original-phone acceptance remain
  incomplete. Do not call the original phone fixed or automatically reopen the
  deferred R4 Delete campaign. The owner must assess any release-blocking impact
  from this known report; no critical defect is waived.

The recorded physical follow-up belongs to the release owner `antuz123`, after
release on installed physical phones and relevant cameras/hardware signers,
reported on #7045 or the release record. Retain that timing and scope; do not
silently convert the follow-up into a new pre-release requirement. When performed,
bind installed iOS620/Android627 and website `ddba13bd…` to cold/warm associations,
camera/browser return and phone-to-Desktop pairing, then record signer/NFC/USB
outcomes separately. The outstanding Desktop paired-phone matrix remains distinct
from a Desktop-only hosted launch. Do not ask for private keys or recovery exports.

## Roadmap and R5 continuity

[Roadmap #7065](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7065)
still has R4 active and requires owner closure. Git ancestry of the submitted
R4 source is established in R5 #7058 and #7068; descriptions calling it
"released", "live" or "shipped" are not fresh store evidence or R4 closure.
Retain the earlier owner/device reports with their source attribution while
correcting that distinction. Public status is unverified here; the present
instruction keeps further public release held.

Preserve all running R5 branches, checks and implementation. #7058 remains
`77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238`, #7067 remains
`c1c4b803039b61b940373c4dc9d08473cf25e042`, and #7068 was inspected at
`3eb92fc8a622a3e09926d49f47243c163e32d009`. Later R5 progress is expected;
these are observations, not pins to force onto active work. Do not duplicate
#7066 or rerun/cancel the active R5 native/paired-CI jobs. R5 = 2.6.5,
R6 = 2.6.6, R7 = 2.6.7; retain the owner's bug allocations and sequential
closure rule.

Documentation-only drafts [#7089](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7089)
and [#7090](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7090) correct
the R5 baseline wording on isolated branches stacked on #7058/#7068. They do not
modify those producer refs, implementation, acceptance scope or running checks.

#7060's successful hosted native passcode smoke belongs to its own source
`d865ca9c4f91532a1524443cc6da42d8d7b07e1a`, not submitted R4. Its dependency,
Pod and infrastructure changes would alter the submitted source. Leave adoption
with the existing R5 integration/review instead of adding a new R4 build cycle.
This choice neither waives tests nor changes existing gate results.

## Next owner actions

1. Obtain a fresh authenticated read-only Apple 620 / Play 627 status, release
   mode and live-version readback, and reconcile it with the installed-iPhone
   report. Keep the current hold; do not start another submission.
2. Make the existing signed mobile artifacts retrievable from an approved cloud
   location and verify their recorded hashes. Preserve Desktop's downloaded QA
   artifact from the verified owner-only cloud retention copy; provide an interactive cloud QA route or proved harness correction for Get Started, then complete the outstanding installed-app,
   paired-phone and signer checks, recording each actual result separately.
3. Have an authorized administrator reconcile SigningServer's existing approval
   rule with the recorded owner policy while preserving checks/approvals. Bind
   any required service acceptance to the actual deployed source/artifact; no
   deployment is authorized by this record.
4. Review current protocol/security evidence and explicitly accept remaining
   noncritical deferrals or identify the remaining blocking work. Record R4
   closure only after these decisions and actual release-state reconciliation.
   Public publication remains a separate owner action.
