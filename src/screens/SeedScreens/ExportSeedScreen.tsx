import Text from 'src/components/KeeperText';
import { Box, HStack, Pressable, useColorMode, VStack } from 'native-base';
import { FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import React, { useContext, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import ConfirmSeedWord from 'src/components/SeedWordBackup/ConfirmSeedWord';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ModalWrapper from 'src/components/Modal/ModalWrapper';
import { healthCheckStatusUpdate, seedBackedUp } from 'src/store/sagaActions/bhr';
import { CommonActions } from '@react-navigation/native';
import { hp, wp } from 'src/constants/responsive';
import IconArrowBlack from 'src/assets/images/icon_arrow_black.svg';
import QR from 'src/assets/images/qr.svg';
import KeeperModal from 'src/components/KeeperModal';
import ShowXPub from 'src/components/XPub/ShowXPub';
import TickIcon from 'src/assets/images/icon_tick.svg';
import useToastMessage from 'src/hooks/useToastMessage';
import { SignerType, XpubTypes } from 'src/services/wallets/enums';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { Signer } from 'src/services/wallets/interfaces/vault';
import Illustration from 'src/assets/images/illustration.svg';
import Note from 'src/components/Note/Note';
import { refillMobileKey } from 'src/store/sagaActions/vaults';
import WalletUtilities from 'src/services/wallets/operations/utils';
import idx from 'idx';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { PRIVACYANDDISPLAY } from 'src/navigation/contants';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Buttons from 'src/components/Buttons';
import { getKeyUID } from 'src/utils/utilities';
import WalletHeader from 'src/components/WalletHeader';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { updateOneTimeBackupStatus } from 'src/store/reducers/account';
import { setShowTipModal } from 'src/store/reducers/settings';
import config from 'src/utils/service-utilities/config';

function ExportSeedScreen({ route, navigation }) {
  const { colorMode } = useColorMode();
  const dispatch = useAppDispatch();
  const { translations } = useContext(LocalizationContext);
  const { BackupWallet, common, seed: seedTranslation, vault: vaultTranslation } = translations;
  const { login } = translations;
  const {
    vaultKey,
    vaultId,
    seed,
    wallet,
    isHealthCheck,
    signer,
    isFromAssistedKey = false,
    derivationPath,
    isInheritancePlaning = false,
    isSS = false,
    parentScreen,
    oldPasscode,
    isFromMobileKey = false,
  }: {
    vaultKey: string;
    vaultId: string;
    seed: string;
    wallet: Wallet;
    isHealthCheck: boolean;
    signer: Signer;
    isFromAssistedKey: boolean;
    derivationPath: string;
    isInheritancePlaning?: boolean;
    isSS?: boolean;
    parentScreen?: string;
    oldPasscode?: string;
    isFromMobileKey: boolean;
  } = route.params;
  const { showToast } = useToastMessage();
  const [words, setWords] = useState(seed.split(' '));
  const { next, viewRecoveryKeys } = route.params;
  const [confirmSeedModal, setConfirmSeedModal] = useState(false);
  const [backupSuccessModal, setBackupSuccessModal] = useState(false);
  const [showQRVisible, setShowQRVisible] = useState(false);
  const [showWordIndex, setShowWordIndex] = useState<string | number>('');
  const { backupMethod } = useAppSelector((state) => state.bhr);
  const isChangePassword = parentScreen === PRIVACYANDDISPLAY;
  const seedTextColor = ThemedColor({ name: 'seedTextColor' });
  const { id: appId } = dbManager.getObjectByIndex(RealmSchema.KeeperApp);
  useEffect(() => {
    if (backupMethod !== null && next && !isHealthCheck && !isInheritancePlaning) {
      setBackupSuccessModal(true);
    }
  }, [backupMethod]);

  const getNoteSubtitle = () => {
    if (isFromAssistedKey) {
      return `${BackupWallet.writeSeed} ${signer.signerName}. ${BackupWallet.doItPrivately}`;
    }
    if (isFromMobileKey) {
      return seedTranslation.storeSecurely;
    }
    return next ? BackupWallet.recoveryKeyNote : BackupWallet.recoveryPhraseNote;
  };

  function SeedCard({ item, index }: { item; index }) {
    return (
      <TouchableOpacity
        testID={`btn_seed_word_${index}`}
        style={styles.seedCardContainer}
        onPress={() => {
          setShowWordIndex((prev) => {
            if (prev === index) {
              return '';
            }
            return index;
          });
        }}
      >
        <Box
          backgroundColor={`${colorMode}.seashellWhite`}
          opacity={showWordIndex === index ? 1 : 0.5}
          style={styles.seedCardWrapper}
        >
          <Text style={styles.seedTextStyle} color={seedTextColor}>
            {index < 9 ? '0' : null}
            {index + 1}
          </Text>
          <Text
            testID={`text_seed_word_${index}`}
            style={styles.seedTextStyle01}
            color={`${colorMode}.GreyText`}
          >
            {showWordIndex === index ? item : '******'}
          </Text>
        </Box>
      </TouchableOpacity>
    );
  }

  const renderSeedCard = ({ item, index }: { item; index }) => (
    <SeedCard item={item} index={index} />
  );
  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box style={styles.container} backgroundColor={`${colorMode}.primaryBackground`}>
        <WalletHeader
          title={
            isFromAssistedKey
              ? `${BackupWallet.backingUp} ${signer.signerName}`
              : isFromMobileKey
              ? seedTranslation.mobileKeySeedWordsTitle
              : seedTranslation.walletSeedWords
          }
          subTitle={
            isFromAssistedKey ? vaultTranslation.oneTimeBackupTitle : seedTranslation.SeedDesc
          }
        />

        <Box style={{ flex: 1, marginTop: 20 }}>
          <FlatList
            data={words}
            numColumns={2}
            showsVerticalScrollIndicator={false}
            renderItem={renderSeedCard}
            keyExtractor={(item) => item}
          />
        </Box>
        {isFromAssistedKey && derivationPath && (
          <Box style={styles.derivationContainer} backgroundColor={`${colorMode}.seashellWhite`}>
            <Text color={`${colorMode}.GreyText`}>{derivationPath}</Text>
          </Box>
        )}
        <Box m={2}>
          <Note title={common.note} subtitle={getNoteSubtitle()} subtitleColor="GreyText" />
        </Box>

        {!viewRecoveryKeys && !next && !isFromAssistedKey && (
          <Pressable
            onPress={() => {
              isFromMobileKey
                ? navigation.navigate('SeedDetails', { seed, isFromMobileKey: true })
                : navigation.navigate('UpdateWalletDetails', {
                    wallet,
                    isFromSeed: true,
                    seed,
                  });
            }}
          >
            <Box style={styles.qrItemContainer}>
              <HStack style={styles.qrItem}>
                <HStack alignItems="center">
                  <QR />
                  <VStack marginX="4" maxWidth="64">
                    <Text
                      color={`${colorMode}.primaryText`}
                      numberOfLines={2}
                      style={{ fontSize: 14, letterSpacing: 1.12, alignItems: 'center' }}
                    >
                      {common.showAsQR}
                    </Text>
                  </VStack>
                </HStack>
                <Box style={styles.backArrow}>
                  <IconArrowBlack />
                </Box>
              </HStack>
            </Box>
          </Pressable>
        )}

        <Box style={styles.nextButtonWrapper}>
          {(next || isFromAssistedKey) && (
            <Box>
              <Buttons
                primaryCallback={() => {
                  setConfirmSeedModal(true);
                }}
                primaryText={next ? login.Next : common.proceed}
                fullWidth
              />
            </Box>
          )}
        </Box>

        {/* Modals */}
        <Box>
          <ModalWrapper
            visible={confirmSeedModal}
            onSwipeComplete={() => setConfirmSeedModal(false)}
            position="center"
          >
            <ConfirmSeedWord
              closeBottomSheet={() => {
                setConfirmSeedModal(false);
              }}
              words={words}
              confirmBtnPress={() => {
                setConfirmSeedModal(false);
                if (isHealthCheck) {
                  if (signer.type === SignerType.MOBILE_KEY) {
                    dispatch(
                      healthCheckStatusUpdate([
                        {
                          signerId: signer.masterFingerprint,
                          status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
                        },
                      ])
                    );
                    navigation.dispatch(CommonActions.goBack());
                    showToast(seedTranslation.mobileKeyVerified, <TickIcon />);
                    dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
                  }
                  if (signer.type === SignerType.SEED_WORDS) {
                    dispatch(
                      healthCheckStatusUpdate([
                        {
                          signerId: signer.masterFingerprint,
                          status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
                        },
                      ])
                    );
                    navigation.dispatch(CommonActions.goBack());
                    showToast(seedTranslation.seedWordVerified, <TickIcon />);
                    dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
                  }
                  if (signer.type === SignerType.MY_KEEPER) {
                    dispatch(
                      healthCheckStatusUpdate([
                        {
                          signerId: signer.masterFingerprint,
                          status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
                        },
                      ])
                    );
                    const msXpub = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WSH][0]);
                    const ssXpub = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WPKH][0]);
                    const vaultSigner = WalletUtilities.getKeyForScheme(
                      true,
                      signer,
                      msXpub,
                      ssXpub,
                      null
                    );
                    dispatch(refillMobileKey(vaultSigner));
                    navigation.dispatch(CommonActions.goBack());
                    showToast(seedTranslation.keeperVerified, <TickIcon />);
                    dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
                  }
                } else if (isFromAssistedKey) {
                  if (isSS) {
                    dispatch(updateOneTimeBackupStatus({ appId, status: true }));
                  }
                  showToast(BackupWallet.OTBSuccessMessage, <TickIcon />);
                  navigation.dispatch(
                    CommonActions.navigate('SigningDeviceDetails', {
                      signerId: getKeyUID(signer),
                      vaultId,
                      vaultKey,
                    })
                  );
                } else {
                  dispatch(seedBackedUp());
                }
              }}
            />
          </ModalWrapper>
        </Box>
        <KeeperModal
          visible={backupSuccessModal}
          dismissible={false}
          close={
            isChangePassword
              ? () => navigation.navigate('PrivacyAndDisplay', { RKBackedUp: true, oldPasscode })
              : () => {}
          }
          title={BackupWallet.backupSuccessTitle}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          buttonText={common.done}
          buttonCallback={
            isChangePassword
              ? () => navigation.navigate('PrivacyAndDisplay', { RKBackedUp: true, oldPasscode })
              : () => navigation.replace('WalletBackHistory')
          }
          Content={() => (
            <Box>
              <Box>
                <Illustration />
              </Box>
              <Box>
                <Text>{BackupWallet.backupSuccessParagraph}</Text>
              </Box>
            </Box>
          )}
        />

        <KeeperModal
          visible={showQRVisible}
          close={() => setShowQRVisible(false)}
          title={BackupWallet.recoveryPhrase}
          subTitleWidth={wp(260)}
          subTitle={BackupWallet.recoveryPhraseSubTitle}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          buttonText={common.done}
          buttonCallback={() => setShowQRVisible(false)}
          Content={() => (
            <ShowXPub
              data={JSON.stringify(words)}
              subText={seedTranslation.walletRecoveryPhrase}
              noteSubText={seedTranslation.showXPubNoteSubText}
              copyable={false}
            />
          )}
        />
      </Box>
    </ScreenWrapper>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  seedCardContainer: {
    width: '50%',
  },
  seedCardWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 10,
    marginHorizontal: 8,
    marginVertical: 10,
  },
  seedTextStyle: {
    fontSize: 19,
    letterSpacing: 1.64,
    marginRight: 5,
  },
  seedTextStyle01: {
    fontSize: 19,
    fontWeight: '400',
    letterSpacing: 1,
  },
  nextButtonWrapper: {
    alignItems: 'flex-end',
    paddingHorizontal: '3%',
    paddingTop: '3%',
    marginBottom: 5,
  },
  seedDescParagraph: {
    marginHorizontal: 2,
    marginTop: 5,
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0.6,
    marginRight: 10,
  },
  qrItemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginBottom: hp(15),
  },
  qrItem: {
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  derivationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 10,
    marginHorizontal: 8,
    marginTop: 10,
    alignSelf: 'center',
    width: wp(150),
  },
  backArrow: {
    width: '15%',
    alignItems: 'center',
  },
});
export default ExportSeedScreen;
