# Bitcoin Keeper Mobile - Maestro Automation

## Overview

This repository contains automation test scripts for the Bitcoin Keeper mobile application using the Maestro testing framework.

All automation flows are written in YAML format and executed on a real Android device.

---

## Tools Used

* Maestro Automation Framework
* Android Studio
* YAML
* Android Device (OnePlus 9R)

---
## Automated Test Flows

create_wallet_onboarding.yaml → Wallet onboarding

create_passcode.yaml → Passcode creation flow

import_wallet.yaml → Wallet import using recovery key

Mandatory_Backup.yaml → Backup verification flow

send.yaml → Bitcoin send transaction flow

receive.yaml → Bitcoin receive flow

refreshwallet.yaml → Wallet refresh flow

more.yaml → More tab functionality

add_singlesig_wallet.yaml → Add single signature wallet

collaborative_wallet.yaml → Collaborative wallet flow

forgot_passcode.yaml → Forgot passcode flow

concierge.yaml → Concierge support flow

---

## Project Structure

Automation scripts are located in the **flows** folder.

flows/

add_singlesig_wallet.yaml

collaborative_wallet.yaml

concierge.yaml

create_passcode.yaml

create_wallet_onboarding.yaml

forgot_passcode.yaml

import_wallet.yaml

Mandatory_Backup.yaml

more.yaml

receive.yaml

refreshwallet.yaml

send.yaml

Each YAML file represents a specific user flow in the application.

---

## Prerequisites

Before running automation tests ensure the following tools are installed:

* Node.js
* Maestro CLI
* Android Studio
* Android SDK
* A real Android device or emulator

---

## Connect Android Device

1. Connect your device via USB
2. Enable **Developer Options**
3. Enable **USB Debugging**

Verify connection using:

adb devices

Your device should appear in the list.

---

## Running Automation Tests

Run a specific flow using:

maestro test flows/file_name.yaml

Example:

maestro test flows/send.yaml

To launch the application:

maestro launch io.hexawallet.keeper.development

---

## Author

QA Automation - Bitcoin Keeper
