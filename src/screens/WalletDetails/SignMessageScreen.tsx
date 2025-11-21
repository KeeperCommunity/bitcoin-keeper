import { Box, Input, KeyboardAvoidingView, ScrollView, useColorMode } from 'native-base';
import React, { useContext, useState } from 'react';
import { StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Colors } from 'react-native/Libraries/NewAppScreen';
import Buttons from 'src/components/Buttons';
import KeeperTextInput from 'src/components/KeeperTextInput';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useIsSmallDevices from 'src/hooks/useSmallDevices';
import useToastMessage from 'src/hooks/useToastMessage';
import KeeperModal from 'src/components/KeeperModal';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { useAppSelector } from 'src/store/hooks';
import WalletOperations from 'src/services/wallets/operations';
import useWallets from 'src/hooks/useWallets';
import { useDispatch } from 'react-redux';
import { refreshWallets } from 'src/store/sagaActions/wallets';
import useVault from 'src/hooks/useVault';
import { EntityKind, KeyGenerationMode } from 'src/services/wallets/enums';
import ShowXPub from 'src/components/XPub/ShowXPub';
import { CommonActions } from '@react-navigation/native';
import { InteracationMode } from '../Vault/HardwareModalMap';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import QRComms from 'src/assets/images/qr_comms.svg';
import ImportIcon from 'src/assets/images/import.svg';
import Text from 'src/components/KeeperText';
import { exportFile, importFile } from 'src/services/fs';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';

const MEDIUM_MODES = {
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
};

export const SignMessageScreen = ({ route, navigation }) => {
  const { walletId = null, vaultId = null, type } = route.params;
  const wallet = useWallets({ walletIds: [walletId] }).wallets[0];
  const { activeVault } = useVault({ vaultId: vaultId ?? '' });
  const { xpriv, addresses } = wallet.specs;
  const receiveAddressCache = addresses?.external;
  const { colorMode } = useColorMode();
  const [message, setMessage] = useState('');
  const [address, setAddress] = useState('');
  const [signature, setSignature] = useState('');
  const [verifiedModal, setVerifiedModal] = useState(false);
  const isSmallDevice = useIsSmallDevices();
  const {
    common,
    wallet: walletText,
    error: errorText,
  } = useContext(LocalizationContext).translations;
  const { showToast } = useToastMessage();
  const { bitcoinNetwork } = useAppSelector((state) => state.settings);
  const dispatch = useDispatch();
  const [QrData, setQrData] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [mediumModal, setMediumModal] = useState(false);
  const [mediumMode, setMediumMode] = useState(null);

  const onSignMessage = () => {
    if (!message) return showToast(errorText.enterMessage);
    try {
      if (type == EntityKind.WALLET) {
        if (!wallet.specs.addresses?.external) {
          dispatch(refreshWallets([wallet], { hardRefresh: true }));
          return;
        }
        const { signature, messageAddress } = WalletOperations.signMessageWallet(
          address,
          message.trim(),
          bitcoinNetwork,
          xpriv,
          receiveAddressCache
        );
        setSignature(signature);
        setAddress(messageAddress);
      } else {
        if (!address) {
          if (!activeVault.specs.addresses?.external) {
            dispatch(refreshWallets([activeVault], { hardRefresh: true }));
            return;
          }
          setAddress(activeVault.specs.addresses.external[0]);
        }
        setMediumMode(MEDIUM_MODES.EXPORT);
        setMediumModal(true);
      }
    } catch (error) {
      console.log('🚀 ~ onSignMessage ~ error:', error);
      showToast(error.message);
    }
  };

  const onVerifyMessage = () => {
    if (!message || !address || !signature) return showToast(errorText.signMessageParameter);
    try {
      const valid = WalletOperations.verifySignedMessage(
        message.trim(),
        address,
        signature,
        bitcoinNetwork
      );
      if (valid) setVerifiedModal(true);
    } catch (error) {
      console.log('🚀 ~ onVerifyMessage ~ error:', error);
      showToast(errorText.signatureNotValid, <ToastErrorIcon />);
    }
  };

  const onQrScan = (data) => {
    setSignature(data);
    navigation.pop();
  };

  const onSigningMediumSelection = (medium) => {
    setMediumModal(false);
    if (mediumMode == MEDIUM_MODES.EXPORT) {
      if (medium === KeyGenerationMode.QR) {
        const qrData = WalletOperations.createSignMessageString(
          address,
          message.trim(),
          bitcoinNetwork,
          activeVault,
          KeyGenerationMode.QR
        );
        setQrData(qrData);
        setShowQrModal(true);
        return;
      } else if (medium === KeyGenerationMode.FILE) {
        const fileData = WalletOperations.createSignMessageString(
          address,
          message.trim(),
          bitcoinNetwork,
          activeVault,
          KeyGenerationMode.FILE
        );
        exportFile(fileData, `signMessage.txt`, (error) =>
          showToast(error.message, <ToastErrorIcon />)
        );
      }
    } else if (mediumMode == MEDIUM_MODES.IMPORT) {
      if (medium === KeyGenerationMode.QR) {
        navigation.dispatch(
          CommonActions.navigate('ScanQR', {
            title: walletText.verifyTitle,
            subtitle: walletText.verifySubtitle,
            onQrScan,
            mode: InteracationMode.SIGNED_MESSAGE,
            illustration: null,
            Instructions: [
              'Make sure your device supports message signing.',
              'Sign the message with your device and select QR to continue.',
            ],
          })
        );
      } else if (medium === KeyGenerationMode.FILE) {
        importFile(
          (data) => {
            const signatureRegex =
              /-----BEGIN BITCOIN SIGNATURE-----\n(.+)\n(.+)\n-----END BITCOIN SIGNATURE-----/s;
            const match = data.match(signatureRegex);
            if (match && match.length === 3) {
              const signature = match[2].trim(); // The actual signature (Base64)
              setSignature(signature);
            } else {
              throw new Error(errorText.invalidSignatureFormat);
            }
          },
          (_) => {
            showToast(errorText.pickValidFile, <ToastErrorIcon />);
          }
        );
      }
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : null}
        enabled
        keyboardVerticalOffset={Platform.select({ ios: 8, android: 500 })}
        style={styles.scrollViewWrapper}
      >
        <Box style={styles.header}>
          <WalletHeader title={walletText.SignMessageHeader} />
        </Box>

        <ScrollView
          style={styles.scrollViewWrapper}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={isSmallDevice && { paddingBottom: hp(100) }}
        >
          <Text>{walletText.signMessageSubtitle}</Text>
          <KeeperTextInput
            testID="input_receive_address"
            placeholder={common.Address}
            inpuBackgroundColor={`${colorMode}.textInputBackground`}
            inpuBorderColor={`${colorMode}.dullGreyBorder`}
            height={50}
            value={address}
            onChangeText={setAddress}
            blurOnSubmit={true}
            paddingLeft={5}
          />
          <Box
            style={styles.inputWrapper}
            backgroundColor={`${colorMode}.seashellWhite`}
            borderColor={`${colorMode}.dullGreyBorder`}
          >
            <Input
              testID="input_container"
              placeholder={common.message}
              placeholderTextColor={`${colorMode}.placeHolderTextColor`}
              style={styles.textInput}
              variant="unstyled"
              value={message}
              onChangeText={setMessage}
              multiline
              _input={
                colorMode === 'dark' && {
                  selectionColor: Colors.bodyText,
                  cursorColor: Colors.bodyText,
                }
              }
            />
          </Box>
          <>
            <Box
              style={styles.inputWrapper}
              backgroundColor={`${colorMode}.seashellWhite`}
              borderColor={`${colorMode}.dullGreyBorder`}
            >
              <Input
                testID="input_container"
                placeholder={common.signature}
                placeholderTextColor={`${colorMode}.placeHolderTextColor`}
                style={styles.textInput}
                variant="unstyled"
                value={signature}
                onChangeText={setSignature}
                multiline
                _input={
                  colorMode === 'dark' && {
                    selectionColor: Colors.bodyText,
                    cursorColor: Colors.bodyText,
                  }
                }
              />
            </Box>
            {type == EntityKind.VAULT && (
              <Buttons
                secondaryText={common.loadSignature}
                secondaryCallback={() => {
                  setMediumMode(MEDIUM_MODES.IMPORT);
                  setMediumModal(true);
                }}
              />
            )}
          </>
        </ScrollView>
      </KeyboardAvoidingView>
      <Box backgroundColor={`${colorMode}.primaryBackground`}>
        <Buttons
          primaryCallback={onSignMessage}
          primaryText={common.sign}
          secondaryText={common.verify}
          secondaryCallback={onVerifyMessage}
        />
      </Box>
      <KeeperModal
        visible={verifiedModal}
        title={walletText.messageVerifiedTitle}
        subTitle={walletText.messageVerifiedSubTitle}
        close={() => setVerifiedModal(false)}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.close}
        buttonCallback={() => setVerifiedModal(false)}
        Content={() => (
          <Box alignItems={'center'}>
            <ThemedSvg name={'success_illustration'} />
          </Box>
        )}
      />
      {QrData && (
        <KeeperModal
          visible={showQrModal}
          title={common.signMessage}
          close={() => {
            setShowQrModal(false);
            setQrData(null);
          }}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          buttonText={common.close}
          buttonCallback={() => {
            setShowQrModal(false);
            setQrData(null);
          }}
          Content={() => (
            <Box>
              <ShowXPub data={QrData} subText={'Scan the QR on your device'} copyable={false} />
            </Box>
          )}
        />
      )}
      <KeeperModal
        visible={mediumModal}
        title={MEDIUM_MODES.EXPORT == mediumMode ? common.signMessage : common.loadSignature}
        subTitle={
          MEDIUM_MODES.EXPORT == mediumMode
            ? walletText.chooseSignMessageMedium
            : walletText.chooseImportSignatureMedium
        }
        close={() => setMediumModal(false)}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => mediumSelectionContent(onSigningMediumSelection)}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollViewWrapper: {
    flex: 1,
  },
  header: {
    marginBottom: 18,
  },
  inputWrapper: {
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: hp(15),
    paddingHorizontal: hp(10),
    borderWidth: 1,
  },
  textInput: {
    width: '100%',
    height: hp(110),
    fontSize: 12,
  },

  name: {
    textAlign: 'left',
    flexWrap: 'wrap',
  },
  textContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContainer: {
    width: windowWidth * 0.87,
    paddingVertical: hp(17),
    paddingHorizontal: wp(20),
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    gap: wp(15),
    marginVertical: hp(10),
  },
  mediumContainer: {
    width: 200,
    rowGap: 2,
  },
});

const mediumSelectionContent = (onSigningMediumSelection) => {
  const { colorMode } = useColorMode();

  const options = [
    {
      title: 'QR',
      icon: (
        <CircleIconWrapper
          icon={<QRComms />}
          backgroundColor={`${colorMode}.pantoneGreen`}
          width={35}
        />
      ),
      name: KeyGenerationMode.QR,
    },
    {
      title: 'File',
      icon: (
        <CircleIconWrapper
          icon={<ImportIcon />}
          backgroundColor={`${colorMode}.pantoneGreen`}
          width={35}
        />
      ),
      name: KeyGenerationMode.FILE,
    },
  ];

  return (
    <Box style={styles.mediumContainer}>
      {options &&
        options.map((option) => (
          <SignerOptionCard
            key={option.name}
            name={option.title}
            icon={option.icon}
            onSelect={onSigningMediumSelection}
          />
        ))}
    </Box>
  );
};

const SignerOptionCard = ({ name, icon, onSelect }) => {
  const { colorMode } = useColorMode();
  const cardStyle = [styles.cardContainer];

  return (
    <TouchableOpacity onPress={() => onSelect(name)} testID={`btn_${name}`}>
      <Box
        style={cardStyle}
        backgroundColor={`${colorMode}.seashellWhite`}
        borderColor={`${colorMode}.dullGreyBorder`}
      >
        {icon}
        <Box style={styles.textContainer}>
          <Text style={styles.name} color={`${colorMode}.modalWhiteContent`} medium>
            {name}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
