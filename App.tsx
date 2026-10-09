import React from 'react';
import { Text, View } from 'react-native';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import RecoverableWalletPreviewApp from './src/preview/recoverable-wallet/RecoverableWalletPreviewApp';
import { getPreviewRuntime } from './src/preview/recoverable-wallet/previewRuntime';

function App() {
  const mode = getPreviewRuntime(
    NativeConfig.KEEPER_PREVIEW,
    DeviceInfo.getBundleId(),
    NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY
  );

  if (mode === 'misconfigured') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text accessibilityRole="alert">
          This Keeper Preview build is misconfigured. No wallet features are available.
        </Text>
      </View>
    );
  }

  if (mode === 'preview') {
    return <RecoverableWalletPreviewApp />;
  }

  // Keep the shipping app's providers and services out of the preview runtime.
  const ProductionApp = require('./ProductionApp').default;
  return <ProductionApp />;
}

export default App;
