import React from 'react';
import { AppState } from 'react-native';
import { act, render } from '@testing-library/react-native';
import PinCooldownMessage from 'src/components/AppPinInput/PinCooldownMessage';

jest.mock('src/components/KeeperText', () => {
  const { Text } = require('react-native');
  return ({ children }) => <Text>{children}</Text>;
});

jest.mock('src/context/Localization/LocContext', () => {
  const { createContext } = require('react');
  return {
    LocalizationContext: createContext({
      translations: {
        login: { retryPasscodeIn: 'Please try again in {0}.' },
        formatString: (template, value) => template.replace('{0}', value),
      },
    }),
  };
});

describe('PinCooldownMessage', () => {
  const lastFailure = 1000000;
  let onAppStateChange;
  let removeSubscription;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(lastFailure + 28000);
    removeSubscription = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      onAppStateChange = listener;
      return { remove: removeSubscription };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const renderMessage = () =>
    render(
      <PinCooldownMessage
        failedAttempts={1}
        lastLoginFailedAt={lastFailure}
        color="red"
        style={{}}
      />
    );

  test('displays actual remaining time and updates every second', () => {
    const { getByText, unmount } = renderMessage();
    expect(getByText('Please try again in 4:32.')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1000));
    expect(getByText('Please try again in 4:31.')).toBeTruthy();
    unmount();
  });

  test('refreshes from wall-clock time immediately when returning from background', () => {
    const { getByText, unmount } = renderMessage();
    act(() => {
      jest.setSystemTime(lastFailure + 128000);
      onAppStateChange('active');
    });
    expect(getByText('Please try again in 2:52.')).toBeTruthy();
    unmount();
  });

  test('updates when a different cooldown is supplied', () => {
    const { getByText, rerender, unmount } = renderMessage();
    rerender(
      <PinCooldownMessage
        failedAttempts={2}
        lastLoginFailedAt={lastFailure}
        color="red"
        style={{}}
      />
    );
    expect(getByText('Please try again in 14:32.')).toBeTruthy();
    unmount();
  });

  test('removes its timer and app-state subscription on unmount', () => {
    const { unmount } = renderMessage();
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });
});
