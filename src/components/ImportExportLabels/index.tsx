import React, { useRef, useState } from 'react';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useDispatch } from 'react-redux';
import { importLabels } from 'src/store/sagaActions/utxos';
import { generateAbbreviatedOutputDescriptors } from 'src/utils/service-utilities/utils';
import { importFile, exportFile } from 'src/services/fs';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import ActivityIndicatorView from '../AppActivityIndicator/ActivityIndicatorView';
import { useAppSelector } from 'src/store/hooks';
import Colors from 'src/theme/Colors';

interface ImportExportLabelsProps {
  vault: any;
  labels: any[];
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  translations: any;
}

const ImportExportLabels: React.FC<ImportExportLabelsProps> = ({
  vault,
  labels,
  onSuccess,
  onError,
  translations,
}) => {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const activeAppId = useAppSelector((state) => state.storage.appId);
  const originAppId = useRef(activeAppId).current;
  const { vault: vaultText } = translations;
  const { syncingUTXOs } = useAppSelector((state) => state.utxos);
  const [isSyncingLabels, setIsSyncingLabels] = useState(false);

  const handleImportLabels = async () => {
    try {
      setIsSyncingLabels(true);
      await importFile(
        async (fileContent) => {
          try {
            let labelsData;
            try {
              // In case of JSON
              labelsData = JSON.parse(fileContent);
            } catch (jsonError) {
              // In case of JSONL
              try {
                labelsData = fileContent
                  .split('\n')
                  .filter((line) => line.trim() !== '') // Skip empty lines
                  .map((line) => JSON.parse(line));
              } catch (jsonlError) {
                throw jsonError;
              }
            }

            if (!Array.isArray(labelsData)) {
              if (typeof labelsData === 'object' && labelsData !== null) {
                labelsData = [labelsData];
              } else {
                throw new Error('Invalid labels format: expected an array or object');
              }
            }

            const walletDescriptor = generateAbbreviatedOutputDescriptors(vault);

            const standardizeDescriptor = (descriptor) => {
              if (!descriptor) return '';

              let standardized = descriptor.replace(/'/g, 'h');

              standardized = standardized.replace(
                /\[([0-9a-f]+)(\/.*?)\]/gi,
                (match, fingerprint, path) => {
                  return `[${fingerprint.toUpperCase()}${path}]`;
                }
              );

              return standardized;
            };

            const normalizedWalletDescriptor = standardizeDescriptor(walletDescriptor);
            const walletLabels = labelsData
              .map((label) => {
                return {
                  ...label,
                  origin: label.origin ? label.origin : normalizedWalletDescriptor,
                };
              })
              .filter(
                (label) => standardizeDescriptor(label.origin) === normalizedWalletDescriptor
              );

            if (walletLabels.length === 0) {
              onError('No labels found for this wallet');
              return;
            }

            const standardizedLabels = walletLabels.map((label) => ({
              ...label,
              origin: standardizeDescriptor(label.origin),
            }));

            dispatch(importLabels({ labels: standardizedLabels }, originAppId));

            onSuccess(`Imported ${walletLabels.length} labels successfully`);
          } catch (parseError) {
            console.log('Error parsing labels file:', parseError);
            onError('Failed to import the wallet labels');
          }
        },
        (error) => {
          console.log('Error importing labels:', error);
          onError('Failed to import the wallet labels');
        },
        'utf8'
      );
    } catch (error) {
      console.log('Unexpected error during import:', error);
    } finally {
      setIsSyncingLabels(false);
    }
  };

  const handleExportLabels = async () => {
    try {
      const labelsToExport = Array.from(labels).map((tag) => {
        // Create a copy of the tag object
        const exportTag = {
          type: tag.type.toLowerCase() === 'txn' ? 'tx' : tag.type.toLowerCase(),
          ref: tag.ref,
          label: tag.label,
          origin: tag.origin,
        };

        return exportTag;
      });

      if (!labelsToExport || labelsToExport.length === 0) {
        onError('Wallet does not have any labels');
        return;
      }
      const jsonlString = labelsToExport.map((label) => JSON.stringify(label)).join('\n');

      const fileName = `${vault.presentationData.name.replace(/\s+/g, '_')}_labels.jsonl`;

      await exportFile(jsonlString, fileName, (error) => {
        onError(error.message);
      });

      onSuccess('Wallet labels exported successfully');
    } catch (error) {
      console.log('Error exporting labels:', error);
      onError('Failed to export the wallet labels');
    }
  };

  return (
    <Box>
      <ActivityIndicatorView visible={syncingUTXOs || isSyncingLabels} />
      <Text color={`${colorMode}.modalSubtitleBlack`} style={styles.modalDesc}>
        {vaultText.importExportLabelsModalDesc}
      </Text>
      <Box style={styles.modalButtonsContainer}>
        <TouchableOpacity onPress={handleImportLabels}>
          <Box backgroundColor={`${colorMode}.textInputBackground`} style={styles.modalButton}>
            <Text color={`${colorMode}.textGreen`} style={styles.modalButtonText}>
              {vaultText.importLabels}
            </Text>
          </Box>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleExportLabels}>
          <Box backgroundColor={`${colorMode}.textInputBackground`} style={styles.modalButton}>
            <Text color={`${colorMode}.textGreen`} style={styles.modalButtonText}>
              {vaultText.exportLabels}
            </Text>
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  modalDesc: {
    fontSize: 14,
    padding: 1,
    marginBottom: 15,
    width: wp(295),
  },
  modalButtonsContainer: {
    marginTop: 20,
    flexDirection: 'column',
    width: '100%',
  },
  modalButton: {
    alignItems: 'center',
    gap: wp(20),
    paddingHorizontal: wp(20),
    paddingVertical: hp(16),
    borderRadius: 10,
    marginBottom: hp(10),
    borderWidth: 1,
    borderColor: Colors.separator,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

export default ImportExportLabels;
