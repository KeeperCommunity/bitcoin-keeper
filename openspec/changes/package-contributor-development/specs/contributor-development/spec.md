## ADDED Requirements

### Requirement: Reviewable CI evidence
Contributor pull requests SHALL run app and local backend checks. App tests SHALL
produce an LCOV artifact for review. Deferred or unavailable security analysis
and failed checks SHALL NOT be reported as passing.

#### Scenario: Test completion
- **GIVEN** the existing network integration tests finish
- **WHEN** test teardown runs
- **THEN** test-owned connections close and Jest exits without a forced exit.

#### Scenario: External analysis deferred
- **GIVEN** the project owner's decision to defer SonarCloud
- **WHEN** the active workflow reports its results
- **THEN** tests and coverage remain available, documentation explicitly states that SonarCloud did not run, and maintainer security review remains required.

### Requirement: Repeatable local bootstrap
The contributor tooling SHALL fetch exact source revisions and validate local adapter digests before building isolated backend services.

#### Scenario: Fresh checkout
- **GIVEN** Git, Python, approved read access to the pinned private backend repositories and a running Docker/Compose engine
- **WHEN** the developer runs `dev up`
- **THEN** pinned sources are prepared, services become healthy and disposable API checks pass without production secrets.

#### Scenario: Existing developer edits
- **GIVEN** a previously prepared source tree or an existing app environment file
- **WHEN** setup runs again
- **THEN** developer edits are preserved and incompatible existing configuration produces actionable instructions without overwriting files.

### Requirement: Persistent isolated testnet services
The local backend SHALL publish only loopback ports, retain database and signing identities across restarts, and reject mainnet or hosted database configuration.

#### Scenario: Container recreation
- **GIVEN** a disposable app record and V3 testnet Server Key with valid 2FA
- **WHEN** the same Compose project is stopped and recreated without deleting volumes
- **THEN** the record and derived public key remain unchanged.

#### Scenario: Unsupported capability
- **GIVEN** the isolated local backend
- **WHEN** an unsupported integration is requested
- **THEN** the relay returns an explicit unavailable response and health reports disabled capabilities.

### Requirement: Native contributor workflow
The setup SHALL document native iOS and Android development steps separately from Docker.

#### Scenario: Android-only installation
- **GIVEN** a supported host with Node and Yarn
- **WHEN** JavaScript dependencies are installed
- **THEN** the install hook does not invoke CocoaPods or overwrite an Android SDK path.

#### Scenario: Native build
- **GIVEN** platform SDKs, locked dependencies and a generated local environment
- **WHEN** the documented development build runs with `ENVFILE=.env.local`
- **THEN** it produces the development app without requiring production release credentials.

### Requirement: Contributor access and maintainer acceptance
The repository SHALL document how outside developers can run, change, test and propose code without production credentials or repository write access. Keeper maintainers SHALL retain responsibility for security review, acceptance, merging and official releases.

#### Scenario: Repository readiness before invitations
- **GIVEN** a contributor approved for private development resources
- **WHEN** maintainers prepare to grant access
- **THEN** they first confirm source/history credential hygiene, required credential rotation, security/dependency review and reproducible setup; private visibility does not waive readiness.

#### Scenario: Private resource access
- **GIVEN** a contributor who needs private backend sources or other development resources
- **WHEN** they follow the documented access request process
- **THEN** maintainers review their GitHub profile, planned work and relevant context, decide approval and scope, and arrange the approved permissions with resource owners.
- **AND** the handoff records accepted invitations and setup results without treating a policy document as an actual access grant.

#### Scenario: Independent local work
- **GIVEN** public app code or approved access to private development resources
- **WHEN** a contributor makes local changes or runs local tests
- **THEN** no permission is required for each local action, while code acceptance and official releases remain with Keeper maintainers.

#### Scenario: External contribution
- **GIVEN** a developer with a fork and the documented local tools
- **WHEN** they prepare a change for review
- **THEN** the contribution guide identifies the OpenSpec workflow and relevant checks, and the PR template asks for passed, failed/blocked and untested results separately.

#### Scenario: Passing or unavailable automated checks
- **GIVEN** a submitted pull request
- **WHEN** its checks pass or a maintainer-managed service is unavailable to the fork
- **THEN** the documentation does not imply automatic approval; maintainers assess the code, security risks and remaining test evidence before accepting it.
