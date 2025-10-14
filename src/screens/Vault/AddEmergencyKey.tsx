import { Box, useColorMode, ScrollView } from 'native-base';
import React, { useCallback, useContext, useState, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import HorizontalAddCard from 'src/components/HorizontalAddCard';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { hp, wp } from 'src/constants/responsive';
import OptionPicker from 'src/components/OptionPicker';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ADDEMERGENCYKEY } from 'src/navigation/contants';
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
  MONTHS_36,
  MONTHS_30,
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
import KeeperModal from 'src/components/KeeperModal';
import SuccessIcon from 'src/assets/images/successSvg.svg';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { EMERGENCY_KEY_IDENTIFIER } from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import WalletHeader from 'src/components/WalletHeader';
import { AddKeyButton } from '../SigningDevices/components/AddKeyButton';
import { TouchableOpacity } from 'react-native-gesture-handler';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

export const DEFAULT_EMERGENCY_KEY_TIMELOCK = { label: MONTHS_36, value: MONTHS_36 };
export const EMERGENCY_TIMELOCK_DURATIONS = [
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

function AddEmergencyKey({ route }) {
  const {
    vaultKeys: vaultKeysParam,
    name,
    scheme,
    description,
    vaultId,
    hasInitialTimelock,
    isAddInheritanceKey,
    isAddEmergencyKey,
    currentBlockHeight: currentBlockHeightParam,
    keyToRotate,
    inheritanceKeys = [],
    initialTimelockDuration,
  } = route.params;
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { signerMap } = useSignerMap();
  const { translations } = useContext(LocalizationContext);
  const {
    common,
    vault: vaultTranslations,
    wallet: walletTranslations,
    error: errorText,
  } = translations;
  const { showToast } = useToastMessage();

  // Make emergencyKeysCount a state variable
  const [emergencyKeysCount, setEmergencyKeysCount] = useState(1);

  const [selectedEmergencyKeys, setSelectedEmergencyKeys] = useState<
    Array<{
      signer: any;
      option: any;
    }>
  >(() => {
    // Initialize with empty slots based on emergencyKeysCount
    return Array(emergencyKeysCount)
      .fill(null)
      .map(() => ({
        signer: null,
        option: DEFAULT_EMERGENCY_KEY_TIMELOCK,
      }));
  });
  const { activeVault } = useVault({ vaultId });
  const vaultKeys = vaultKeysParam || activeVault?.signers || [];
  const [vaultCreating, setCreating] = useState(false);
  const [vaultCreatedModalVisible, setVaultCreatedModalVisible] = useState(false);
  const [generatedVaultId, setGeneratedVaultId] = useState('');
  const { relayVaultUpdateLoading } = useAppSelector((state) => state.bhr);
  const [currentBlockHeight, setCurrentBlockHeight] = useState(currentBlockHeightParam);
  const box_background = ThemedColor({ name: 'msg_preview_background' });
  const box_border = ThemedColor({ name: 'msg_preview_border' });

  const isDarkMode = colorMode === 'dark';

  useEffect(() => {
    if (
      !activeVault?.id ||
      !activeVault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints
    )
      return;

    const emergencyKeysFingerprints = Object.entries(
      activeVault.scheme.miniscriptScheme.miniscriptElements.signerFingerprints
    ).filter(([key]) => key.startsWith(EMERGENCY_KEY_IDENTIFIER));

    if (!emergencyKeysFingerprints.length) return;

    const emergencyKeys = emergencyKeysFingerprints
      .map(([_, fingerprint]) =>
        activeVault.signers.find((key) => key.masterFingerprint === fingerprint)
      )
      .filter(Boolean);

    if (emergencyKeys.length > 0) {
      const emergencyKeysWithOptions = emergencyKeys.map((key) => ({
        signer: getKeyUID(keyToRotate) == getKeyUID(key) ? null : key,
        option: DEFAULT_EMERGENCY_KEY_TIMELOCK,
      }));
      setSelectedEmergencyKeys(emergencyKeysWithOptions);
      setEmergencyKeysCount(emergencyKeys.length);
    }
  }, [activeVault?.id, keyToRotate]);

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

  const userKeyCallback = useCallback(
    (index: number) => {
      navigation.push('AddSigningDevice', {
        parentScreen: ADDEMERGENCYKEY,
        selectedSignersFromParams: selectedEmergencyKeys
          .filter((_, keyIndex) => keyIndex !== index)
          .map((key) => key.signer)
          .filter(Boolean),
        scheme,
        isAddInheritanceKey,
        isAddEmergencyKey,
        hasInitialTimelock,
        currentBlockHeight,
        onGoBack: (signer) => {
          // Handle the case where signer is an array
          const actualSigner = Array.isArray(signer) ? signer[0] : signer;

          setSelectedEmergencyKeys((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], signer: actualSigner };
            return updated;
          });
        },
      });
    },
    [
      navigation,
      vaultKeys,
      route.params.selectedSigners,
      scheme,
      isAddInheritanceKey,
      isAddEmergencyKey,
      hasInitialTimelock,
      currentBlockHeight,
      selectedEmergencyKeys,
    ]
  );

  // Get the actual signer objects from signerMap
  const emergencyKeysWithSigners = useMemo(() => {
    return selectedEmergencyKeys.map((emergencyKey) => {
      // If we have a signer in state, get the proper one from signerMap
      let signer = emergencyKey.signer;
      if (emergencyKey.signer && signerMap) {
        // Handle the case where signer might be an array
        const signerToProcess = Array.isArray(emergencyKey.signer)
          ? emergencyKey.signer[0]
          : emergencyKey.signer;

        if (signerToProcess && signerToProcess.masterFingerprint) {
          const signerId = getKeyUID(signerToProcess);
          signer = signerMap[signerId] || signerToProcess;
        }
      }

      return {
        ...emergencyKey,
        signer,
      };
    });
  }, [selectedEmergencyKeys, signerMap]);

  // Add function to add emergency key
  const addEmergencyKey = () => {
    if (emergencyKeysCount === 5) {
      showToast(errorText.maximumEmergencyKeysReached, <ToastErrorIcon />);
      return;
    }
    setEmergencyKeysCount((prev) => prev + 1);
    setSelectedEmergencyKeys((prev) => [
      ...prev,
      {
        signer: null,
        option: DEFAULT_EMERGENCY_KEY_TIMELOCK,
      },
    ]);
  };

  // Add function to remove emergency key
  const removeEmergencyKey = (index: number) => {
    if (emergencyKeysCount > 1) {
      setEmergencyKeysCount((prev) => prev - 1);
      setSelectedEmergencyKeys((prev) => prev.filter((_, i) => i !== index));
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={`${vaultTranslations.addEmergencyKey}`}
        subTitle={vaultTranslations.setEmergencyKeyForVault}
      />
      <Box style={styles.container}>
        <Box style={styles.addKeyButtonContainer}>
          <AddKeyButton
            short
            onPress={addEmergencyKey}
            buttonText={vaultTranslations.AddAnotherEmergencyKey}
          />
        </Box>
        <ScrollView showsVerticalScrollIndicator={false}>
          {emergencyKeysWithSigners.map((emergencyKey, index) => {
            return (
              <Box
                key={index}
                style={styles.contentContainer}
                backgroundColor={box_background}
                borderColor={box_border}
              >
                <Box>
                  <Box style={styles.cardContainer}>
                    {!emergencyKey.signer ? (
                      <HorizontalAddCard
                        name={vaultTranslations.addEmergencyKey}
                        cardStyles={{ minHeight: hp(92) }}
                        iconWidth={25}
                        iconHeight={22}
                        callback={() => userKeyCallback(index)}
                        KeyIcon={isDarkMode ? KEEPERAPPLIGHT : KEEPERAPP}
                      />
                    ) : (
                      <HorizontalSignerCard
                        key={getKeyUID(emergencyKey.signer)}
                        name={getSignerNameFromType(
                          emergencyKey.signer.type,
                          emergencyKey.signer.isMock,
                          false
                        )}
                        description={getSignerDescription(emergencyKey.signer)}
                        icon={SDIcons({ type: emergencyKey.signer.type }).Icon}
                        isSelected={false}
                        showSelection={false}
                        changeKey={() => userKeyCallback(index)}
                        colorMode={colorMode}
                      />
                    )}
                  </Box>
                </Box>
                <Box>
                  <Box style={styles.textContainer}>
                    <Text color={`${colorMode}.primaryText`}>
                      {vaultTranslations.emergencyKeyActivation}
                    </Text>
                    <Text color={`${colorMode}.greenishGreyText`} fontSize={12}>
                      {vaultTranslations.availableAfterDelay}
                    </Text>
                  </Box>
                  <Box style={styles.dropDownContainer}>
                    <OptionPicker
                      label={vaultTranslations.selectActivationTime}
                      options={EMERGENCY_TIMELOCK_DURATIONS}
                      selectedOption={emergencyKey.option}
                      onOptionSelect={(option) => {
                        setSelectedEmergencyKeys((prev) => {
                          const updated = [...prev];
                          updated[index] = { ...updated[index], option };
                          return updated;
                        });
                      }}
                    />
                  </Box>
                  {/* Remove button - only show if there's more than 1 key */}
                  {emergencyKeysCount > 1 && (
                    <Box style={styles.removeButtonContainer}>
                      <TouchableOpacity
                        onPress={() => removeEmergencyKey(index)}
                        style={styles.removeButton}
                        testID={`btn_remove_inheritance_key_${index}`}
                      >
                        <Text
                          color={`${colorMode}.DarkSlateGray`}
                          fontSize={14}
                          style={styles.removeButtonText}
                          semiBold
                        >
                          {common.removeKey}
                        </Text>
                      </TouchableOpacity>
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </ScrollView>
        <Box style={styles.bottomContainer}>
          <Buttons
            primaryLoading={vaultCreating || relayVaultUpdateLoading}
            primaryText={common.confirm}
            fullWidth
            primaryDisable={selectedEmergencyKeys.some((key) => !key.option || !key.signer)}
            primaryCallback={() => {
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
                reservedKeys: inheritanceKeys,
                emergencyKeys: selectedEmergencyKeys
                  .filter((key) => key.signer)
                  .filter((key) => key.option)
                  .map((key) => ({
                    key: key.signer,
                    duration: key.option.label,
                  })),
                selectedSigners: route.params.selectedSigners,
                vaultId,
                initialTimelockDuration,
              });
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
              Object.entries(
                activeVault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints || {}
              )
                .filter(([key]) => key.startsWith('K'))
                .map(([_, value]) => value)
                .includes(signer.masterFingerprint) ||
              !Object.entries(
                activeVault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints || {}
              )
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
        inheritanceKeys={inheritanceKeys}
        emergencyKeys={selectedEmergencyKeys
          .filter((key) => key.signer)
          .filter((key) => key.option)
          .map((key) => ({
            key: key.signer,
            duration: key.option.label,
          }))}
        initialTimelockDuration={initialTimelockDuration ?? 0}
        currentBlockHeight={currentBlockHeight}
        miniscriptTypes={[
          ...(hasInitialTimelock ? [MiniscriptTypes.TIMELOCKED] : []),
          ...(inheritanceKeys.length ? [MiniscriptTypes.INHERITANCE] : []),
          MiniscriptTypes.EMERGENCY,
        ]}
        setVaultCreatedModalVisible={setVaultCreatedModalVisible}
      />
    </ScreenWrapper>
  );
}

export default AddEmergencyKey;

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
    marginBottom: hp(25),
    padding: hp(16),
    borderWidth: 1,
    borderRadius: 10,
  },
  dropDownContainer: {
    marginTop: hp(20),
  },
  bottomContainer: {
    gap: hp(20),
  },
  removeButtonContainer: {
    marginTop: hp(15),
    alignItems: 'center',
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: hp(8),
    paddingHorizontal: wp(12),
  },
  removeButtonText: {
    marginLeft: wp(4),
  },
  addKeyButtonContainer: {
    marginBottom: hp(20),
  },
});
