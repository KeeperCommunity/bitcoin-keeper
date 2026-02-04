import { Box, ScrollView, useColorMode } from 'native-base';
import React, { useContext, useEffect, useState } from 'react';
import { hp, windowHeight, windowWidth, wp } from 'src/constants/responsive';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { SignerType } from 'src/services/wallets/enums';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { getDeviceStatus, getSDMessage } from 'src/hardware';
import { Signer, Vault } from 'src/services/wallets/interfaces/vault';
import usePlan from 'src/hooks/usePlan';
import NFC from 'src/services/nfc';
import useSigners from 'src/hooks/useSigners';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import Note from 'src/components/Note/Note';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useAppSelector } from 'src/store/hooks';
import useToastMessage from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { useDispatch } from 'react-redux';
import { resetSignersUpdateState } from 'src/store/reducers/bhr';
import { useNavigation } from '@react-navigation/native';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import WalletHeader from 'src/components/WalletHeader';
import AssignSignerTypeCard from './components/AssignSignerTypeCard';
import UnknownSignerInfo from './components/UnknownSignerInfo';

type IProps = {
  navigation: any;
  route: {
    params: {
      vault: Vault;
      signer: Signer;
      isImportFlow?: boolean;
      onTypeSelection?: (type: SignerType) => void;
    };
  };
};
function AssignSignerType({ route }: IProps) {
  const { colorMode } = useColorMode();
  const { vault, signer, isImportFlow = false, onTypeSelection = () => {} } = route.params;
  const { signers: appSigners } = useSigners();
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  const { isOnL1, isOnL2 } = usePlan();
  const { relaySignersUpdate, relaySignerUpdateError, realySignersUpdateErrorMessage } =
    useAppSelector((state) => state.bhr);
  const { showToast } = useToastMessage();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const [goBackSuccessMessage, setGoBackSuccessMessage] = useState('');
  const [goBackErrorMessage, setGoBackErrorMessage] = useState('');
  const isUnknownSigner = signer.type === SignerType.UNKOWN_SIGNER;

  useEffect(() => {
    if (relaySignersUpdate) {
      dispatch(resetSignersUpdateState());
      setGoBackSuccessMessage('Signer type updated successfully');
    } else if (goBackSuccessMessage) {
      showToast(goBackSuccessMessage, <TickIcon />);
      navigation.goBack();
    }
  }, [relaySignersUpdate]);

  useEffect(() => {
    if (relaySignerUpdateError) {
      dispatch(resetSignersUpdateState());
      setGoBackErrorMessage(realySignersUpdateErrorMessage);
    } else if (goBackErrorMessage) {
      showToast(goBackErrorMessage, <ToastErrorIcon />);
      navigation.goBack();
    }
  }, [relaySignerUpdateError]);

  const availableSigners = [
    SignerType.KEEPER,
    SignerType.BITBOX02,
    SignerType.COLDCARD,
    SignerType.JADE,
    SignerType.KEYSTONE,
    SignerType.KRUX,
    SignerType.LEDGER,
    SignerType.PASSPORT,
    SignerType.PORTAL,
    SignerType.SATOCHIP,
    SignerType.SEEDSIGNER,
    SignerType.SPECTER,
    SignerType.TREZOR,
    SignerType.SEED_WORDS,
    SignerType.POLICY_SERVER,
    isUnknownSigner && SignerType.TAPSIGNER,
  ].filter(Boolean);

  const [isNfcSupported, setNfcSupport] = useState(true);
  const [signersLoaded, setSignersLoaded] = useState(false);

  const { primaryMnemonic }: KeeperApp = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0];

  const getNfcSupport = async () => {
    const isSupported = await NFC.isNFCSupported();
    setNfcSupport(isSupported);
    setSignersLoaded(true);
  };

  useEffect(() => {
    getNfcSupport();
  }, []);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={signerText.changeSignerTitle}
        subTitle={signerText.changeSignerSubtitle}
      />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {isUnknownSigner && <UnknownSignerInfo signer={signer} />}
        {!signersLoaded ? (
          <ActivityIndicator />
        ) : (
          <Box>
            <Box>
              {availableSigners
                .filter((type) => type != signer?.type)
                .map((type: SignerType, index: number) => {
                  let { disabled, message: connectivityStatus } = getDeviceStatus(
                    type,
                    isNfcSupported,
                    isOnL1,
                    isOnL2,
                    { m: 2, n: 3 },
                    appSigners
                  );

                  if (type === SignerType.POLICY_SERVER) {
                    // overrides status for Server Key(enables: type assignment for Server Key of an Imported Vault)
                    disabled = false;
                    connectivityStatus = '';
                  }

                  let message = connectivityStatus;
                  if (!connectivityStatus) {
                    message = getSDMessage({ type });
                  }

                  return (
                    <AssignSignerTypeCard
                      key={type}
                      type={type}
                      disabled={disabled}
                      first={index === 0}
                      last={index === availableSigners.length - 1}
                      vault={vault}
                      primaryMnemonic={primaryMnemonic}
                      signer={signer}
                      isImportFlow={isImportFlow}
                      onTypeSelection={onTypeSelection}
                    />
                  );
                })}
            </Box>
            <Box style={styles.noteContainer}>
              <Note subtitle={signerText.changeSignerNote} />
            </Box>
          </Box>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    gap: 20,
  },
  walletMapContainer: {
    alignItems: 'center',
    height: windowHeight * 0.08,
    flexDirection: 'row',
    paddingLeft: wp(40),
  },
  walletMapWrapper: {
    marginRight: wp(20),
    width: wp(15),
  },
  walletMapLogoWrapper: {
    alignItems: 'center',
  },
  dividerStyle: {
    opacity: 0.6,
    width: windowWidth * 0.8,
    alignSelf: 'center',
    height: 0.5,
  },
  divider: {
    opacity: 0.5,
    height: hp(26),
    width: 1.5,
  },
  messageText: {
    fontSize: 10,
    fontWeight: '400',
    letterSpacing: 1.3,
    marginTop: hp(5),
  },
  content: {
    alignItems: 'flex-start',
    paddingLeft: wp(30),
  },
  noteContainer: {
    marginVertical: 40,
  },
});

export default AssignSignerType;
