import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useCallback, useContext, useState, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import HorizontalAddCard from 'src/components/HorizontalAddCard';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { hp, wp } from 'src/constants/responsive';
import OptionPicker from 'src/components/OptionPicker';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ADDRESERVEKEY } from 'src/navigation/contants';
import useSignerMap from 'src/hooks/useSignerMap';
import { getSignerDescription, getSignerNameFromType } from 'src/hardware';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import KEEPERAPP from 'src/assets/images/KeeperIcon.svg';
import KEEPERAPPLIGHT from 'src/assets/images/KeeperIconLight.svg';
import Buttons from 'src/components/Buttons';
import { SDIcons } from './SigningDeviceIcons';
import HorizontalSignerCard from '../AddSigner/HorizontalSignerCard';
import {
  MONTHS_12,
  MONTHS_24,
  MONTHS_18,
  MONTHS_6,
  MONTHS_30,
  MONTHS_36,
  MONTHS_42,
  MONTHS_48,
  MONTHS_54,
  MONTHS_60,
} from './constants';
import { getKeyUID } from 'src/utils/utilities';
import { MiniscriptTypes, VaultType } from 'src/services/wallets/enums';
import useVault from 'src/hooks/useVault';
import VaultMigrationController from './VaultMigrationController';
import { useAppSelector } from 'src/store/hooks';
import { useDispatch } from 'react-redux';
import useToastMessage from 'src/hooks/useToastMessage';
import KeeperModal from 'src/components/KeeperModal';
import SuccessIcon from 'src/assets/images/successSvg.svg';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { INHERITANCE_KEY_IDENTIFIER } from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import WalletHeader from 'src/components/WalletHeader';

export const DEFAULT_INHERITANCE_KEY_TIMELOCK = { label: MONTHS_12, value: MONTHS_12 };
export const INHERITANCE_TIMELOCK_DURATIONS = [
  { label: MONTHS_6, value: MONTHS_6 },
  { label: MONTHS_12, value: MONTHS_12 },
  { label: MONTHS_18, value: MONTHS_18 },
  { label: MONTHS_24, value: MONTHS_24 },
  { label: MONTHS_30, value: MONTHS_30 },
  { label: MONTHS_36, value: MONTHS_36 },
  { label: MONTHS_42, value: MONTHS_42 },
  { label: MONTHS_48, value: MONTHS_48 },
  { label: MONTHS_54, value: MONTHS_54 },
  { label: MONTHS_60, value: MONTHS_60 },
];

function AddReserveKey({ route }) {
  const {
    vaultKeys: vaultKeysParam,
    name,
    scheme,
    description,
    vaultId,
    isAddInheritanceKey,
    isAddEmergencyKey,
    hasInitialTimelock,
    currentBlockHeight: currentBlockHeightParam,
    keyToRotate,
    initialTimelockDuration,
  } = route.params;
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { signerMap } = useSignerMap();
  const { translations } = useContext(LocalizationContext);
  const { common, vault: vaultTranslations, wallet: walletTranslations } = translations;
  const [selectedOption, setSelectedOption] = useState(DEFAULT_INHERITANCE_KEY_TIMELOCK);
  const [selectedSigner, setSelectedSigner] = useState(null);
  const { activeVault, allVaults } = useVault({ vaultId });
  const vaultKeys = vaultKeysParam || activeVault?.signers || [];
  const [vaultCreating, setCreating] = useState(false);
  const [vaultCreatedModalVisible, setVaultCreatedModalVisible] = useState(false);
  const [generatedVaultId, setGeneratedVaultId] = useState('');
  const newVault = allVaults.filter((v) => v.id === generatedVaultId)[0];
  const { relayVaultUpdate, relayVaultError, realyVaultErrorMessage, relayVaultUpdateLoading } =
    useAppSelector((state) => state.bhr);
  const { showToast } = useToastMessage();
  const [currentBlockHeight, setCurrentBlockHeight] = useState(currentBlockHeightParam);

  const dispatch = useDispatch();

  // TODO: Allow multiple inheritance keys
  const reservedKey = useMemo(() => {
    if (!selectedSigner || !signerMap) return null;
    return signerMap[getKeyUID(selectedSigner[0])];
  }, [selectedSigner, signerMap]);

  const isDarkMode = colorMode === 'dark';

  useEffect(() => {
    if (selectedSigner) return;

    if (
      !activeVault?.id ||
      !activeVault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints
    )
      return;

    // TODO: Support multiple inheritance keys
    const inheritanceKeyFingerprint = Object.entries(
      activeVault.scheme.miniscriptScheme.miniscriptElements.signerFingerprints
    ).find(([key]) => key.startsWith(INHERITANCE_KEY_IDENTIFIER))?.[1];

    if (!inheritanceKeyFingerprint) return;

    const inheritanceKey = activeVault.signers.find(
      (key) => key.masterFingerprint === inheritanceKeyFingerprint
    );

    if (inheritanceKey && (!keyToRotate || getKeyUID(inheritanceKey) !== getKeyUID(keyToRotate))) {
      setSelectedSigner([inheritanceKey]);
    }
  }, [activeVault?.id, keyToRotate, selectedSigner]);

  const viewVault = () => {
    setVaultCreatedModalVisible(false);
    const navigationState = {
      index: 1,
      routes: [
        { name: 'Home' },
        {
          name: 'VaultDetails',
          params: { vaultId: generatedVaultId, vaultTransferSuccessful: true },
        },
      ],
    };
    navigation.dispatch(CommonActions.reset(navigationState));
  };

  useEffect(() => {
    if (!currentBlockHeight) {
      WalletUtilities.fetchCurrentBlockHeight()
        .then(({ currentBlockHeight }) => {
          setCurrentBlockHeight(currentBlockHeight);
        })
        .catch((err) => console.log('Failed to fetch the current chain data:', err));
    }
  }, []);

  const userKeyCallback = useCallback(() => {
    navigation.push('AddSigningDevice', {
      parentScreen: ADDRESERVEKEY,
      selectedSignersFromParams:
        vaultKeys && vaultKeys.length > 0 ? vaultKeys : route.params.selectedSigners,
      scheme,
      isAddInheritanceKey,
      isAddEmergencyKey,
      hasInitialTimelock,
      initialTimelockDuration,
      currentBlockHeight,
      onGoBack: (signer) => setSelectedSigner(signer),
    });
  }, [
    navigation,
    vaultKeys,
    route.params.selectedSigners,
    selectedSigner,
    scheme,
    isAddInheritanceKey,
    isAddEmergencyKey,
    hasInitialTimelock,
    initialTimelockDuration,
    currentBlockHeight,
  ]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={`${vaultTranslations.addInheritanceKey}`}
        subTitle={vaultTranslations.setIKSForVault}
      />
      <Box style={styles.container}>
        <Box style={styles.contentContainer}>
          <Box>
            <Box style={styles.cardContainer}>
              {!reservedKey ? (
                <HorizontalAddCard
                  name={vaultTranslations.addInheritanceKey}
                  cardStyles={{ minHeight: hp(92) }}
                  iconWidth={25}
                  iconHeight={22}
                  callback={userKeyCallback}
                  KeyIcon={isDarkMode ? KEEPERAPPLIGHT : KEEPERAPP}
                />
              ) : (
                <HorizontalSignerCard
                  key={getKeyUID(reservedKey)}
                  name={getSignerNameFromType(reservedKey.type, reservedKey.isMock, false)}
                  description={getSignerDescription(reservedKey)}
                  icon={SDIcons({ type: reservedKey.type }).Icon}
                  isSelected={false}
                  showSelection={false}
                  changeKey={userKeyCallback}
                  colorMode={colorMode}
                />
              )}
            </Box>
          </Box>
          <Box>
            <Box style={styles.textContainer}>
              <Text color={`${colorMode}.primaryText`}>
                {vaultTranslations.inheritanceKeyActivation}
              </Text>
              <Text color={`${colorMode}.greenishGreyText`} fontSize={12}>
                {vaultTranslations.availableAfterDelay}
              </Text>
            </Box>
            <Box style={styles.dropDownContainer}>
              <OptionPicker
                label={vaultTranslations.selectActivationTime}
                options={INHERITANCE_TIMELOCK_DURATIONS}
                selectedOption={selectedOption}
                onOptionSelect={(option) => setSelectedOption(option)}
              />
            </Box>
          </Box>
        </Box>
        <Box style={styles.bottomContainer}>
          <Buttons
            primaryLoading={vaultCreating || relayVaultUpdateLoading}
            primaryText={common.confirm}
            fullWidth
            primaryDisable={!selectedSigner || !selectedOption}
            primaryCallback={() => {
              if (isAddEmergencyKey) {
                navigation.navigate('AddEmergencyKey', {
                  vaultKeys,
                  vaultId,
                  scheme,
                  name,
                  description,
                  isAddInheritanceKey,
                  isAddEmergencyKey,
                  hasInitialTimelock,
                  currentBlockHeight,
                  selectedSigners: route.params.selectedSigners,
                  keyToRotate,
                  inheritanceKeys: selectedSigner
                    ? [{ key: selectedSigner[0], duration: selectedOption.label }]
                    : [],
                  initialTimelockDuration,
                });
              } else {
                if (vaultId) {
                  setCreating(true);
                  return;
                }
                navigation.navigate('ConfirmWalletDetails', {
                  vaultKeys,
                  scheme,
                  isHotWallet: false,
                  vaultType: VaultType.MINISCRIPT,
                  isAddInheritanceKey,
                  isAddEmergencyKey,
                  hasInitialTimelock,
                  currentBlockHeight,
                  hotWalletInstanceNum: null,
                  reservedKeys: selectedSigner
                    ? [{ key: selectedSigner[0], duration: selectedOption.label }]
                    : [],
                  selectedSigners: route.params.selectedSigners,
                  vaultId,
                  initialTimelockDuration,
                });
              }
            }}
          />
        </Box>
      </Box>
      <KeeperModal
        dismissible
        close={() => {}}
        visible={vaultCreatedModalVisible}
        title={vaultTranslations.keyReplacedSuccessfully}
        subTitle={vaultTranslations.replacedKeyMessage}
        Content={() => {
          return (
            <Box flex={1} alignItems={'center'}>
              <SuccessIcon />
            </Box>
          );
        }}
        buttonText={walletTranslations.ViewWallet}
        buttonCallback={viewVault}
        secondaryCallback={viewVault}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        subTitleWidth={wp(280)}
        showCloseIcon={false}
      />
      <VaultMigrationController
        vaultCreating={vaultCreating}
        vaultKeys={vaultKeys
          .filter((key) => (keyToRotate ? getKeyUID(key) !== getKeyUID(keyToRotate) : true))
          .filter(
            (signer) =>
              !Object.entries(
                activeVault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints || {}
              )
                .filter(([key]) => key.startsWith(INHERITANCE_KEY_IDENTIFIER))
                .map(([_, value]) => value)
                .includes(signer.masterFingerprint)
          )}
        scheme={scheme}
        name={name}
        description={description}
        vaultId={vaultId}
        setGeneratedVaultId={setGeneratedVaultId}
        setCreating={setCreating}
        vaultType={VaultType.MINISCRIPT}
        inheritanceKeys={
          selectedSigner ? [{ key: selectedSigner[0], duration: selectedOption.label }] : []
        }
        initialTimelockDuration={initialTimelockDuration}
        currentBlockHeight={currentBlockHeight}
        miniscriptTypes={[
          ...(hasInitialTimelock ? [MiniscriptTypes.TIMELOCKED] : []),
          MiniscriptTypes.INHERITANCE,
        ]}
        setVaultCreatedModalVisible={setVaultCreatedModalVisible}
      />
    </ScreenWrapper>
  );
}

export default AddReserveKey;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: hp(20),
    paddingHorizontal: wp(10),
    justifyContent: 'space-between',
  },
  textContainer: {
    gap: hp(5),
  },
  cardContainer: {
    marginTop: hp(5),
  },
  contentContainer: {
    gap: hp(25),
  },
  dropDownContainer: {
    marginTop: hp(20),
  },
  bottomContainer: {
    gap: hp(20),
  },
});
