## ADDED Requirements

### Requirement: Home tab content has an isolated lifecycle
The application SHALL remove the outgoing tab's native content when selecting
another Home tab and SHALL preserve visible, operable bottom navigation.

#### Scenario: Leave an empty Ask screen
- **GIVEN** Ask Keeper shows its existing suggested prompts and safety warning
- **WHEN** the user selects More, Wallets, or Keys
- **THEN** only the destination's content and header are shown
- **AND** Ask-only prompts and warning text are absent
- **AND** all four existing bottom tabs remain visible and tappable without restart.

#### Scenario: Repeated tab changes
- **GIVEN** an unlocked app on either supported platform
- **WHEN** the user repeatedly changes Ask → More → Ask → Wallets → Ask → Keys
- **THEN** each selected tab renders correctly and the footer remains available.

#### Scenario: Return from chat to history
- **GIVEN** an existing disposable Ask conversation
- **WHEN** the user opens it, returns to Ask history, and selects another main tab
- **THEN** history remains saved and only the selected tab is shown
- **AND** navigation remains usable, including subsequent re-entry to Ask.

#### Scenario: Recovery reminder and larger text
- **GIVEN** the existing Recovery Key reminder is visible or system text is enlarged
- **WHEN** the user switches between Ask and other main tabs
- **THEN** the reminder retains its existing behavior and bottom tabs remain reachable
- **AND** no security-critical copy is truncated to make the layout fit.

#### Scenario: Return through chat information with keyboard focus
- **GIVEN** an existing disposable Ask conversation
- **WHEN** the user opens and dismisses its disclaimer, opens About Ask Keeper,
  returns to chat, focuses the input, then goes back to history and another tab
- **THEN** the modal and keyboard do not cover the destination
- **AND** the saved conversation remains accessible and all Home tabs work.
