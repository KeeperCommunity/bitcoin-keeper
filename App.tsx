import { LogBox, Platform, UIManager } from 'react-native';
import React, { ReactElement, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'native-base';
import { PersistGate } from 'redux-persist/integration/react';
import { Provider } from 'react-redux';
import { withIAPContext, initConnection, endConnection } from 'react-native-iap';
import { TorContextProvider } from 'src/context/TorContext';
import { HCESessionProvider } from 'react-native-hce';
import { LocalizationProvider } from 'src/context/Localization/LocContext';
import { AppContextProvider } from 'src/context/AppContext';
import config from 'src/utils/service-utilities/config';
import Navigator from './src/navigation/Navigator';
import { persistor, store } from './src/store/store';
import NotificationHandler from 'src/hooks/useNotificationHandler';
import { SentryWrapper } from 'src/services/sentry';
import ThemeContextProvider from 'src/context/ThemeContext';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

LogBox.ignoreLogs([
  "[react-native-gesture-handler] Seems like you're using an old API with gesture components, check out new Gestures system!",
  /\b{$Require cycle}\b/gi,
  'Warning: ...',
  /.+/s,
]);

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

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
      <ThemeContextProvider>
        <NotificationHandler />
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <LocalizationProvider>
          <AppContextProvider>
            <TorContextProvider>
              <AndroidProvider>
                <BottomSheetModalProvider>
                  <Navigator />
                </BottomSheetModalProvider>
              </AndroidProvider>
            </TorContextProvider>
          </AppContextProvider>
        </LocalizationProvider>
      </ThemeContextProvider>
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

export default withIAPContext(SentryApp);
