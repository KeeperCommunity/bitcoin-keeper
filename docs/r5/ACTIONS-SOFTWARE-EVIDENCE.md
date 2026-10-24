# P2A: read-only public Actions software receipt ingestion

This separately reviewed source package consumes ordinary reusable-worker
artifacts. It does not run native jobs, post statuses, authorize a release,
read credentials, access a signing environment, or replace canonical provenance.
P1A is a full Git ancestor. Private C2/D ingestion is a separate follow-up:
`collectPrivateSoftwareEvidence()` rejects every input with
`SOFTWARE_PRIVATE_CONTRACT_NOT_FROZEN`.

## Public route and original bytes

The fixed repository is `KeeperCommunity/bitcoin-keeper` / `470904030`.
The caller is `keeper-release-acceptance.yml` and its local reusable worker is
`keeper-native-platform.yml`. The app SHA is the actual PR head. The workflow
control SHA is the caller/reusable PR merge SHA and may differ from the app SHA.
The collector binds that control SHA/ref/path to the run API's single
`referenced_workflows` entry; receipt fields never select control provenance.
Actions linked PR snapshots contain reduced repository objects (`id/url/name`),
so their exact repository IDs/ref/SHAs bind to the independently authenticated
full repository/current PR rather than requiring a nonexistent `full_name`.

The current same-repository PR, protected `sprint` base, original run base,
current app/control trees and existing complete native/workflow installation
fingerprints must agree. Changing this package changes that fingerprint, so an
uninstalled PR cannot certify itself. R4 #7045, drafts, legacy selection and
diagnostic selection remain excluded. Existing driver-pin and canonical
consumer protections are not relaxed.

Only the latest unfiltered run for the exact app SHA/branch/PR/event is eligible.
A newer failed, skipped, pending or cancelled run revokes an older pass. The
summary may inspect its own in-progress run after both native jobs finish;
external completed runs must have succeeded. Exact current-attempt jobs,
unique required successful steps, check URL/ID/name/suite/head, and the official
Actions App are all required. Run freshness is bounded to 24 hours using the
collector clock, not artifact-declared observation times.

Each platform must have one unexpired artifact named
`keeper-release-native-<PLATFORM>-<appSHA>-<runID>-<attempt>`. Its repository,
run/head, API ID, size and SHA256 digest are bound to bounded downloaded bytes.
The API redirect is manual; the signed HTTPS storage request receives no API
token or headers and follows no further redirect. Missing redirect support in
an installed client fails closed; live route capability is not claimed here.
`readPublicArtifactBytes` exposes that same bounded transport for a separately
reviewed fixed-existing-artifact hosted compatibility probe. It returns only
untrusted original ZIP bytes and cannot issue a software proof.

The ZIP reader accepts exactly `ios/metadata.json` or `android/metadata.json`,
at most 1 MiB archive / 512 KiB original member. It verifies ZIP32 local,
central and descriptor agreement plus actual decompressed CRC and rejects
extra members, traversal, links/special files, encryption, ZIP64, overlap,
trailing ambiguity and decompression overflow. It never extracts paths.
Its subprocess inherits only PATH and fixed Python flags, not runner tokens.
The original member bytes, not reserialized JSON, supply the recorded hash.
The shared strict JSON parser rejects duplicate decoded keys at every nesting
level, nonfinite numbers, invalid UTF-8 and trailing input before P1 validation.
This also covers Unicode-escaped duplicate keys and numeric overflow in fields
that a scoped validator would otherwise ignore. The canonical and trusted-origin
raw artifact boundaries import the same separate parser leaf.

P1A validates actual producer stages, five healthy observation pairs, the
separate controlled disconnect/retry case, installed-byte identity, worker
source hashes fetched independently at the app SHA, and scoped public UI
companions. Mutable origin, job/check ownership, artifact identity and expiry
are read back; current source/latest attempt is checked after final artifact
readback. API/parser exceptions expose only fixed error vocabulary.

## Scope and remaining work

Issued in-process proofs show the twelve implemented public scoped checks
separately from the seven parent obligations. Copies and caller PASS labels
are not issued proofs. The first two native prerequisites can receive scoped
credit after all origin/raw checks. The other five parents remain NOT VERIFIED:
public artifacts do not establish private protected-backup/recovery/account
composition. The summary remains blocking. Every result preserves
`installed_trust: UNVERIFIED`, `software_complete: false`, and false release,
authorization and execution flags.

P2B must use the actual reviewed C2/D fixed raw member union and independently
authenticated app/control/backend/run/attempt expectations before invoking
P1B's parent validator. Private control provenance stays private even when its
worker invokes public app commands. It cannot borrow another build's public
observations or become canonical evidence. No draft/WIP schema, caller
manifest, self-reported hash or success label activates this adapter.

Source controls use fake API transport and actual producer-shaped disposable
receipts. ZIP controls also checked the format of one existing hosted 23f iOS
archive, SHA256 `96617d1fe5680464a841a97416e2b80eed03f88d9c36bb1252293ccd5a26d219`;
that format check supplies no current app/native/feature acceptance. No native
or authenticated live Actions collection has been executed for P2A. WAN
offline, authentic historical installations, release-performance budgets,
physical devices and release authorization are not proved by this package.
