import React, { useContext, useEffect, useState } from 'react';
import { Box, useColorMode } from 'native-base';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ScreenWrapper from 'src/components/ScreenWrapper';
import KeeperModal from 'src/components/KeeperModal';
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
import { CommonActions } from '@react-navigation/native';
import { backupAllSignersAndVaults, seedBackedUp } from 'src/store/sagaActions/bhr';
import { useDispatch } from 'react-redux';
import { setRecoveryKeyBackedUp } from 'src/store/reducers/account';
import { useAppSelector } from 'src/store/hooks';
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
  const { home: homeTxt, common, BackupWallet:backupTxt } = useContext(LocalizationContext).translations;
  const { primaryMnemonic, id: appId } = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0] as KeeperApp;
  const [words, _] = useState(primaryMnemonic.split(' '));
  const [showWordIndex, setShowWordIndex] = useState<string | number>('');
  const seedTextColor = ThemedColor({ name: 'seedTextColor' });
  const [confirmSeedModal, setConfirmSeedModal] = useState(true);
  const [loader, setLoader] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const dispatch = useDispatch();
  const { backupAllFailure, backupAllSuccess } = useAppSelector((state) => state.bhr);
  const [title, setTitle] = useState(homeTxt.backupModalTitle);

  useEffect(() => {
    if (backupAllSuccess || backupAllFailure) {
      dispatch(setBackupAllSuccess(false));
      dispatch(setBackupAllFailure(false));
      dispatch(setAutomaticCloudBackup(true));
      setShowSuccess(true);
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
      <WalletHeader title={title} enableBack={false} />
      <Box style={styles.ctr}>
        <Box>
          <Box style={styles.desc}>
            <Text>{backupTxt.recoveryConfirmDesc1}</Text>
            <Text>{backupTxt.recoveryConfirmDesc2}</Text>
          </Box>

          {/* Seed Words */}
          <FlatList
            data={words}
            numColumns={2}
            showsVerticalScrollIndicator={false}
            renderItem={renderSeedCard}
            keyExtractor={(item) => item}
          />
        </Box>
        <Buttons primaryText={common.confirm} primaryCallback={() => setConfirmSeedModal(true)} />
      </Box>
      <Box>
        <ModalWrapper
          visible={confirmSeedModal}
          onSwipeComplete={() => setConfirmSeedModal(false)}
          position="center"
        >
          <ConfirmSeedWord
            title={homeTxt.backupModalTitle}
            errorMessage={'Incorrect word. Try again.'}
            secondaryText={'Write it down'}
            closeBottomSheet={() => {
              setConfirmSeedModal(false);
              setTitle('Write down your Recovery Key');
            }}
            words={words}
            confirmBtnPress={() => {
              setConfirmSeedModal(false);
              setLoader(true);
              dispatch(seedBackedUp());
              dispatch(setRecoveryKeyBackedUp({ appId, status: true }));
              dispatch(backupAllSignersAndVaults());
            }}
          />
        </ModalWrapper>

        <KeeperModal
          visible={showSuccess}
          dismissible={false}
          title={backupTxt.recoveryKeyConfirmDialog}
          subTitle={backupTxt.recoveryKeyConfirmDialogSubTitle}
          close={() => {}}
          showCloseIcon={false}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          buttonText={'Finish'}
          buttonCallback={() =>
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Home' }],
              })
            )
          }
        />
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
