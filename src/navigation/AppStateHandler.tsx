import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { setHasDeepLink } from 'src/store/reducers/login';
import { autoSyncWallets } from 'src/store/sagaActions/wallets';

const PASSCODE_TIMEOUT = 5 * 60 * 1000;

const AppStateHandler = () => {
  const navigation = useNavigation();
  const [appState, setAppState] = useState(AppState.currentState);
  const [lastBackgroundTime, setLastBackgroundTime] = useState(null);
  const dispatch = useDispatch();
  const triggeredDeepLink = useRef<string | null>(null);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => {
      if (event.url) triggeredDeepLink.current = event.url;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (appState === 'active' && nextAppState.match(/inactive|background/)) {
        setLastBackgroundTime(Date.now());
      } else if (appState.match(/inactive|background/) && nextAppState === 'active') {
        // App is coming to the foreground, check elapsed time
        const state = navigation.getState();
        const activeRoute = state?.routes[state.index];
        const notLoginStack = activeRoute?.name !== 'LoginStack';
        const timedOut = lastBackgroundTime && Date.now() - lastBackgroundTime > PASSCODE_TIMEOUT;

        if (notLoginStack && timedOut) {
          dispatch(setHasDeepLink(triggeredDeepLink.current));
          triggeredDeepLink.current = null;
          navigation.reset({
            index: 0,
            routes: [
              {
                name: 'LoginStack',
                state: {
                  routes: [{ name: 'Login', params: { fromBackground: true } }],
                },
              },
            ],
          });
        } else if (activeRoute?.name === 'App') {
          // The transient login.isAuthenticated flag is cleared after unlock.
          // Only an active, unlocked app session should poll archived Vaults.
          const childState = activeRoute.state;
          const childRoute = childState?.routes[childState.index || 0];
          if (childRoute?.name !== 'Login') {
            dispatch(autoSyncWallets(false, false, false, undefined, true));
          }
        }
      }
      setAppState(nextAppState);
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [appState, lastBackgroundTime, navigation]);

  return null;
};

export default AppStateHandler;
