import React from 'react';
import { Dimensions, PixelRatio, StyleSheet } from 'react-native';
import { NativeBaseProvider } from '@gluestack-ui/themed-native-base';
import { fireEvent, render } from '@testing-library/react-native';
import WalletCreationChooser from '../../src/components/WalletCreationChooser';
import { customTheme } from '../../src/navigation/themes';
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

function enterRecoveryOptions(screen) {
  fireEvent.press(screen.getByTestId('primary-Add Wallet'));
  fireEvent.press(screen.getByTestId('wallet-choice-seedless'));
  fireEvent.press(screen.getByTestId('primary-Continue'));
  fireEvent.press(screen.getByTestId('preview-hardware-Coldcard'));
  fireEvent.press(screen.getByTestId('primary-Continue'));
  fireEvent.press(screen.getByTestId('preview-continue-simulation'));
  fireEvent.press(screen.getByTestId('primary-Review Policy'));
  fireEvent.press(screen.getByTestId('primary-Finish Preview'));
  fireEvent.press(screen.getByTestId('primary-Recovery Options'));
}

describe('Recoverable Wallet preview on a small screen', () => {
  beforeEach(() => {
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 1.6 });
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.6);
  });

  test('keeps security copy available, reaches one final review, and resumes after cancel', () => {
    const screen = render(<RecoverableWalletPreviewApp />);
    expect(screen.getByTestId('preview-add-wallet')).toHaveTextContent('No wallets yet');
    fireEvent.press(screen.getByTestId('primary-Add Wallet'));
    fireEvent.press(screen.getByTestId('wallet-choice-seedless'));
    expect(screen.getByTestId('preview-simulation-banner')).toHaveTextContent(
      'Simulated walkthrough'
    );
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
    expect(screen.getByTestId('wallet-creation-chooser')).toHaveTextContent('will resume');
    fireEvent.press(screen.getByTestId('wallet-choice-seedless'));
    expect(screen.getByTestId('preview-connect')).toHaveTextContent('Coldcard');
    fireEvent.press(screen.getByTestId('preview-continue-simulation'));
    fireEvent.press(screen.getByTestId('preview-inheritance-toggle'));
    fireEvent.press(screen.getByTestId('primary-Review Policy'));
    expect(screen.getByTestId('preview-review')).toHaveTextContent('Spending now · 2 of 3');
    expect(screen.getByTestId('preview-review')).toHaveTextContent(
      'designated second signer available without Server Key'
    );
    expect(screen.getByTestId('preview-review')).toHaveTextContent('fixed on-chain unlock date');
    fireEvent.press(screen.getByTestId('primary-Finish Preview'));
    expect(screen.getByTestId('preview-complete')).toHaveTextContent('No wallet was created');
    fireEvent.press(screen.getByTestId('preview-done'));
    expect(screen.getByTestId('wallet-creation-chooser')).toBeTruthy();
  });

  test('navigates the three-choice entry and keeps other paths simulated', () => {
    const screen = render(<RecoverableWalletPreviewApp />);
    fireEvent.press(screen.getByTestId('primary-Add Wallet'));
    const chooser = screen.getByTestId('wallet-creation-chooser');
    expect(chooser).toHaveTextContent('Simple Wallet');
    expect(chooser).toHaveTextContent('Seedless Wallet');
    expect(chooser).toHaveTextContent('Advanced Wallet');
    expect(chooser).toHaveTextContent('Your Keeper Recovery Key still matters');
    const seedlessTitle = screen.getByText('Seedless Wallet');
    expect(seedlessTitle.props.allowFontScaling).toBe(true);
    expect(seedlessTitle.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(seedlessTitle.props.style).lineHeight).toBeGreaterThan(25);

    fireEvent.press(screen.getByTestId('wallet-choice-simple'));
    expect(screen.getByTestId('preview-simple-wallet')).toHaveTextContent('Hot Wallet');
    expect(screen.getByTestId('preview-simple-wallet')).toHaveTextContent('Cold Wallet');
    fireEvent.press(screen.getByTestId('preview-choice-hot'));
    expect(screen.getByTestId('preview-hot-wallet')).toHaveTextContent('No key is generated');
    fireEvent.press(screen.getByTestId('preview-back'));
    fireEvent.press(screen.getByTestId('preview-choice-cold'));
    expect(screen.getByTestId('preview-cold-wallet')).toHaveTextContent('No device is connected');
    fireEvent.press(screen.getByTestId('preview-choose-another-wallet'));

    fireEvent.press(screen.getByTestId('wallet-choice-advanced'));
    expect(screen.getByTestId('preview-advanced-wallet')).toHaveTextContent(
      'Advanced Wallet creation is not connected'
    );
    fireEvent.press(screen.getByTestId('preview-back'));
    fireEvent.press(screen.getByTestId('wallet-choice-import'));
    expect(screen.getByTestId('preview-import-unavailable')).toHaveTextContent(
      'No existing wallet or key was accessed'
    );
    fireEvent.press(screen.getByTestId('preview-back'));
    fireEvent.press(screen.getByTestId('preview-back'));
    expect(screen.getByTestId('preview-add-wallet')).toHaveTextContent('No wallets yet');
  });

  test('the shared chooser hides Seedless Wallet unless the caller explicitly enables it', () => {
    const onSeedlessWallet = jest.fn();
    const screen = render(
      <NativeBaseProvider theme={customTheme}>
        <WalletCreationChooser
          onSimpleWallet={jest.fn()}
          onSeedlessWallet={onSeedlessWallet}
          onAdvancedWallet={jest.fn()}
          onImportWallet={jest.fn()}
        />
      </NativeBaseProvider>
    );
    expect(screen.queryByTestId('wallet-choice-seedless')).toBeNull();
    expect(onSeedlessWallet).not.toHaveBeenCalled();
  });

  test('shows separate cloud and contact options without claiming backup readback', () => {
    const screen = render(<RecoverableWalletPreviewApp />);
    enterRecoveryOptions(screen);
    expect(screen.getByTestId('preview-recovery-options')).toHaveTextContent(
      'No Mobile Key, encrypted cloud blob, contact credential, or server exchange exists'
    );
    fireEvent.press(screen.getByTestId('preview-recovery-cloud'));
    expect(screen.getByTestId('preview-cloud-backup')).toHaveTextContent('readback not verified');
    const readbackCopy = screen.getByText(/No encrypted Mobile Key was written or downloaded/);
    expect(readbackCopy.props.allowFontScaling).toBe(true);
    expect(StyleSheet.flatten(readbackCopy.props.style).lineHeight).toBeGreaterThan(23);
    fireEvent.press(screen.getByTestId('primary-Simulate Offline'));
    expect(screen.getByTestId('preview-cloud-offline')).toHaveTextContent(
      'No upload was attempted'
    );
    fireEvent.press(screen.getByTestId('preview-recovery-back'));
    fireEvent.press(screen.getByTestId('preview-recovery-contact'));
    expect(screen.getByTestId('preview-contact-offline')).toHaveTextContent(
      'Contact recovery cannot proceed'
    );
    fireEvent.press(screen.getByTestId('preview-back'));
    fireEvent.press(screen.getByTestId('preview-recovery-cloud'));
    fireEvent.press(screen.getByTestId('primary-Try Again'));
    expect(screen.getByTestId('preview-cloud-unverified')).toHaveTextContent(
      'READBACK NOT VERIFIED'
    );
    fireEvent.press(screen.getByTestId('preview-recovery-back'));
    fireEvent.press(screen.getByTestId('preview-recovery-contact'));
    expect(screen.getByTestId('preview-contact-blocked')).toHaveTextContent(
      'No invitation can be sent'
    );
  });

  test('samples invite and request decisions without an enrollment or restored key', () => {
    const screen = render(<RecoverableWalletPreviewApp />);
    enterRecoveryOptions(screen);
    fireEvent.press(screen.getByTestId('preview-recovery-contact'));
    fireEvent.press(screen.getByTestId('primary-Sample Invite'));
    expect(screen.getByTestId('preview-sample-invitation')).toHaveTextContent('not sent');
    fireEvent.press(screen.getByTestId('preview-invite-decline'));
    expect(screen.getByTestId('preview-invite-result')).toHaveTextContent('No credential');
    fireEvent.press(screen.getByTestId('preview-invite-reset'));
    fireEvent.press(screen.getByTestId('preview-invite-expire'));
    expect(screen.getByTestId('preview-invite-result')).toHaveTextContent('SIMULATED EXPIRY');
    fireEvent.press(screen.getByTestId('preview-invite-reset'));
    fireEvent.press(screen.getByTestId('primary-Simulate Approval'));
    expect(screen.getByTestId('preview-invite-result')).toHaveTextContent(
      'No credential was enrolled'
    );

    fireEvent.press(screen.getByTestId('preview-sample-request'));
    expect(screen.getByTestId('preview-sample-contact-request')).toHaveTextContent('not sent');
    fireEvent.press(screen.getByTestId('preview-request-decline'));
    expect(screen.getByTestId('preview-request-result')).toHaveTextContent(
      'No Mobile Key was restored'
    );
    fireEvent.press(screen.getByTestId('preview-request-reset'));
    fireEvent.press(screen.getByTestId('preview-request-expire'));
    expect(screen.getByTestId('preview-request-result')).toHaveTextContent('SIMULATED EXPIRY');
    fireEvent.press(screen.getByTestId('preview-request-reset'));
    fireEvent.press(screen.getByTestId('primary-Simulate Approval'));
    expect(screen.getByTestId('preview-request-result')).toHaveTextContent(
      'No response was encrypted or delivered, and no Mobile Key was restored'
    );
    fireEvent.press(screen.getByTestId('preview-back'));
    expect(screen.getByTestId('preview-recovery-options')).toBeTruthy();
    fireEvent.press(screen.getByTestId('preview-back'));
    expect(screen.getByTestId('preview-complete')).toBeTruthy();
  });
});
