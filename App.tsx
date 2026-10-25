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
import { observeStartupBoundary, withStartupBoundary } from 'src/utils/startup-boundary-observer';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

LogBox.ignoreLogs([
  "[react-native-gesture-handler] Seems like you're using an old API with gesture components, check out new Gestures system!",
  /\b{$Require cycle}\b/gi,
  'Warning: ...',
  /.+/s,
]);

function AndroidProvider({ children }: { children: ReactElement }) {
  useEffect(() => {
    observeStartupBoundary('HCE_WRAPPER_COMMITTED');
  }, []);
  return Platform.OS === 'android' ? (
    <HCESessionProvider>
      {withStartupBoundary(children, 'HCE_CHILDREN_RENDERED', 'HCE_CHILDREN_COMMITTED')}
    </HCESessionProvider>
  ) : (
    children
  );
}

function App() {
  observeStartupBoundary('APP_RENDERED');
  useEffect(() => {
    observeStartupBoundary('APP_COMMITTED');
    // Billing is optional at startup; the IAP adapter already logs failures.
    initConnection().catch(() => undefined);
    return () => {
      endConnection().catch(() => undefined);
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {withStartupBoundary(
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
          </ThemeContextProvider>,
          'SAFE_AREA_CHILDREN_RENDERED',
          'SAFE_AREA_CHILDREN_COMMITTED'
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppWrapper() {
  observeStartupBoundary('ROOT_WRAPPER_RENDERED');
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
