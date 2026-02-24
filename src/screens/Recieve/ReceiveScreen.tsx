/* eslint-disable react/no-unstable-nested-components */
import Text from 'src/components/KeeperText';

import { Box, useColorMode, Pressable, HStack } from 'native-base';
import { ScrollView, StyleSheet, Vibration } from 'react-native';
import React, { useContext, useEffect, useState } from 'react';
import Buttons from 'src/components/Buttons';

import ScreenWrapper from 'src/components/ScreenWrapper';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import KeeperModal from 'src/components/KeeperModal';
import WalletOperations from 'src/services/wallets/operations';
import Fonts from 'src/constants/Fonts';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import DeleteDarkIcon from 'src/assets/images/delete.svg';
import DeleteIcon from 'src/assets/images/deleteLight.svg';
import ReceiveAddress from './ReceiveAddress';
import useSigners from 'src/hooks/useSigners';
import { SignerType } from 'src/services/wallets/enums';
import { CommonActions, useNavigation } from '@react-navigation/native';
import ReceiveQR from './ReceiveQR';
import AddressUsageBadge from './AddressUsageBadge';
import NavLeft from 'src/assets/images/nav-left.svg';
import NavLeftWhite from 'src/assets/images/nav-left-white.svg';
import NavRight from 'src/assets/images/nav-right.svg';
import NavRightWhite from 'src/assets/images/nav-right-white.svg';
import NewQR from 'src/assets/images/qr-new.svg';
import NewQRWhite from 'src/assets/images/qr-new-white.svg';
import KeeperTextInput from 'src/components/KeeperTextInput';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { generateNewAddress } from 'src/store/sagaActions/wallets';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import useToastMessage from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import Close from 'src/assets/images/modal_close.svg';
import ErrorIcon from 'src/assets/images/error.svg';
import ErrorDarkIcon from 'src/assets/images/error-dark.svg';
import useLabelsNew from 'src/hooks/useLabelsNew';
import { UTXOLabel } from 'src/components/UTXOsComponents/UTXOList';
import LabelsEditor from '../UTXOManagement/components/LabelsEditor';
import CurrencyKind from 'src/models/enums/CurrencyKind';
import useExchangeRates from 'src/hooks/useExchangeRates';
import useCurrencyCode from 'src/store/hooks/state-selectors/useCurrencyCode';
import { SATOSHIS_IN_BTC } from 'src/constants/Bitcoin';
import { InteracationMode } from '../Vault/HardwareModalMap';
import { Vault } from 'src/services/wallets/interfaces/vault';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import AmountDetailsInput from '../Send/AmountDetailsInput';
import { getAccountFromSigner } from 'src/utils/utilities';
import WalletHeader from 'src/components/WalletHeader';

const AddressVerifiableSigners = [
  SignerType.BITBOX02,
  SignerType.LEDGER,
  SignerType.ONEKEY,
  SignerType.TREZOR,
  SignerType.COLDCARD,
  SignerType.JADE,
  SignerType.PORTAL,
];

const SignerTypesNeedingRegistration = [
  SignerType.COLDCARD,
  SignerType.JADE,
  SignerType.PASSPORT,
  SignerType.KEYSTONE,
  SignerType.SPECTER,
  SignerType.PORTAL,
  SignerType.KRUX,
];

function ReceiveScreen({ route }: { route }) {
  const { colorMode } = useColorMode();
  const [modalVisible, setModalVisible] = useState(false);
  const [labelsModalVisible, setLabelsModalVisible] = useState(false);
  const [amount, setAmount] = useState('');
  const [equivalentAmount, setEquivalentAmount] = useState<string | number>('0');

  const wallet: Wallet | Vault = route?.params?.wallet;
  // const amount = route?.params?.amount;
  const [receivingAddress, setReceivingAddress] = useState(null);
  const [paymentURI, setPaymentURI] = useState(null);

  const { translations } = useContext(LocalizationContext);
  const { common, home, wallet: walletTranslation, vault: vaultTranslations } = translations;

  const navigation = useNavigation();
  const { vaultSigners } = useSigners(wallet.id);
  const [addVerifiableSigners, setAddVerifiableSigners] = useState([]);
  const [signersNeedRegistration, setSignersNeedRegistration] = useState([]);

  const [currentAddressIdx, setCurrentAddressIdx] = useState(0);
  const [currentAddressIdxTempText, setCurrentAddressIdxTempText] = useState('');
  const [totalAddressesCount, setTotalAddressesCount] = useState(0);

  const [addressUsed, setAddressUsed] = useState(false);

  const dispatch = useAppDispatch();

  const { showToast } = useToastMessage();

  const { labels: addressLabels } = useLabelsNew({ address: receivingAddress });
  const labels = addressLabels ? addressLabels[receivingAddress] || [] : [];

  const { satsEnabled }: { satsEnabled: boolean } = useAppSelector((state) => state.settings);
  const currentCurrency = useAppSelector((state) => state.settings.currencyKind);
  const exchangeRates = useExchangeRates();
  const currencyCode = useCurrencyCode();

  const [localCurrencyKind, setLocalCurrencyKind] = useState(currentCurrency);

  const generateNewReceiveAddress = () => {
    dispatch(generateNewAddress(wallet));
    Vibration.vibrate(50);
    const newTotalAddressesCount = totalAddressesCount + 1;
    setTotalAddressesCount(newTotalAddressesCount);
    setCurrentAddressIdx(newTotalAddressesCount);
  };

  useEffect(() => {
    setCurrentAddressIdxTempText(currentAddressIdx.toString());
    if (totalAddressesCount == 0) {
      const receivingAddress = WalletOperations.getNextFreeAddress(wallet);
      setReceivingAddress(receivingAddress);
      setTotalAddressesCount(wallet.specs.totalExternalAddresses);
      setCurrentAddressIdx(wallet.specs.nextFreeAddressIndex + 1);
    } else {
      const receivingAddress = WalletOperations.getExternalInternalAddressAtIdx(
        wallet,
        currentAddressIdx - 1
      );
      setReceivingAddress(receivingAddress);
      setAddressUsed(
        wallet.specs.transactions.some(
          (tx) => tx.recipientAddresses && tx.recipientAddresses.includes(receivingAddress)
        )
      );
    }
  }, [currentAddressIdx]);

  function convertFiatToSats(fiatAmount: number) {
    return exchangeRates && exchangeRates[currencyCode]
      ? (fiatAmount / exchangeRates[currencyCode].last) * SATOSHIS_IN_BTC
      : 0;
  }

  useEffect(() => {
    if (amount) {
      let convertedAmount;
      if (localCurrencyKind === CurrencyKind.BITCOIN) {
        if (satsEnabled) convertedAmount = parseInt(amount) / 1e8;
        else convertedAmount = parseFloat(amount);
      } else
        convertedAmount =
          parseInt(convertFiatToSats(parseFloat(amount)).toFixed(0).toString()) / 1e8;
      if (convertedAmount) {
        const newPaymentURI = WalletUtilities.generatePaymentURI(receivingAddress, {
          amount: convertedAmount,
        }).paymentURI;
        setPaymentURI(newPaymentURI);
      } else setPaymentURI(null);
    } else if (paymentURI) setPaymentURI(null);
  }, [amount]);

  useEffect(() => {
    const avSigner = vaultSigners.filter((signer) =>
      AddressVerifiableSigners.includes(signer?.type)
    );
    setAddVerifiableSigners(avSigner);
  }, []);

  useEffect(() => {
    if (wallet.entityKind === 'VAULT' && (wallet as Vault).isMultiSig) {
      const unregisteredSigners = vaultSigners
        .filter((signer) => SignerTypesNeedingRegistration.includes(signer.type))
        .map((signer) => {
          const vaultSigner = (wallet as Vault).signers.find(
            (vaultSigner) => vaultSigner.masterFingerprint === signer.masterFingerprint
          );
          return { vaultSigner, type: signer.type };
        })
        .filter((signer) => {
          if ([SignerType.KRUX].includes(signer.type)) return true;
          return (
            signer.vaultSigner.registeredVaults?.find((info) => info.vaultId === wallet.id)
              ?.registered !== true
          );
        });
      setSignersNeedRegistration(unregisteredSigners);
    }
  }, [wallet]);

  function AddAmountContent() {
    const onPressNumber = (text) => {
      if (text === 'x') {
        onDeletePressed();
        return;
      }
      if (text === '.') {
        if ((localCurrencyKind === CurrencyKind.BITCOIN && satsEnabled) || amount.includes('.')) {
          return;
        }
        if (!amount || amount === '0') {
          setAmount('0.');
          return;
        }
        setAmount(amount + '.');
        return;
      }
      const maxDecimalPlaces = localCurrencyKind === CurrencyKind.BITCOIN && !satsEnabled ? 8 : 2;
      if (amount === '0' && text !== '.') {
        setAmount(text);
        return;
      }
      let newAmount = amount + text;
      const parts = newAmount.split('.');
      if (parts[1] && parts[1].length > maxDecimalPlaces) {
        return;
      }
      setAmount(newAmount);
    };

    const onDeletePressed = () => {
      if (amount.length <= 1) {
        setAmount('0');
        return;
      }
      setAmount(amount.slice(0, amount.length - 1));
    };

    return (
      <Box>
        <AmountDetailsInput
          amount={amount}
          currentAmount={amount}
          setCurrentAmount={setAmount}
          equivalentAmount={equivalentAmount}
          setEquivalentAmount={setEquivalentAmount}
          satsEnabled={satsEnabled}
          localCurrencyKind={localCurrencyKind}
          setLocalCurrencyKind={setLocalCurrencyKind}
          currencyCode={currencyCode}
        />
        <KeyPadView
          onPressNumber={onPressNumber}
          onDeletePressed={onDeletePressed}
          enableDecimal
          keyColor={`${colorMode}.keyPadText`}
          ClearIcon={colorMode === 'dark' ? <DeleteIcon /> : <DeleteDarkIcon />}
        />
        <Box marginTop={hp(20)}>
          <Buttons
            fullWidth
            primaryText={common.confirm}
            primaryCallback={() => {
              setModalVisible(false);
            }}
          />
        </Box>
      </Box>
    );
  }

  const onVerifyAddress = () => {
    const signersMFP = addVerifiableSigners.map((signer) => signer.masterFingerprint);
    navigation.dispatch(
      CommonActions.navigate('SignerSelectionListScreen', {
        signersMFP,
        vaultId: wallet.id,
        title: walletTranslation.verifyAddress,
        description: vaultTranslations.SelectSigner,
        mode: InteracationMode.ADDRESS_VERIFICATION,
        callback: (signer, signerName) => {
          if (signer.type === SignerType.PORTAL) {
            navigation.dispatch(
              CommonActions.navigate('SetupPortal', {
                vaultId: wallet.id,
                mode: InteracationMode.ADDRESS_VERIFICATION,
                accountNumber: getAccountFromSigner(signer),
                receiveAddressIndex: currentAddressIdx - 1,
              })
            );
          } else {
            navigation.dispatch(
              CommonActions.navigate('ConnectChannel', {
                signer,
                vaultId: wallet.id,
                type: signer.type,
                mode: InteracationMode.ADDRESS_VERIFICATION,
                title: `${common.connectingTo} ${signerName}`,
                subtitle: vaultTranslations.verifyAddDesc,
                receiveAddressIndex: currentAddressIdx - 1,
              })
            );
          }
        },
      })
    );
  };

  const onRegisterVault = () => {
    const signersMFP = vaultSigners
      .filter((signer) => SignerTypesNeedingRegistration.includes(signer.type))
      .map((signer) => signer.masterFingerprint);

    navigation.dispatch(
      CommonActions.navigate('SignerSelectionListScreen', {
        signersMFP,
        vaultId: wallet.id,
        title: vaultTranslations.registerVaultOnDevice,
        description: vaultTranslations.SelectSigner,
        vaultKeydata: (wallet as Vault).signers,
        mode: InteracationMode.VAULT_REGISTER,
        callback: (signer, signerName) => {
          const vaultKey = (wallet as Vault).signers.find(
            (vaultSigner) => vaultSigner.masterFingerprint === signer.masterFingerprint
          );
          if (signer.type === SignerType.PORTAL) {
            navigation.dispatch(
              CommonActions.navigate('SetupPortal', {
                vaultKey,
                vaultId: wallet.id,
                mode: InteracationMode.VAULT_REGISTER,
                accountNumber: getAccountFromSigner(signer),
              })
            );
            // For now, Jade only supports registration via USB for Miniscript
          } else if ((wallet as Vault).scheme.miniscriptScheme && signer.type === SignerType.JADE) {
            navigation.dispatch(
              CommonActions.navigate('RegisterWithChannel', {
                vaultKey,
                vaultId: wallet.id,
                signerType: signer.type,
              })
            );
          } else {
            navigation.dispatch(
              CommonActions.navigate('RegisterWithQR', {
                vaultKey,
                vaultId: wallet.id,
              })
            );
          }
        },
      })
    );
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box style={{ flexDirection: 'row', marginBottom: hp(25) }}>
        <WalletHeader
          title={common.receive}
          titleColor={`${colorMode}.primaryText`}
          rightComponent={
            <TouchableOpacity
              onPress={generateNewReceiveAddress}
              style={styles.getNewAddressContainer}
              testID="btn_get_new_address"
            >
              <Text color={`${colorMode}.textGreen`} style={styles.getNewAddressText} semiBold>
                {home.GetNewAddress}
              </Text>
              {colorMode === 'light' ? (
                <NewQR size={wp(20)} style={styles.getNewAddressIcon} />
              ) : (
                <NewQRWhite size={wp(20)} style={styles.getNewAddressIcon} />
              )}
            </TouchableOpacity>
          }
        />
      </Box>
      <ScrollView
        automaticallyAdjustKeyboardInsets={true}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        alwaysBounceHorizontal={false}
        alwaysBounceVertical={false}
        bounces={false}
      >
        <Box
          style={styles.receiveDataContainer}
          backgroundColor={`${colorMode}.seashellWhite`}
          borderColor={`${colorMode}.dullGreyBorder`}
        >
          <AddressUsageBadge used={addressUsed} />
          <TouchableOpacity onPress={() => setLabelsModalVisible(true)} testID="btn_add_labels">
            {labels.length > 0 ? (
              <Box style={styles.labelsRow}>
                <UTXOLabel labels={labels} center addMoreBtn />
              </Box>
            ) : (
              <Text color={`${colorMode}.textGreen`} style={styles.addLablesText} semiBold>
                {vaultTranslations.addLabeltoAddress}
              </Text>
            )}
          </TouchableOpacity>
          <ReceiveQR qrValue={paymentURI || receivingAddress} qrSize={wp(windowWidth * 0.45)} />
          <Box style={styles.addressContainer}>
            <ReceiveAddress address={paymentURI || receivingAddress} />
          </Box>
        </Box>

        <HStack style={styles.addressPagesBar}>
          <TouchableOpacity
            onPress={() => {
              const newIdx = Math.max(1, currentAddressIdx - 1);
              if (newIdx !== currentAddressIdx) {
                Vibration.vibrate(50);
                setCurrentAddressIdx(newIdx);
              }
            }}
            style={styles.addressPageBtn}
            testID={`btn_address_page_${currentAddressIdx - 1}`}
          >
            {colorMode === 'light' ? (
              <NavLeft width={wp(22)} height={hp(22)} />
            ) : (
              <NavLeftWhite width={wp(22)} height={hp(22)} />
            )}
          </TouchableOpacity>
          <KeeperTextInput
            placeholder=""
            value={currentAddressIdxTempText}
            onChangeText={(text) => {
              setCurrentAddressIdxTempText(text);
            }}
            onBlur={() => {
              if (
                parseInt(currentAddressIdxTempText) &&
                !Number.isNaN(parseInt(currentAddressIdxTempText)) &&
                !(
                  currentAddressIdxTempText.includes('.') || currentAddressIdxTempText.includes(',')
                )
              ) {
                setCurrentAddressIdx(
                  Math.min(totalAddressesCount, parseInt(currentAddressIdxTempText))
                );
              } else {
                setCurrentAddressIdxTempText(currentAddressIdx.toString());
              }
            }}
            width={wp(Math.min(120, 40 + 5 * String(currentAddressIdx).length))}
            height={hp(35)}
            keyboardType="numeric"
            style={styles.addressPageInput}
            fontWeight="200"
          />
          <Text color={`${colorMode}.black`} style={styles.totalAddressesText}>
            of {totalAddressesCount}
          </Text>
          <TouchableOpacity
            onPress={() => {
              const newIdx = Math.min(totalAddressesCount, currentAddressIdx + 1);
              if (newIdx !== currentAddressIdx) {
                Vibration.vibrate(50);
                setCurrentAddressIdx(newIdx);
              }
            }}
            style={styles.addressPageBtn}
          >
            {colorMode === 'light' ? (
              <NavRight width={wp(22)} height={hp(22)} />
            ) : (
              <NavRightWhite width={wp(22)} height={hp(22)} />
            )}
          </TouchableOpacity>
        </HStack>
      </ScrollView>
      <Box style={styles.BottomContainer} backgroundColor={`${colorMode}.primaryBackground`}>
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          testID={`btn_${home.requestSpecificAmount}`}
        >
          <Text color={`${colorMode}.textGreen`} style={styles.addAmountText} semiBold>
            {home.requestSpecificAmount}
          </Text>
        </TouchableOpacity>
        {
          <Box>
            {wallet.entityKind === 'VAULT' &&
            (addVerifiableSigners?.length || signersNeedRegistration.length) ? (
              <Box marginTop={hp(33)}>
                <Buttons
                  fullWidth
                  primaryText={addVerifiableSigners?.length ? common.verfyAddressbutton : null}
                  primaryCallback={onVerifyAddress}
                  secondaryText={
                    signersNeedRegistration.length ? vaultTranslations.registerVault : null
                  }
                  secondaryCallback={onRegisterVault}
                />
              </Box>
            ) : (
              <Box marginBottom={hp(84)} />
            )}
          </Box>
        }
      </Box>
      <KeeperModal
        visible={modalVisible}
        showCloseIcon
        close={() => setModalVisible(false)}
        title={home.RequestSpecificAmount}
        subTitle={home.amountdesc}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={AddAmountContent}
      />
      {labelsModalVisible && (
        <Pressable
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          backgroundColor="rgba(0, 0, 0, 0.5)"
          justifyContent="center"
          alignItems="center"
          onPress={() => {
            setLabelsModalVisible(false);
          }}
        >
          <Pressable
            width="90%"
            backgroundColor={`${colorMode}.primaryBackground`}
            borderRadius={10}
            style={styles.overlayContainer}
            onPress={() => {}}
          >
            <TouchableOpacity style={styles.close} onPress={() => setLabelsModalVisible(false)}>
              <Close />
            </TouchableOpacity>
            <Text color={`${colorMode}.primaryText`} style={styles.overlayTitle}>
              {walletTranslation.AddLabels}
            </Text>
            <Text color={`${colorMode}.secondaryText`} style={styles.overlaySubtitle}>
              {walletTranslation.AddLabelsReceiveSubtitle}
            </Text>
            {receivingAddress && (
              <LabelsEditor
                address={receivingAddress}
                wallet={wallet}
                onLabelsSaved={() => {
                  showToast(walletTranslation.LabelsSavedSuccessfully, <TickIcon />);
                  setLabelsModalVisible(false);
                }}
              />
            )}
            {addressUsed && (
              <Box
                style={styles.addressUsedLabelsWarning}
                backgroundColor={`${colorMode}.errorToastBackground`}
                borderColor={`${colorMode}.alertRed`}
              >
                <Box style={styles.addressUsedLabelsWarningIcon}>
                  {colorMode === 'light' ? <ErrorIcon /> : <ErrorDarkIcon />}
                </Box>
                <Text style={styles.addressUsedLabelsWarningText}>
                  {walletTranslation.addressAlreadyUsedLabelWarning}
                </Text>
              </Box>
            )}
          </Pressable>
        </Pressable>
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  BottomContainer: {
    marginTop: hp(10),
    width: '95%',
    alignSelf: 'center',
  },
  Container: {
    padding: 10,
  },
  inputField: {
    opacity: 0.8,
    fontFamily: Fonts.InterBold,
    letterSpacing: 1.04,
  },
  inputWrapper01: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
    borderRadius: 10,
    marginVertical: hp(15),
    padding: 5,
  },
  verticalDeviderLine: {
    marginLeft: 5,
    width: 2,
    opacity: 0.5,
    height: 15,
  },
  btcIconWrapper: {
    marginLeft: 6,
  },
  bottomBtnView: {
    marginBottom: 10,
  },
  addressContainer: {
    marginHorizontal: wp(20),
  },
  verifyAddressBtn: {
    width: '100%',
    paddingHorizontal: wp(35),
    paddingVertical: hp(14),
    borderRadius: 10,
    alignItems: 'center',
    marginTop: hp(15),
    marginBottom: hp(20),
  },
  verifyAddressBtnText: {
    fontSize: 14,
    letterSpacing: 0.84,
  },
  receiveDataContainer: {
    paddingTop: hp(17),
    paddingBottom: hp(10),
    borderRadius: 10,
    borderWidth: 1,
  },
  addAmountText: {
    fontSize: 14,
    width: '100%',
    textAlign: 'center',
    marginBottom: hp(20),
  },
  addressPagesBar: {
    marginTop: hp(5),
    justifyContent: 'center',
    alignItems: 'center',
  },
  addressPageInput: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: hp(3),
  },
  totalAddressesText: {
    fontSize: 14,
    marginLeft: wp(8),
  },
  addressPageBtn: {
    marginHorizontal: wp(10),
    width: wp(22),
    height: hp(22),
  },
  getNewAddressContainer: {
    flexDirection: 'row',
  },
  getNewAddressText: {
    fontSize: 14,
  },
  getNewAddressIcon: {
    marginLeft: wp(9),
    marginRight: wp(10),
    marginTop: hp(1),
  },
  addLablesText: {
    fontSize: 14,
    width: '100%',
    textAlign: 'center',
    marginTop: hp(10),
  },
  overlayContainer: {
    paddingTop: hp(30),
    paddingBottom: hp(50),
    paddingHorizontal: wp(15),
  },
  overlayTitle: {
    fontSize: 19,
    letterSpacing: 0.19,
    marginBottom: hp(5),
  },
  overlaySubtitle: {
    fontSize: 13,
    letterSpacing: 0.13,
    marginBottom: hp(15),
  },
  close: {
    width: '100%',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  labelsRow: {
    alignSelf: 'center',
    marginVertical: hp(1),
    width: '70%',
  },
  addressUsedLabelsWarning: {
    width: '97%',
    alignSelf: 'center',
    marginTop: hp(20),
    paddingVertical: hp(17),
    paddingHorizontal: hp(9),
    borderWidth: 0.5,
    borderRadius: 10,
    flexDirection: 'row',
  },
  addressUsedLabelsWarningText: {
    fontSize: 13,
    textAlign: 'left',
    width: '80%',
    marginLeft: wp(10),
  },
  addressUsedLabelsWarningIcon: {
    width: wp(30),
    height: hp(30),
    marginTop: hp(5),
    marginHorizontal: hp(2),
  },
});

export default ReceiveScreen;
