# Mobile credential preservation candidate

This private patch addresses demonstrated source/model failure paths in the existing credential replacement flow. It is preparation for mobile2.6.5, not a signed build or release acceptance.

The two app modules serialize credential writes, preserve existing records during biometric enrollment, bind PIN replacement to the selected account, and reconcile only a confirmed original owner after an account switch. The existing credential format, opaque64ASCII Realm key, service/account/Realm identities, dependency versions, lockfiles and schema remain unchanged.

The new react-native-keychain10.0.0 patch adds an app-scoped opt-in. Existing iOS entries receive a value-only SecItemUpdate; a failed update never deletes/recreates an existing entry. Unopted upstream behavior remains unchanged. The option is typed in the package declarations; Android ignores it. Keep the existing fail-closed patch-package application: an unpatched package still deletes first.

Final candidate validation:30 portable Jest regressions in an isolated Node environment, independent source review, Babel TypeScript syntax checks, three pinned vendor sources and zero-fuzz patch application, and actual patch-package6.4.7 application against a sparse pinned package. Earlier source/model characterization and owner-reconciliation controls established the failure paths and repair; they are not additional native acceptance. Full repository CI, Objective-C compilation and genuine native fault/restart tests are not claimed.

Native validation must cover default/additional accounts, setup/PIN/biometric success and rejection, account switching, retained64ASCII Realm identity, failed existing updates, exact acknowledged readback, lock/unlock and interrupted writes. Process death, missing acknowledgment or failed readback before owner-metadata confirmation remains an explicit acceptance gap. Do not infer universal crash atomicity or delete/recreate credentials to recover.

The integration preserves both histories: the preservation/fixture source ffeb1bddc4e967d39b836a21f8aae4e0f0f1adfa and the other thread's reviewed source e2742788c243a6a6425e13e0acac8ab0f1834788. Their paths are disjoint. The latter supplies the recovery-sheet fix, bounded TLS preparation correction and explicit candidate metadata2.6.5/Android628/iOS621. Those assignments are preserved here; complete fresh store histories, final source identity and actual signing checks still require verification before delivery. The other thread's PR80 ref, labels and runs are not changed. Historical precursor tests are not final combined-source acceptance.

Known CWE916 and inherited dependency/client-key restriction questions remain separate security dispositions. This preservation change is not a KDF migration, blanket security clearance, full cloud release automation or broad cleanup.
