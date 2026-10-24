# Frozen Ruby compatibility for hosted release workers

This small package resolves the concrete CocoaPods/Xcodeproj mismatch identified while reviewing Phase B2. It pins CocoaPods/core1.16.2 and Xcodeproj1.27.0, matching the selected hosted Xcode16.4 route. The resolver changes only the required Nanaimo0.4.0/REXML3.4.4 closure and records Bundler2.5.22, the resolver supplied by the verified portable Ruby3.3.8 toolchain. Fastlane remains2.225.0; FFI/Ethon/Typhoeus and all unrelated selected gems remain unchanged. No signing/store lane runs during installation or contracts.

Resolution used Bundler conservative update; temporary resolver constraints held unrelated shared dependencies at their original selected versions and were removed before the final local resolution. Actual frozen installation completed for118gems on Ruby3.3.8, `bundle check` passed, and CocoaPods1.16.2/Xcodeproj1.27.0/REXML3.4.4 loaded successfully. Initial local attempts failed on missing development headers and portable linker paths; those failures were resolved with SHA256-authenticated Debian Ruby3.3.8-2 development headers from the existing verified APT snapshot and a task-local portable rbconfig/linker shim. Shared tool configuration and credentials were not changed. This setup is not required on standard hosted ruby/setup-ruby runners.

The inherited root Podfile.lock records CocoaPods1.15.2. The separately reviewed adopted native foundation owns the1.16.2 Podfile.lock; pair these inputs during integration. This package **does not edit/regenerate Podfile.lock or claim a successful CocoaPods install/native build**. The release worker rejects mismatched pairs before credentials. Actual frozen Pod installation/build still requires exact combined hosted validation. Historical `.ruby-version`/lock Ruby3.3.0 metadata is unchanged; the existing >=2.6.10 constraint accepts the explicitly selected/tested hosted Ruby3.3.8 runtime.

The added secret-free contract workflow installs frozen Ruby dependencies, checks their selected versions, parses the existing Xcode project and runs fake Fastlane contracts. It does not invoke CocoaPods installation, xcodebuild, Gradle, signing or a provider upload. No production configuration, keychain, API credential, Mac or release operation was used. Dependency resolution/load is not independent security review or proof of production signing compatibility; preserve unrelated dependency/security findings.

## Isolated reconciliation after #7086

The historical mismatch above is preserved on #7078/#7080/#7086. The separate
`codex/r5-cloud-release-reconciliation` branch copies exactly `package.json`,
`yarn.lock` and `ios/Podfile.lock` from native candidate #7082
`3eb92fc8a622a3e09926d49f47243c163e32d009`, retaining #7078's Gemfile/lock.
The copied native tuple pins Nitro0.36.5 and CocoaPods1.16.2; no lock was
regenerated. This preparation branch does not contain all later native app
changes and is not the full combined app candidate.

`python3 -B scripts/check_cloud_release_inputs.py --root .` now checks the same
fail-closed Ruby compatibility boundary used by the iOS worker, plus exact
Nitro agreement across manifest, Yarn resolution and Pod lock. It emits only
input hashes and preparation flags; alignment is not frozen installation or
native acceptance. Negative controls preserve rejection of the old mismatch and
reject drift in each Nitro input without modifying files. The frozen Ruby
workflow runs this check and those controls when any paired input changes.

Actual frozen118-gem installation/check/load/project parse passed again on this
reconciled tuple under task-local Ruby3.3.8/Bundler2.5.22. Full combined-source
`pod install --deployment`, app builds and feature acceptance remain with the
native owner, in one coordinated hosted window. See the
[operator handoff](r5-protected-release-handoff.md) for exact source hashes and
the [administrator/custodian specification](r5-cloud-administrator-setup.md).
