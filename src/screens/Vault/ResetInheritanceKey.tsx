import { Box, useColorMode } from 'native-base';
import React, { useContext, useState, useEffect } from 'react';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { StyleSheet, ScrollView } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import Text from 'src/components/KeeperText';
import { CommonActions, useNavigation } from '@react-navigation/native';
import Buttons from 'src/components/Buttons';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useSignerMap from 'src/hooks/useSignerMap';
import { Signer, Vault } from 'src/services/wallets/interfaces/vault';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { getKeyUID } from 'src/utils/utilities';
import OptionPicker from 'src/components/OptionPicker';
import { getSignerDescription } from 'src/hardware';
import IKSInfocard from './components/IKSInfoCard';
import { SDIcons } from './SigningDeviceIcons';
import VaultMigrationController from './VaultMigrationController';
import { INHERITANCE_TIMELOCK_DURATIONS } from './AddReserveKey';
import {
  getKeyTimelock,
  getVaultEnhancedSigners,
  INHERITANCE_KEY_IDENTIFIER,
} from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import WalletHeader from 'src/components/WalletHeader';
import { isVaultUsingBlockHeightTimelock } from 'src/services/wallets/factories/VaultFactory';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

function ResetInheritanceKey({ route }) {
  const {
    initialTimelockDuration,
    vault,
  }: { initialTimelockDuration; signerIds: string[]; vault: Vault } = route.params;
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { signerMap } = useSignerMap();
  const { translations } = useContext(LocalizationContext);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, any>>({});
  const { inheritanceSigners, emergencySigners, otherSigners } = getVaultEnhancedSigners(vault);
  const hasEmergencyKeys = emergencySigners.length > 0;
  const signers: Signer[] = inheritanceSigners.map(
    (emergencySigner) => signerMap[getKeyUID(emergencySigner)]
  );
  const { vault: vaultText, common, error: errorText } = translations;
  const { showToast } = useToastMessage();
  const [generatedVaultId, setGeneratedVaultId] = useState('');
  const [vaultCreating, setCreating] = useState(false);
  const [currentMedianTimePast, setCurrentMedianTimePast] = useState(null);
  const [currentBlockHeight, setCurrentBlockHeight] = useState(null);
  const [activationTimes, setActivationTimes] = useState<Record<string, string>>({});
  const box_background = ThemedColor({ name: 'msg_preview_background' });
  const box_border = ThemedColor({ name: 'msg_preview_border' });

  const handleResetInheritanceKey = async () => {
    const hasAllSelections = inheritanceSigners
      .map((signer) => getKeyUID(signer))
      .every((id) => selectedOptions[id]);
    if (!hasAllSelections) {
      showToast(
        errorText.selectActivationTime +
          (inheritanceSigners.length === 1 ? '' : errorText.forAllInheritanceKey),
        <ToastErrorIcon />
      );
      setCreating(false);
      return false;
    }
    let currentSyncedBlockHeight = currentBlockHeight;
    if (!currentSyncedBlockHeight) {
      try {
        currentSyncedBlockHeight = (await WalletUtilities.fetchCurrentBlockHeight())
          .currentBlockHeight;
      } catch (err) {
        console.log('Failed to re-fetch current block height: ' + err);
      }
      if (!currentSyncedBlockHeight) {
        showToast(errorText.failedToFetchCurrentChain, <ToastErrorIcon />);
        setCreating(false);
        return false;
      }
    }
    return true;
  };

  useEffect(() => {
    if (isVaultUsingBlockHeightTimelock(vault)) {
      WalletUtilities.fetchCurrentBlockHeight()
        .then(({ currentBlockHeight }) => {
          setCurrentBlockHeight(currentBlockHeight);
        })
        .catch((err) => showToast(err));
    } else {
      WalletUtilities.fetchCurrentMedianTime()
        .then(({ currentMedianTime }) => {
          setCurrentMedianTimePast(currentMedianTime);
        })
        .catch((err) => showToast(err));
    }
  }, []);

  useEffect(() => {
    try {
      if (
        (isVaultUsingBlockHeightTimelock(vault) && !currentBlockHeight) ||
        (!isVaultUsingBlockHeightTimelock(vault) && !currentMedianTimePast)
      ) {
        setActivationTimes((prev) => {
          const newTimes = {};
          inheritanceSigners.forEach((signer) => {
            newTimes[getKeyUID(signer)] = 'Loading time until activation...';
          });
          return newTimes;
        });
        return;
      }

      signers.forEach((signer) => {
        let secondsUntilActivation = 0;
        if (isVaultUsingBlockHeightTimelock(vault)) {
          const blocksUntilActivation =
            getKeyTimelock(
              Object.entries(vault.scheme.miniscriptScheme.keyInfoMap)
                .find(
                  ([identifier, descriptor]) =>
                    identifier.startsWith(INHERITANCE_KEY_IDENTIFIER) &&
                    descriptor.substring(1, 9) === signer.masterFingerprint
                )[0]
                .split('<')[0],
              vault.scheme.miniscriptScheme.miniscriptElements
            ) - currentBlockHeight;
          secondsUntilActivation = blocksUntilActivation * 10 * 60;
        } else {
          secondsUntilActivation =
            getKeyTimelock(
              Object.entries(vault.scheme.miniscriptScheme.keyInfoMap)
                .find(
                  ([identifier, descriptor]) =>
                    identifier.startsWith(INHERITANCE_KEY_IDENTIFIER) &&
                    descriptor.substring(1, 9) === signer.masterFingerprint
                )[0]
                .split('<')[0],
              vault.scheme.miniscriptScheme.miniscriptElements
            ) - currentMedianTimePast;
        }

        let timeString = '';

        if (secondsUntilActivation > 0) {
          const days = Math.floor(secondsUntilActivation / (24 * 60 * 60));
          const months = Math.floor(days / 30);

          if (months > 0) {
            timeString = `${months} month${months > 1 ? 's' : ''}`;
          } else if (days > 0) {
            timeString = `${days} day${days > 1 ? 's' : ''}`;
          } else {
            const hours = Math.floor(secondsUntilActivation / 3600);
            const minutes = Math.floor((secondsUntilActivation % 3600) / 60);
            timeString = `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${
              minutes > 1 ? 's' : ''
            }`;
          }
        } else {
          timeString = vaultText.IKAlreadyActive;
        }

        setActivationTimes((prev) => ({
          ...prev,
          [getKeyUID(signer)]: timeString.includes('active')
            ? timeString
            : `Activates in ${timeString}`,
        }));
      });
    } catch (e) {
      showToast(e.toString(), null, IToastCategory.DEFAULT, 3000, true);
    }
  }, [currentBlockHeight, currentMedianTimePast, vault]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={vaultText.resetIKTitle + (inheritanceSigners.length > 1 ? 's' : '')}
        subTitle={vaultText.resetIKDesc + (inheritanceSigners.length > 1 ? 's' : '')}
      />
      <Box style={styles.container}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {signers.map((signer) => (
            <Box
              key={getKeyUID(signer)}
              style={styles.contentContainer}
              backgroundColor={box_background}
              borderColor={box_border}
            >
              <IKSInfocard
                name={signer?.signerName}
                description={getSignerDescription(signer)}
                Icon={SDIcons({ type: signer?.type })?.Icon}
                duration={activationTimes[getKeyUID(signer)]}
              />
              <Box style={styles.dropdownContainer}>
                <Box>
                  <Text color={`${colorMode}.primaryText`} fontSize={15}>
                    {vaultText.chooseNewActivationTimeTitle}
                  </Text>
                  <Text color={`${colorMode}.secondaryText`} fontSize={12}>
                    {vaultText.chooseNewActivationTimeDesc}
                  </Text>
                </Box>
                <OptionPicker
                  label={vaultText.selectActivationTime}
                  options={INHERITANCE_TIMELOCK_DURATIONS}
                  selectedOption={selectedOptions[getKeyUID(signer)]}
                  onOptionSelect={(option) =>
                    setSelectedOptions((prev) => ({
                      ...prev,
                      [getKeyUID(signer)]: option,
                    }))
                  }
                />
              </Box>
            </Box>
          ))}
        </ScrollView>
        <Box>
          <Buttons
            primaryLoading={vaultCreating}
            primaryText={hasEmergencyKeys ? common.continue : vaultText.revaultNow}
            fullWidth
            primaryCallback={async () => {
              let isValid = await handleResetInheritanceKey();
              if (!isValid) return;
              if (hasEmergencyKeys) {
                navigation.dispatch(
                  CommonActions.navigate({
                    name: 'ResetEmergencyKey',
                    params: {
                      inheritanceKeys: inheritanceSigners.map((signer) => ({
                        key: signer,
                        duration: selectedOptions[getKeyUID(signer)]?.label,
                      })),
                      vault,
                    },
                  })
                );
              } else {
                setCreating(true);
              }
            }}
          />
        </Box>
      </Box>
      <VaultMigrationController
        vaultCreating={vaultCreating}
        vaultKeys={otherSigners}
        scheme={vault.scheme}
        name={vault.presentationData.name}
        description={vault.presentationData.description}
        vaultId={vault.id}
        setGeneratedVaultId={setGeneratedVaultId}
        setCreating={setCreating}
        vaultType={vault.type}
        inheritanceKeys={inheritanceSigners.map((signer) => ({
          key: signer,
          duration: selectedOptions[getKeyUID(signer)]?.label,
        }))}
        initialTimelockDuration={initialTimelockDuration ?? 0}
        currentBlockHeight={currentBlockHeight}
        miniscriptTypes={vault.scheme.miniscriptScheme.usedMiniscriptTypes}
      />
    </ScreenWrapper>
  );
}

export default ResetInheritanceKey;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: hp(20),
    paddingHorizontal: wp(10),
    marginBottom: hp(20),
  },
  contentContainer: {
    flex: 1,
    gap: hp(15),
    marginBottom: hp(30),
    padding: hp(16),
    borderWidth: 1,
    borderRadius: 10,
  },
  dropdownContainer: {
    gap: hp(15),
  },
});
