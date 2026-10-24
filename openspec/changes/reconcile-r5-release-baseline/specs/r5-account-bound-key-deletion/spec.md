## ADDED Requirements

### Requirement: Key deletion confirmation retains account ownership

DeleteKeys SHALL authorize deletion or archived retention of a Signer only in the
same KeeperApp account/session in which its current one-use confirmation began.
All active Vault references remain blocking. No satoshi amount or UTXO changes.

#### Scenario: Current account deletes an unused key
- **GIVEN** an unused visible Signer selected in account A and its current session
- **WHEN** its passcode confirmation succeeds and A/Realm/session still match
- **THEN** one delete action carries that original app/session; the Delete CTA is
  discoverable without Hide and R4's transaction performs its own reference check

#### Scenario: Old confirmation survives an account round trip
- **GIVEN** a Signer confirmation from A, followed by A → B → A without a rerender
- **WHEN** the earlier passcode callback completes
- **THEN** no delete/archive action is dispatched and the old confirmation closes

#### Scenario: Realm and Redux disagree
- **GIVEN** Redux names A while the current Realm KeeperApp belongs to B or is unreadable
- **WHEN** a key selection or confirmation is attempted
- **THEN** no delete/archive action is dispatched; native UI SHALL not report success

#### Scenario: A retained callback tries a newer account's key card
- **GIVEN** a key-card callback captured in A before account/session changed
- **WHEN** it is invoked after the transition
- **THEN** it cannot open a new actionable deletion confirmation in the new account

#### Scenario: Referenced and archived keys remain protected offline
- **GIVEN** a Signer with a live active or archived Vault reference and unavailable network
- **WHEN** its current account confirms a deletion attempt
- **THEN** active references block it and archived references retain the Signer;
  cancellation and repeated callbacks cannot produce a second destructive action

### Requirement: First-use callbacks retain their account session

Existing setup and notification callbacks SHALL not dispatch or navigate after
their original account session changes, even if the screen remains mounted.

#### Scenario: Token completes after an account round trip
- **GIVEN** setup or its post-success token update pending in session A
- **WHEN** the account changes A → B → A and the token resolves or rejects
- **THEN** no old setup/token action is dispatched into the new session

#### Scenario: Delayed navigation belongs to an old session
- **GIVEN** a recreated-app or Next navigation timer scheduled in session A
- **WHEN** the account session changes before the delay ends
- **THEN** it does not navigate over the current account's screen
