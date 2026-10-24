# R5 support and release copy — unsent draft

For owner review after the combined candidate passes its required acceptance. This draft is not published, sent, or a statement that R5 is released. Verify final 5.2 scope, source, versions, channels and exact acceptance before using it. 5.1/5.2 are internal work-package labels; source still identifies 2.6.4. Do not claim native, physical or backend acceptance from source completion alone.

## Proposed release-note text

Keeper's next stability update improves safe key deletion and startup recovery, with clearer backup actions and Version History. Review the final release source and acceptance record before describing these as shipped improvements.

- Key deletion is easier to find and checks current wallet references before removing a key, including retained wallet data. Follow the in-app warning and retain the recovery material you need.
- Startup and first-wallet setup give clearer retry behavior when required local credentials or connectivity are unavailable. No timing claim is included until the exact candidate's raw measurements are reviewed.
- Assisted Server Backup has clearer status, an explicit Back Up Now repair path where eligible, read-only Check Again, and readable results. Automatic backup consent, a successful protected backup, and deletion of an existing protected copy are distinct states.
- Version History distinguishes the installed app version from historical entries. A “Current installation observed” entry records the app observed on that account; it does not invent a store update or a successful migration.

Add or amend the 5.2 paragraph only from its authoritative completed handoff. Do not describe an unknown package identity or unfinished feature as complete.

## Ask Keeper / website help proposed changes

**Checking a backup:** Check Again reads the current protected-backup state. It does not create a backup. An eligible account with automatic backup enabled may use Back Up Now to attempt the explicit repair/upload; wait for its acknowledged result. A conflict, deleted namespace, failure or uncertain result must not be described as a verified new backup.

**Deleting a backup:** Turning automatic backup off stops automatic uploads; it does not itself delete a saved protected copy. Deleting a protected backup applies to that protected copy and is not a promise to erase every legacy copy. A never-enrolled account has no protected copy to delete and is not enrolled merely to perform deletion. Keep the Recovery Key safe.

**Version History:** Installed app version comes from the running native app. Historical records remain historical. The store listing is separate evidence; it must not replace the installed version or manufacture a past update date. The owner-confirmed 2.6.4 installation with stale 2.6.3 history is already accepted evidence; do not ask the owner to recheck that version.

**Support diagnostics:** Share only the bounded operation/stage/category, HTTP status if shown, elapsed time and app version/build through the approved support route. Do not request raw logs, Recovery Keys, PINs, headers, bodies, account identifiers or signing material. Do not request a reset, reinstall, restore-over or backup deletion on the working phone to investigate the old report.

**Emergency Key wording:** Only use the reviewed wording included in the final candidate. Do not expand key-role terminology or advertise a new reset/recovery capability. Hardware/biometric behavior needs actual device evidence; simulator results must be labelled accurately.

Publication remains owner controlled. Update public release notes, website and Ask Keeper together only when required for the actual accepted deliverable, after the final channel/version/source evidence and explicit publication approval. No communications were sent by this package.
