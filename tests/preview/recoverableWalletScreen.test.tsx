import React from 'react';
import { Dimensions, PixelRatio, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import RecoverableWalletPreviewApp from '../../src/preview/recoverable-wallet/RecoverableWalletPreviewApp';

jest.mock('src/components/ScreenWrapper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => <>{children}</>,
    initialWindowMetrics: { insets: { top: 0, right: 0, bottom: 0, left: 0 } },
  };
});

jest.mock('src/components/KeeperText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ children, ...props }) => <Text {...props}>{children}</Text>;
});

describe('Recoverable Wallet preview on a small screen', () => {
  beforeEach(() => {
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 1.6 });
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.6);
  });

  test('keeps security copy available, reaches one final review, and resumes after cancel', () => {
    const screen = render(<RecoverableWalletPreviewApp />);
    expect(screen.getByTestId('preview-simulation-banner')).toHaveTextContent(
      'Simulated walkthrough'
    );
    fireEvent.press(screen.getByTestId('primary-Start Preview'));
    expect(screen.getByTestId('preview-automatic')).toHaveTextContent(
      'No key material has been generated'
    );
    const serverWarning = screen.getByText(/Keeper cannot spend your bitcoin with this key alone/);
    expect(serverWarning.props.allowFontScaling).toBe(true);
    expect(StyleSheet.flatten(serverWarning.props.style).lineHeight).toBeGreaterThan(23);
    const primaryLabel = screen.getByText('Continue');
    expect(primaryLabel.props.allowFontScaling).toBe(true);
    expect(primaryLabel.props.numberOfLines).toBeUndefined();
    fireEvent.press(screen.getByTestId('primary-Continue'));
    expect(screen.getByTestId('primary-Continue').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('preview-hardware-Coldcard'));
    fireEvent.press(screen.getByTestId('primary-Continue'));
    fireEvent.press(screen.getByTestId('primary-Simulate Error'));
    expect(screen.getByTestId('preview-connection-error')).toHaveTextContent(
      'No hardware was accessed'
    );
    fireEvent.press(screen.getByTestId('primary-Simulate Error'));
    expect(screen.getByTestId('preview-connection-error')).toHaveTextContent('Simulated error 2');
    fireEvent.press(screen.getByTestId('preview-cancel'));
    fireEvent.press(screen.getByTestId('primary-Resume'));
    expect(screen.getByTestId('preview-connect')).toHaveTextContent('Coldcard');
    fireEvent.press(screen.getByTestId('preview-continue-simulation'));
    fireEvent.press(screen.getByTestId('preview-inheritance-toggle'));
    fireEvent.press(screen.getByTestId('primary-Review Policy'));
    expect(screen.getByTestId('preview-review')).toHaveTextContent('Spending now · 2 of 3');
    expect(screen.getByTestId('preview-review')).toHaveTextContent(
      'Inheritance Key and any eligible original signer'
    );
    fireEvent.press(screen.getByTestId('primary-Finish Preview'));
    expect(screen.getByTestId('preview-complete')).toHaveTextContent('No wallet was created');
  });
});
