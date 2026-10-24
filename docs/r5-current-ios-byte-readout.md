# One completed iOS metadata ZIP transport

This isolated preparation extends #7117's demonstrated Actions artifact readout.
It transports the **original ZIP bytes**, rather than reconstructing metadata.
It does not run an app build, simulator, driver, dependency installation, native
flow, release operation or acceptance checker. It does not change the active
native source or Android continuation.

The finite selection is run `39858617273`, attempt `1`, source
`1bc34890cb8618b2fffd446a63924974e0fe15b5`, reusable workflow
`3c44ab6412a8118b183273c402dd08136db05b28`, completed failed iOS job
`120103187854`, and metadata artifact `12462694619`. Its expected ZIP is 6,884
bytes, SHA256
`550142809a0faf812741a586630b17d6f458b2b6c935b5bab4b00f84da67c84f`.

The read-only API checks the current attempt, source repository/head/branch,
diagnostic workflow and exact referenced reusable workflow, completed iOS job,
successful build and upload steps, and failed startup step. The whole run may
remain in progress with no conclusion while serialized Android continues; a
completed failed run is also allowed. No Android job is requested. The artifact
API identity, name, repository, expiry, size and SHA256 must match before download;
downloaded bytes must independently match size and SHA256.

Only one ordinary `ios/metadata.json` ZIP member is allowed. Encryption,
directories, symlinks, extra members, prefix/suffix bytes, comments, extra fields,
local/central-header disagreement, undeclared gaps and unused compressed bytes
are rejected. The bounded ZIP is read in memory, never extracted. JSON rejects
duplicate keys, nonfinite numbers, excessive nesting/size, unexpected root keys,
raw/private fields and values outside a bounded reviewed public vocabulary.
The safe fixed `startup_observation.hierarchy` receipt is explicitly distinguished
from a raw hierarchy tree. Failed, false, null or absent optional receipts remain
transportable; internal passes are not transport prerequisites.

The hash-pinned public vocabulary records four exact producer-file hashes and
literal strings/keyword field names from reviewed1bc, plus public keys/strings
from the earlier metadata-only iOS receipt. Its `historical_metadata_sha256`
identifies the retained normalized JSON representation, not the original ZIP or
original JSON member bytes. This vocabulary is a conservative transport guard,
not a diagnostic consumer or sanitizer. Privacy also depends on the exact
reviewed producer, upload boundary and immutable ZIP digest. No arbitrary archive
selection or private data transformation is supported.

The download is written exclusively as a private0600 temporary file. Python
rechecks the original size/hash and the complete envelope/JSON before returning
base64. CJS requires that base64 to decode to the exact downloaded bytes, deletes
the owned ZIP, and only then logs one base64 line between these fixed markers:

```text
FIXED_IOS_ARTIFACT_ZIP_BASE64_BEGIN
<base64 of the exact 6884 ZIP bytes>
FIXED_IOS_ARTIFACT_ZIP_BASE64_END
```

A coordinator can recover this line using the completed readout job-log tool,
decode it locally, and recheck the original ZIP SHA256 before using the separately
pinned acceptance evaluator. No metadata reconstruction, raw native logs, UI,
credentials, artifact redirect/SAS URL, token or underlying exception is printed.
Failures use fixed messages; cleanup cannot hide the primary failure.

The new workflow has `contents: read` and `actions: read`, a five-minute bound,
hosted `macos-15`, pinned checkout/github-script actions, and no cancellation.
It only runs on a push to its own finite branch. It adds no native opt-in or
dispatch input. Publication is left to the coordinator after independent review.

Offline controls cover the current observer receipt, malformed/private metadata,
wrong identity/digest, hostile ZIP envelopes, exact original-byte base64,
whole-run-in-progress handling and private-file cleanup/primary-error ordering.
A separate local read-only compatibility check passed against historical iOS ZIP
artifact12456827499, SHA256
`96617d1fe5680464a841a97416e2b80eed03f88d9c36bb1252293ccd5a26d219`;
its historical identity still fails the current production selection. That
attachment is not a committed test dependency. No current artifact bytes or
native result have yet been obtained by this preparation.
