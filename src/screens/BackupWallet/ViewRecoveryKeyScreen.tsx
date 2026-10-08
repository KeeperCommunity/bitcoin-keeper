import React, { useContext, useEffect, useState } from 'react';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { hp } from 'src/constants/responsive';
import WalletHeader from 'src/components/WalletHeader';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import Text from 'src/components/KeeperText';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import Buttons from 'src/components/Buttons';
import ModalWrapper from 'src/components/Modal/ModalWrapper';
import ConfirmSeedWord from 'src/components/SeedWordBackup/ConfirmSeedWord';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { backupAllSignersAndVaults, seedBackedUp } from 'src/store/sagaActions/bhr';
import { useDispatch } from 'react-redux';
import { setRecoveryKeyStatus } from 'src/store/reducers/account';
import { useAppSelector } from 'src/store/hooks';
import useToastMessage from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import {
  setAutomaticCloudBackup,
  setBackupAllFailure,
  setBackupAllSuccess,
} from 'src/store/reducers/bhr';

type KeeperApp = {
  id: string;
  primaryMnemonic: string;
};

export const ViewRecoveryKeyScreen = ({ navigation }) => {
  const { colorMode } = useColorMode();
  const { home: homeTxt, common, BackupWallet: backupTxt, recoveryBackup } = useContext(LocalizationContext).translations;
  const { primaryMnemonic, id: appId } = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0] as KeeperApp;
  const [words, _] = useState(primaryMnemonic.split(' '));
  const [showWordIndex, setShowWordIndex] = useState<string | number>('');
  const seedTextColor = ThemedColor({ name: 'seedTextColor' });
  const [confirmSeedModal, setConfirmSeedModal] = useState(false);
  const [loader, setLoader] = useState(false);
  const dispatch = useDispatch();
  const { backupAllFailure, backupAllSuccess } = useAppSelector((state) => state.bhr);
  const { showToast } = useToastMessage();

  useEffect(() => {
    if (backupAllSuccess) {
      dispatch(setBackupAllSuccess(false));
      dispatch(setBackupAllFailure(false));
      dispatch(setAutomaticCloudBackup(true));
      setLoader(false);
      showToast(backupTxt.recoveryKeyBackedUpSuccessfully, <TickIcon />);
      navigation.goBack();
    }
    if (backupAllFailure) {
      dispatch(setBackupAllFailure(false));
      setLoader(false);
      showToast(recoveryBackup.unverified.title);
    }
  }, [backupAllSuccess, backupAllFailure]);

  const SeedCard = ({ item, index }: { item; index }) => {
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
  };

  const renderSeedCard = ({ item, index }: { item; index }) => (
    <SeedCard item={item} index={index} />
  );

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={backupTxt.yourRecoveryKey} enableBack={true} backCallback={() => navigation.goBack()} />
      <Box style={styles.ctr}>
        <Box>
          <Box style={styles.desc}>
            <Text>{backupTxt.writeDownRecoveryKey}</Text>
            <Text style={styles.warningNote}>{backupTxt.doNotStoreDigitally}: {backupTxt.doNotStoreDigitallyBody}</Text>
          </Box>

          {/* Seed Words */}
          <FlatList
            data={words}
            numColumns={2}
            showsVerticalScrollIndicator={false}
            renderItem={renderSeedCard}
            keyExtractor={(item) => item}
          />
          <Text style={styles.noOneLooking}>{backupTxt.makeNoOneLooking}</Text>
        </Box>
        <Buttons
          primaryText={backupTxt.iHaveWrittenItDown}
          primaryCallback={() => setConfirmSeedModal(true)}
          secondaryText={common.back}
          secondaryCallback={() => navigation.goBack()}
        />
      </Box>
      <Box>
        <ModalWrapper
          visible={confirmSeedModal}
          onSwipeComplete={() => setConfirmSeedModal(false)}
          position="center"
        >
          <ConfirmSeedWord
            title={backupTxt.confirmSeedWord}
            errorMessage={'That word does not match. Please check your Recovery Key and try again.'}
            secondaryText={common.back}
            closeBottomSheet={() => {
              setConfirmSeedModal(false);
            }}
            words={words}
            confirmBtnPress={() => {
              setConfirmSeedModal(false);
              setLoader(true);
              dispatch(seedBackedUp());
              dispatch(setRecoveryKeyStatus({ appId, status: 'confirmed' }));
              dispatch(backupAllSignersAndVaults());
            }}
          />
        </ModalWrapper>
        <ActivityIndicatorView visible={loader} />
      </Box>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  ctr: {
    flex: 1,
    justifyContent: 'space-between',
  },

  desc: {
    marginVertical: hp(10),
    gap: hp(10),
  },

  warningNote: {
    fontSize: 13,
    opacity: 0.7,
  },

  noOneLooking: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: hp(8),
    opacity: 0.7,
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
});
