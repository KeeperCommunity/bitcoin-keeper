# Mobile credential preservation candidate

This private patch addresses demonstrated source/model failure paths in the existing credential replacement flow. It is preparation for mobile2.6.5, not a signed build or release acceptance.

The two app modules serialize credential writes, preserve existing records during biometric enrollment, bind PIN replacement to the selected account, and reconcile only a confirmed original owner after an account switch. The existing credential format, opaque64ASCII Realm key, service/account/Realm identities, dependency versions, lockfiles and schema remain unchanged.

The new react-native-keychain10.0.0 patch adds an app-scoped opt-in. Existing iOS entries receive a value-only SecItemUpdate; a failed update never deletes/recreates an existing entry. Unopted upstream behavior remains unchanged. The option is typed in the package declarations; Android ignores it. Keep the existing fail-closed patch-package application: an unpatched package still deletes first.

Final candidate validation:30 portable Jest regressions in an isolated Node environment, independent source review, Babel TypeScript syntax checks, three pinned vendor sources and zero-fuzz patch application, and actual patch-package6.4.7 application against a sparse pinned package. Earlier source/model characterization and owner-reconciliation controls established the failure paths and repair; they are not additional native acceptance. Full repository CI, Objective-C compilation and genuine native fault/restart tests are not claimed.

Native validation must cover default/additional accounts, setup/PIN/biometric success and rejection, account switching, retained64ASCII Realm identity, failed existing updates, exact acknowledged readback, lock/unlock and interrupted writes. Process death, missing acknowledgment or failed readback before owner-metadata confirmation remains an explicit acceptance gap. Do not infer universal crash atomicity or delete/recreate credentials to recover.

This branch does not change the other thread's active PR80 diagnostic source or labels. Its parent is0ba25a76962e6309a13a17ec2c52b7caed511229, whose four host-only diagnostic changes retain the same mobile code as4aca46e4f7fde47e55d71675b78dba5ec0b4ef2a. Version metadata is still2.6.4; complete fresh store histories and deliberate2.6.5 counters remain required before signing.

Known CWE916 and inherited dependency/client-key restriction questions remain separate security dispositions. This preservation change is not a KDF migration, blanket security clearance, full cloud release automation or broad cleanup.
