# Bitcoin Keeper

Bitcoin Keeper is a **fully open-source, non-custodial Bitcoin multisig wallet**, designed to help individuals and families securely self-custody bitcoin without lock-ins, proprietary formats, or dependency on a single company.

This repository is the **canonical home of Bitcoin Keeper** and is maintained as a **community-led project**.

![image](https://github.com/user-attachments/assets/77c58e40-0172-4f73-aeb9-8a7851eb43eb)

<p align="center">
  <a href="https://play.google.com/store/apps/details?id=io.hexawallet.bitcoinkeeper">
    <img src="https://bitcoinkeeper.app/wp-content/uploads/2025/02/Google-Play.svg" alt="Playstore" width="150"/>
  </a>

  <a href="https://apps.apple.com/us/app/bitcoin-keeper/id1545535925">
    <img src="https://bitcoinkeeper.app/wp-content/uploads/2025/02/App-Store.svg" alt="Appstore" width="150"/>
  </a>

  <a href="https://github.com/bithyve/bitcoin-keeper/releases">
    <img src="https://github.com/bithyve/bitcoin-keeper/assets/50690016/67693cf0-a059-4391-8b48-a9d46a55e71c" alt="PGP_APK" width="150"/>
  </a>
</p>


## ✨ Features
Create and manage *Bitcoin multisig wallets
Hardware wallet support for multisig setups
Recovery planning and inheritance-friendly structures
No custody of keys or funds
Fully interoperable with standard Bitcoin wallets and tools
No proprietary formats or walled gardens
All features are **free to use**. There are no subscriptions or paid tiers.

## 🚧 Project Status
Bitcoin Keeper is maintained openly by independent contributors.
Ongoing development and maintenance are supported by **grants and optional user tips**, allowing the project to remain independent, resilient, and aligned with its original principles.
The wallet is built so that users can always move their keys and funds elsewhere, regardless of the project’s future.


## 🧩 Prerequisites

Before getting started, make sure you have a proper [React Native development environment](https://reactnative.dev/docs/environment-setup) on your machine

To run or build Bitcoin Keeper locally, you will need:
Node.js
Yarn or npm
Android Studio (for Android builds)
Xcode (for iOS builds)
Refer to platform-specific documentation for detailed setup requirements.

## 🚀 Getting Started

1. Clone this repository to your local machine:

   ```shell
   git clone https://github.com/KeeperCommunity/bitcoin-keeper.git
   ```

2. Navigate to the project directory:
   ```shell
   cd bitcoin-keeper
   ```
3. Install the project dependencies using Yarn:
   The prepare scripts will automatically install pods and nodify crypto-related packages for react-native
   ```shell
   yarn install
   ```

## 🛠️ Build and Run

### 🧪 Varients

The project has testnet and mainnet variants. The development variant is configured to use testnet and the production variant to use mainnet.

Start metro metro

```bash
yarn start
```

#### 🧑‍💻 Development

To run the development app on a connected device or emulator:

**Android**

```bash
yarn androidDevelopmentDebug
```

**iOS**

```bash
yarn ios --scheme=hexa_keeper_dev
```

#### 🏭 Production

To run the production app on a connected device or emulator:

**Android**

```bash
yarn androidProductionDebug
```

**iOS**

```bash
yarn ios --scheme=hexa_keeper
```

These commands will build and launch the app on the respective platforms.

## 🔐 PGP

```bash
389F 4CAD A078 5AC0 E28A 0C18 1BEB DE26 1DC3 CF62
```

## 🛡️ Verify Authenticity of Android APK

Please download an [APK](https://github.com/bithyve/bitcoin-keeper/releases) and keep all these files in the same directory: `Android APK file, SHA256SUM.asc, KEEPER_DETACHED_SIGN.sign`. Make a copy of `Android APK file` and rename it as `Android APK clone`.

Get the public PGP key for `hexa@bithyve.com` (Hexa Team's PGP key) using

```
gpg --recv-key "389F 4CAD A078 5AC0 E28A 0C18 1BEB DE26 1DC3 CF62"
```

or

```
gpg --keyserver hkps://keys.openpgp.org --recv-key "389F 4CAD A078 5AC0 E28A 0C18 1BEB DE26 1DC3 CF62"
```

**Verify APK checksum**

Verify the checksum against the APK using:

```
shasum -a 256 --check SHA256SUM.asc
```

Output should contain the name of the APK file followed by **OK** as shown below:

```
Bitcoin_Keeper_v2.0.0.apk: OK
```

**Verify that the signed checksum is from hexa@bithyve.com**

```
gpg --verify SHA256SUM.asc
```

Output should show Hexa's PGP key **389F 4CAD A078 5AC0 E28A 0C18 1BEB DE26 1DC3 CF62**:

```
using RSA key 389F4CADA0785AC0E28A0C181BEBDE261DC3CF62
issuer "hexa@bithyve.com"
Good signature from "Hexa Team (Hexa Bitcoin Wallet) <hexa@bithyve.com>"
```

**Alternate method for verifying PGP signature**

Verify the detached signature against the APK file:

```
gpg --verify KEEPER_DETACHED_SIGN.sign Bitcoin_Keeper_Beta_v1.1.8.apk
```

Output should show PGP key **389F 4CAD A078 5AC0 E28A 0C18 1BEB DE26 1DC3 CF62**:

```
using RSA key 389F4CADA0785AC0E28A0C181BEBDE261DC3CF62
issuer "hexa@bithyve.com"
Good signature from "Hexa Team (Hexa Bitcoin Wallet) <hexa@bithyve.com>"
```

## 🧪 Testing

This project uses **Jest** as the testing framework. To run the tests, use the following command:

```bash
yarn test
```

## 📄 License

This project is licensed under the **MIT License.**

## 🌍 Community

- Follow us on [Twitter](https://twitter.com/bitcoinKeeper_)
- Join our [Telegram](https://t.me/bitcoinkeeper)

