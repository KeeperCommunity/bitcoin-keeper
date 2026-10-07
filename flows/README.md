# Maestro E2E Automation

This directory contains end-to-end UI automation flows for the Keeper app using Maestro.

## USDT Settings route smoke check

`usdt-settings-routes.yaml` starts on Home in an authenticated, disposable development app on TESTNET. It checks Settings > Keys & Wallets > Add USDT Wallet, opens the creation form and the seed import form, and returns without submitting either form. It does not create wallets or make transaction, recovery or backup requests.

```bash
maestro --udid <disposable-device-id> test flows/usdt-settings-routes.yaml
```

The default app ID is `io.hexawallet.hexakeeper.dev`; override it with `-e APP_ID=<installed-development-app-id>` when testing a different development package. Do not run against a funded/customer profile. Production USDT entry uses MAINNET; this smoke flow is intended for the development TESTNET fixture.

## Instructions

Use these flows to validate onboarding, wallet, RGB assets, settings, backup, and recovery journeys on development builds.

Before running tests:
- Make sure the app is built and installed on your target device/emulator.
- Use the dev app id expected by flows: `io.hexawallet.keeper`.
- Run from repository root unless noted otherwise.

## Installation

### Prerequisites

- Node.js `>=20`
- Android emulator or iOS simulator (or physical device)
- Tribe app installed with dev flavor

### Install Maestro CLI

Use one of the following:

```bash
brew install maestro
```

or

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Verify installation:

```bash
maestro --version
```

## How To Use

### 1. Start your device and app

From repo root, run one of:

```bash
npm run androidDevDebug
```

or

```bash
npm run ios
```

### 2. Run a full regression flow

```bash
npm run maestro:test:regression-dev
```

### 3. Run a single flow directly

```bash
maestro test flows/addwallet.yaml
```

### 4. Run with verbose logs (useful for debugging)

```bash
maestro test --verbose flows/refreshwallet.yaml
```

### 5. Use Maestro MCP server in VS Code

This workspace includes MCP server config in `.vscode/mcp.json`.

Configured server:
- server name: `maestro`
- type: `stdio`
- command: `maestro`
- args: `["mcp"]`

MCP usage workflow in chat:

1. Ask the agent to list devices.
2. Ask the agent to inspect the current screen.
3. Ask the agent to run one flow and report failures.
4. Ask the agent to update selectors/assertions and re-run.

Example prompts:
- "List Maestro devices and inspect the app screen."
- "Run flows/dustSanity.yaml and summarize failures."
- "Update flows/dustSanity.yaml selectors for the current UI and run again."

Optional cloud execution with MCP:

When local devices are unavailable, use MCP cloud tools:
- `list_cloud_devices`
- `run_on_cloud`
- `get_cloud_run_status`

Authenticate first with:

```bash
maestro login
```

## Folder Structure

```text
flows/
├── addNewKey.yaml
├── addwallet.yaml
├── appsettings.yaml
├── buyBTC.yaml
├── copywalletaddress.yaml
├── editwallet.yaml
├── editwalletdetails.yaml
├── exportseed.yaml
├── healthCheckKey.yaml
├── hidendeletekey.yaml
├── keySetting.yaml
├── login.yaml
├── newapp.yaml
├── receive.yaml
├── receivesats.yaml
├── refreshwallet.yaml
├── sanity.yaml
├── send.yaml
├── setpin.yaml
├── subscription.yaml
├── support_chat.yaml
├── versionhistory.yaml
├── viewwallet.yaml
└── walletSetting.yaml
```

## Commands

### Existing npm script

```bash
npm run maestro:test:regression
```

Runs:

```bash
maestro test flows/refreshwallet.yaml
```

### Useful direct commands

Run add wallet flow:

```bash
maestro test flows/addwallet.yaml
```

## Notes

- If tests fail due to timing, retry with `--verbose` and inspect the exact step that failed.
