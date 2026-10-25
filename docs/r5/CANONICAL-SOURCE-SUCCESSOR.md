# Canonical private software collection successor

This is a new source implementation of the missing byte-ingestion and parent
projection boundaries. It is not a recovered P2B2/P3B export. The original
recorded P2B2 commit was unavailable through the selected repository/identity;
no original P3B final source identity was supplied. This candidate is based on
reviewed trust correction `b9297318f9883a1241722023cea91d1072fae67d`.
The separate adoption commit retains the seven original private-origin/D13 ZIP
source, documentation and control files from
`23192ad02e305fe734b2a18f100435ae2b6fcb5d` before this successor's changes.

## Original bytes and authenticated readback

`private_actions_software.cjs` authenticates both private Actions origins before
reading artifacts. It binds the exact selected artifact ID, byte count and
SHA256, streams at most12MiB, and uses the fixed thirteen-member D448 ZIP reader.
The JSON IPC envelope is captured privately. The child process receives only
PATH and Python isolation flags, never the caller's credential environment.
No member is extracted, reserialized, logged or retained by this collector.
The existing strict D raw validator independently checks the original bytes
against authenticated app/controller/backend/source maps and actual job/cleanup
provenance. This does not route D through the older C2 ten-member API.

The authenticated API hop uses the pinned github-script SDK's supported fetch
hook with automatic success-body parsing disabled. It requires a manual302;
only the GitHub hop receives SDK authentication headers. HTTPS signed storage
hosts are restricted to the existing Actions/Azure host suffixes, receive no
API headers, and cannot redirect again. Response size, stream completion and
body cancellation are checked. Public and private transport APIs remain
separate and have their original fixed repository and size limits.

Private origin list reads now collect every page through the same SDK endpoint
and fixed arguments, at most ten100-item pages. They never follow a supplied
Link URL. Stable total counts, unique numeric IDs, complete page sizes and
continuation consistency are required. Truncation or concurrent list changes
reject the collection. Latest-run selection includes failed/pending runs;
there is no success-only filter or previous-attempt fallback.

After both downloads and raw validation, origin is authenticated again and must
match the original snapshot. This includes selected artifacts, source trees,
job/check ownership, exact attempts, cleanup, repository privacy and current
branch/workflow. Issued software proofs are deeply frozen and privately
branded. Serialization or a copied PASS object cannot supply the brand.

## Installed-window composition

`installed_parent_software.cjs` first requires the existing genuine branded
public software proof and freshly authenticates the installed-window capability.
The public app/tree/run/attempt and private app/tree/source maps must agree.
It uses a separately supplied private read client and freshly collects original
D13 software facts for the window's independently expected private controllers.
Public/private binary hashes are not equated: each proves its own installed
bytes for the same app source. The five private cases are projected by their
exact IDs into the unchanged canonical attestation schema. Public receipt
identities and executed-check scopes remain unchanged.

The manifest/source/public pin is rechecked after private collection, private
origins are rechecked after that public read, and the public proof's original
ZIP ID/name/digest/size/source/expiry and selected job/check authorities are
revalidated. The public window/source/pin is checked last. Parent proof branding
also retains the exact original public capability, so a different genuine
public proof cannot borrow its parent facts. These are bounded repeated readbacks, not an atomic snapshot
of GitHub. A concurrent service change after the final observation remains
outside that observation window.

The canonical caller removes both read-token environment variables before the
pinned raw-source Git bootstrap or Python subprocess. Only its attestation step
can reference the optional `KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN` secret.
Its proposed identity is finite-expiry, selected-private-repository-only
`bitcoin-keeper-relay`, Actions read and Contents read plus automatic Metadata
read. It has no signing, upload, dispatch, write or administration scope. Missing
private identity leaves the five parent obligations incomplete; the public
Actions token is never reused as a fallback. This candidate provisions no token.

## Remaining installation and acceptance

The production `INSTALLED_PROFILES` and private `REVIEWED_WINDOWS` remain empty.
There is no option, environment variable, artifact or API payload which can
populate them. Real parent collection stops before private API access until a
finite source profile is separately reviewed and installed. The atomic window
variable and actual exact app/controller/run identities also remain one-time
approved installation inputs. No actual private read route or identity has been
tested. No native run, backend/provider action, merge, pin/profile installation,
release signing, store upload, distribution or publication was performed.

New and adopted host controls execute controlled Actions boundaries, actual ZIP
parsing, original raw validators, source-copy-only synthetic installed profiles,
credential isolation, late revocation and canonical schema projection. They are
not native or live installed acceptance. The existing canonical contract
workflow selects these controls under read-only permissions and its unchanged
raw-source checks. A separate fixture executes the actual pinned github-script
v8 Octokit client with only a dummy identity and controlled fetch. Local proof
uses the verified pinned bundle on Node24.22.1, and the same fixture is selected
inside that pinned action in CI. Success, API/host rejection, byte caps, body
cancellation and a controlled-clock abort of the actual passed30-second signal
are exercised without any service request. All returned software objects retain installed trust
UNVERIFIED and native/release/readiness/authorization/execution flags false.
