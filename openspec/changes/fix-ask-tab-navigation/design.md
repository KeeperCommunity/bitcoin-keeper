## Existing behavior and investigation

HomeScreen conditionally renders one content subtree inside a layout-only Box,
with MenuFooter as its sibling. Ask's empty and history components use native
Views and an absolutely positioned Fab with zIndex. Fabric can flatten these
layout-only ancestors. The repository also carries prior iOS mounting patches.
Native logs did not
identify the exact failing mount transaction; do not infer a proven upstream
renderer cause from this app-level reproduction alone.

Verified correction: retain a native, non-collapsing content boundary for the
selected tab,
with explicit tab identity, so outgoing native descendants are removed together
and cannot share the footer's native parent. The same flow failed before and
passed after this change, with the same
disposable wallet state. See verification.md for device results and build limits.

## Design and data constraints

Read DESIGN.md: preserve its App shell, Bottom navigation, Spacing and
Accessibility rules. Reuse HomeScreenHeader, MenuFooter, existing hp/wp spacing,
colors and typography. No new visible components, assets, strings or screens.
No Redux slice/saga edits, Realm schema/MMKV keys, or persist version migration.
No PSBT, transaction, recovery or hardware interaction.

## Affected files and verification

- src/screens/Home/HomeScreen.tsx: verified native tab boundary.
- src/components/MenuFooter.tsx: stable selectors for the existing four tabs.
- flows/ask-tab-navigation.yaml: repeated empty-state switching.
- flows/ask-history-navigation.yaml: existing-chat/back/tab regression.
- This OpenSpec package: results and remaining device limits.

Native screenshots and assertions must check both absence of outgoing Ask text
and presence/operability of tabs. A React-only pass is insufficient. Distinguish
the user's physical iPhone 15 Pro Max evidence from simulator and emulator checks.
Test a smaller iPhone and larger text where available. Store only disposable QA
data in evidence; never commit user screenshots or wallet secrets without need.

## Android activity recreation follow-up

Fresh release testing on 28 September reproduced a native crash when the system
font scale changed: Android attempted to restore a ScreenStackFragment without
React Native owning its screen state. Register the installed react-native-screens
4.24.0 RNScreensFragmentFactory in MainActivity before super.onCreate, as required
by that version's Android setup instructions. Preserve the existing insets setup.
This is native screen-lifecycle handling only; no wallet storage or authentication
change. Recheck activity recreation, unlock/state retention and Ask navigation.
