# Contributor access

Anyone can fork the public app, make local changes, run available tests and submit
pull requests without Keeper's permission. Contributors with access to the
required backend sources can also run and modify their local Docker services
without approval for each command or change.

## Request private development resources

The packaged Docker setup requires read access to both private repositories:

- `KeeperCommunity/bitcoin-keeper-relay`
- `bithyve/SigningServer`

Open a [contributor access request](https://github.com/KeeperCommunity/bitcoin-keeper/issues/new?template=contributor-access.md)
with your GitHub username/profile, the work you want to do, and the repositories
or other development resources you need. Link an issue and relevant contributions
if available; prior contributions are useful context, not a mandatory threshold.
The request is public: include no credentials or private project details. If the
work is confidential, use your existing private contact with a Keeper maintainer.

Keeper maintainers review the GitHub profile, proposed work and other relevant
context, decide whether to approve the contributor, and identify the resources
and permissions needed. Approval is for development access, not individual local
edits. Additional resources can be requested as the work expands.

## Maintainer handoff

1. Review the request and record the decision and approved resource scope.
2. Ask an owner of each private repository to grant the approved GitHub account
   access. Read access is sufficient for this Docker bootstrap. Approve additional
   development permissions when the contribution needs them.
3. The contributor accepts the invitations and authenticates Git on their own
   machine using their own GitHub identity. Do not share a maintainer's account or
   token. They can check read access without modifying anything:

   ```sh
   git ls-remote https://github.com/KeeperCommunity/bitcoin-keeper-relay.git HEAD
   git ls-remote https://github.com/bithyve/SigningServer.git HEAD
   ```

4. The contributor follows the [setup guide](README.md), runs `dev up` and the
   documented checks, and reports the result. Record when access and setup are
   confirmed; an approved request alone does not prove invitations were accepted
   or the environment works.

No specific contributor has been granted access by adding these instructions.
Repository visibility remains private. This document does not configure GitHub
teams, invitations or permission rules.

## Code acceptance and official releases

Contributors can experiment locally and propose changes freely. Keeper maintains
responsibility for code acceptance, security review, merges and official releases.
Development access does not automatically grant those responsibilities or access
to production systems, release keys or store accounts. See
[Contributing](../../CONTRIBUTING.md) for the review workflow.

## CI access is a separate setup step

An approved human contributor's GitHub access does not grant access to GitHub
Actions. The current backend job cannot fetch the private sources with the app
repository's token. Maintainers still need to provision a dedicated, appropriately
scoped automation identity and a reviewed workflow that protects its credentials
from contributor-controlled code. Do not put a personal token in the workflow or
expose private-repository credentials to fork PRs. Until that setup is implemented
and verified, report the backend CI failure honestly. See [CI notes](CI.md).
