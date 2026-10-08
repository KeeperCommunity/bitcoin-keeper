# Native preview packaging (milestone 1)

The preview runs the simulated Recoverable Wallet flow only. It creates no wallet, has no signing or recovery protocol, and cannot reach Keeper's production server endpoints from its checked-in configuration.

| Platform | Preview identity | Build entry | Storage/cloud boundary |
| --- | --- | --- | --- |
| Android | `io.hexawallet.keeper.recoverablepreview` | `yarn androidRecoverablePreview` / `:app:assembleRecoverablePreviewDebug` | Separate Android app sandbox and Keystore namespace. The native `CloudBackup` module is not registered, Google Drive sign-in is unavailable, and the flavor has a local-only placeholder Firebase configuration. No production backup or app links are registered. |
| iOS | `io.hexawallet.hexakeeper.recoverablepreview` | `yarn iosRecoverablePreview` / `hexa_keeper_recoverable_preview` scheme | Separate app sandbox and default Keychain access group. Preview entitlements contain no iCloud, associated domains or push capability. Preview build settings skip Firebase configuration and include a build phase to remove the development `GoogleService-Info.plist`. The simulator build is still unverified. |

Both builds use the checked-in `.env.recoverable-preview` file. It sets `KEEPER_PREVIEW=true`, `KEEPER_PREVIEW_TESTNET_ONLY=true` and local unreachable service URLs. The preview entry also checks the exact native bundle/application ID before showing the flow; mismatches show a locked error screen. The preview runtime does not initialize the normal Keeper app or its wallet store.

## Build and install

From the repository root after installing JS dependencies:

```sh
yarn androidRecoverablePreview
yarn iosRecoverablePreview
```

For an Android APK without launching an emulator:

```sh
cd android
ENVFILE=.env.recoverable-preview ./gradlew :app:assembleRecoverablePreviewDebug
```

For a smaller Android device APK, use `-PkeeperPreviewAbis=arm64-v8a -PreactNativeArchitectures=arm64-v8a` with that Gradle command. The default flavor retains all four configured ABIs.

The local verification worktree shared `node_modules` through a symlink. Metro required a temporary symlink watch-folder setting for that build; it was removed afterward. A normal dependency installation in this checkout avoids that local workaround.

The Android package must be installed alongside production Keeper and verified on a device before calling the milestone device-tested. The iOS scheme is configured for the simulator, but a simulator build has not yet completed. A signed physical-device build requires an Apple App ID and provisioning profile for `io.hexawallet.hexakeeper.recoverablepreview`; distribution access must be checked with the Keeper team. Neither cloud backup nor a physical hardware connection is claimed by this milestone.

Local Android emulator verification on 8 October 2026: the arm64 APK installed, launched from its embedded JavaScript bundle, and completed the simulated walkthrough at 320dp width with 1.6× system text. The emulator already had `io.hexawallet.keeper.development` installed; both package IDs remained distinct. The error, inheritance, review, and completion controls were reachable by scrolling. Physical-device installation, production Keeper co-installation, and real storage/keychain separation still require device checks.

Before future cloud backup work, register a dedicated iCloud container for the preview App ID and dedicated Google OAuth/Drive credentials. Keep access disabled until read-back and cross-app isolation are verified on real devices. Do not reuse Keeper's production or development cloud identities.

## Native checks

1. Confirm production Keeper and Keeper Preview install simultaneously without replacing each other.
2. Confirm the preview icon/name is `Keeper Preview`, has no production deep link/backup intent, and starts directly in the simulated flow.
3. Check iOS Keychain and Android app data remain inaccessible to the other app. On iOS, inspect the signed preview entitlements; they must contain no production iCloud or Keychain group.
4. Confirm both preview backends use only local unreachable URLs and the UI has no mainnet control, wallet creation, signing, or cloud-backup action.
5. Uninstall Preview and confirm production Keeper and its wallet/backups remain intact.
