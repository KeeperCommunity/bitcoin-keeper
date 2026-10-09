import { LogBox, Platform } from 'react-native';
import React, { ReactElement, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from '@gluestack-ui/themed-native-base';
import { PersistGate } from 'redux-persist/integration/react';
import { Provider } from 'react-redux';
import { initConnection, endConnection } from 'react-native-iap';
import { TorContextProvider } from 'src/context/TorContext';
import { HCESessionProvider } from 'react-native-hce';
import { LocalizationProvider } from 'src/context/Localization/LocContext';
import { AppContextProvider } from 'src/context/AppContext';
import Navigator from './src/navigation/Navigator';
import { persistor, store } from './src/store/store';
import NotificationHandler from 'src/hooks/useNotificationHandler';
import { SentryWrapper } from 'src/services/sentry';
import ThemeContextProvider from 'src/context/ThemeContext';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

LogBox.ignoreLogs([
  "[react-native-gesture-handler] Seems like you're using an old API with gesture components, check out new Gestures system!",
  /\b{$Require cycle}\b/gi,
  'Warning: ...',
  /.+/s,
]);

function AndroidProvider({ children }: { children: ReactElement }) {
  return Platform.OS === 'android' ? <HCESessionProvider>{children}</HCESessionProvider> : children;
}

function App() {
  useEffect(() => {
    initConnection();
    return () => {
      endConnection();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeContextProvider>
          <NotificationHandler />
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
          <LocalizationProvider>
            <AppContextProvider>
              <TorContextProvider>
                <AndroidProvider>
                  <Navigator />
                </AndroidProvider>
              </TorContextProvider>
            </AppContextProvider>
          </LocalizationProvider>
        </ThemeContextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppWrapper() {
  return (
    <PersistGate persistor={persistor} loading={null}>
      <Provider store={store}>
        <App />
      </Provider>
    </PersistGate>
  );
}

const SentryApp = SentryWrapper(AppWrapper);

export default SentryApp;
