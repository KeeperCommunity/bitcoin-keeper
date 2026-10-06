# Contributor access

Anyone can fork the public app and
[SigningServer](https://github.com/KeeperCommunity/SigningServer), make local
changes, run available tests and submit pull requests without Keeper's permission.
Contributors with Relay access can also run and modify the full local Docker
stack without approval for each command or change.

## Repository readiness comes before access

Apply the same credential hygiene standard to private contributor access as to
public source. Before inviting a contributor, maintainers verify that the source
and history intended for sharing contain no unresolved sensitive information,
record credential rotation and exposure cleanup where needed, review dependency
and security findings, and confirm reproducible setup. A profile approval does
not waive these checks. Current-source cleanup alone is not history cleanup.

The private Relay readiness review is in progress; broader Relay access must wait
for its recorded acceptance. SigningServer is already public, so its contribution
does not wait on Relay publication or access approval. Detailed findings stay in
private records. Developers who already have appropriate Relay access can
continue their local work without per-change permission.

## Request private development resources

The full packaged Docker setup requires read access to the private
`KeeperCommunity/bitcoin-keeper-relay` repository. SigningServer is public at
`KeeperCommunity/SigningServer` and needs no invitation. Its independent setup is
documented in the [development guide](README.md#signingserver-without-relay-access).

Contact the Keeper maintainer coordinating your contribution through your existing
private conversation. Include your GitHub username/profile, the work you want to
do, and the repositories or other development resources you need. Link a product
issue and relevant contributions if available; prior contributions are useful
context, not a mandatory threshold. If you do not yet have a maintainer contact,
use the [community contact](../../Readme.md#community) to ask how to
reach one privately. Do not send credentials.

Access requests, approval decisions and invitation/setup status are internal
administration. Maintainers record them in Keeper's internal development backlog;
do not create a public GitHub issue for them. Public issues are for user-facing
features and bugs. Security findings follow [SECURITY.md](../../SECURITY.md).

Keeper maintainers review the GitHub profile, proposed work and other relevant
context, decide whether to approve the contributor, and identify the resources
and permissions needed. Approval is for development access, not individual local
edits. Additional resources can be requested as the work expands.

## Maintainer handoff

1. Confirm repository readiness, then review the request and record the decision
   and approved resource scope.
2. Ask a Relay repository owner to grant the approved GitHub account access.
   Read access is sufficient for this Docker bootstrap. Approve additional
   development permissions when the contribution needs them.
3. The contributor accepts the invitations and authenticates Git on their own
   machine using their own GitHub identity. Do not share a maintainer's account or
   token. They can check read access without modifying anything:

   ```sh
   git ls-remote https://github.com/KeeperCommunity/bitcoin-keeper-relay.git HEAD
   ```

4. The contributor follows the [setup guide](README.md), runs `dev up` and the
   [independent setup checklist](HANDOFF.md), and reports the result privately.
   Record when access and setup are
   confirmed; an approved request alone does not prove invitations were accepted
   or the environment works.

No specific contributor has been granted Relay access by adding these
instructions. Relay remains private; its publication is deferred. This document
does not configure GitHub teams, invitations or permission rules.

## Code acceptance and official releases

Contributors can experiment locally and propose changes freely. Keeper maintains
responsibility for code acceptance, security review, merges and official releases.
Development access does not automatically grant those responsibilities or access
to production systems, release keys or store accounts. See
[Contributing](../../CONTRIBUTING.md) for the review workflow.

## CI access is a separate setup step

An approved human contributor's GitHub access does not grant access to GitHub
Actions. The current full-stack backend job cannot fetch private Relay with the
app repository's token. Maintainers still need to provision a dedicated, appropriately
scoped automation identity and a reviewed workflow that protects its credentials
from contributor-controlled code. Do not put a personal token in the workflow or
expose private-repository credentials to fork PRs. Until that setup is implemented
and verified, report the backend CI failure honestly. See [CI notes](CI.md).
