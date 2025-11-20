import * as bip39 from 'bip39';
import { Box, Input, Pressable, ScrollView, View, useColorMode } from 'native-base';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { hp, wp } from 'src/constants/responsive';
import Text from 'src/components/KeeperText';
import Buttons from 'src/components/Buttons';
import InvalidSeeds from 'src/assets/images/invalid-seed-illustration.svg';
import KeeperModal from 'src/components/KeeperModal';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { getAppImage, healthCheckSigner, healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import { useAppSelector } from 'src/store/hooks';
import { useDispatch } from 'react-redux';
import { CommonActions } from '@react-navigation/native';
import useToastMessage from 'src/hooks/useToastMessage';
import { getPlaceholder, getPlaceholderSuperScripted } from 'src/utils/utilities';
import { SignerStorage, SignerType, XpubTypes } from 'src/services/wallets/enums';
import { generateSignerFromMetaData } from 'src/hardware';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { InteracationMode } from '../Vault/HardwareModalMap';
import { getCosignerDetails } from 'src/services/wallets/factories/WalletFactory';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Breadcrumbs from 'src/components/Breadcrumbs';
import Dropdown from 'src/components/Dropdown';
import { SIGNTRANSACTION } from 'src/navigation/contants';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { ConciergeTag } from 'src/store/sagaActions/concierge';
import RecoverySuccessModalContent from './RecoverySuccessModalContent';
import { resetSeedWords, setAppImageError, setSeedWord } from 'src/store/reducers/bhr';
import Fonts from 'src/constants/Fonts';
import { SEED_WORDS_12, SEED_WORDS_18, SEED_WORDS_24, seedWordItem } from './constants';
import Colors from 'src/theme/Colors';
import WalletHeader from 'src/components/WalletHeader';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { updateSignerDetails, updateVaultSignersXpriv } from 'src/store/sagaActions/wallets';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';

function EnterSeedScreen({ route, navigation }) {
  const { translations } = useContext(LocalizationContext);
  const {
    seed,
    common,
    healthcheck,
    cloudBackup,
    signer: signerText,
    usdtWalletText,
  } = translations;

  const {
    mode,
    signer,
    isMultisig,
    setupSeedWordsBasedSigner,
    mapUnknownSigner,
    isImport,
    importSeedCta,
    isUSDTWallet,
    parentScreen,
    xfp,
    onSuccess,
    step = 1,
    selectedNumberOfWordsFromParams,
  } = route.params || {};

  console.log(`EnterSeedScreen START mode: ${mode}`);

  const { appImageError } = useAppSelector((state) => state.bhr);

  const { appCreated } = useAppSelector((state) => state.storage);
  const { colorMode } = useColorMode();
  const { showToast } = useToastMessage();
  const dispatch = useDispatch();
  const seedWords = useAppSelector((state) => state.bhr.seedWords);

  const [seedData, setSeedData] = useState<seedWordItem[]>();
  const [invalidSeedsModal, setInvalidSeedsModal] = useState(false);
  const [recoverySuccessModal, setRecoverySuccessModal] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [hcLoading, setHcLoading] = useState(false);
  const [suggestedWords, setSuggestedWords] = useState([]);
  const [onChangeIndex, setOnChangeIndex] = useState(-1);
  const [inputPositions, setInputPositions] = useState({});
  const [selectedNumberOfWords, setSelectedNumberOfWords] = useState(
    selectedNumberOfWordsFromParams || SEED_WORDS_12
  );
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [rememberModal, setRememberModal] = useState(false);
  const options = [SEED_WORDS_12, SEED_WORDS_18, SEED_WORDS_24];
  const numberOfWordsToScreensMap = {
    [SEED_WORDS_12]: 1,
    [SEED_WORDS_18]: 2,
    [SEED_WORDS_24]: 2,
  };

  const inputRef = useRef([]);
  const [showInfo, setShowInfo] = useState(false);

  const isHealthCheck = mode === InteracationMode.HEALTH_CHECK;
  const isSignTransaction = parentScreen === SIGNTRANSACTION;
  const isIdentification = mode === InteracationMode.IDENTIFICATION;

  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });
  const openInvalidSeedsModal = () => {
    setRecoveryLoading(false);
    setInvalidSeedsModal(true);
  };
  const closeInvalidSeedsModal = () => {
    dispatch(setAppImageError(''));
    setInvalidSeedsModal(false);
  };

  useEffect(() => {
    if (appCreated && recoveryLoading) {
      setRecoveryLoading(false);
      setRecoverySuccessModal(true);
      dispatch(resetSeedWords());
    }
  }, [appCreated]);

  useEffect(() => {
    if (appImageError) {
      if (appImageError === 'Network Error') {
        dispatch(setAppImageError(''));
        setRecoveryLoading(false);
        setShowNetworkModal(true);
      } else openInvalidSeedsModal();
    }
  }, [appImageError]);

  const generateSeedWordsArray = useCallback(() => {
    const seedArray = [];
    for (let i = 1; i <= 24; i++) {
      seedArray.push({
        id: i,
        name: '',
        invalid: true,
      });
    }
    return seedArray;
  }, []);

  useEffect(() => {
    if (seedWords && seedWords.length > 0) {
      const seedWordsMap = seedWords.reduce((acc, word) => {
        acc[word.id] = word;
        return acc;
      }, {});

      const updatedSeedData = generateSeedWordsArray().map((seedWord, index) => {
        const globalSeedWord = seedWordsMap[index + 1];
        return globalSeedWord
          ? {
              ...seedWord,
              name: globalSeedWord.name,
              invalid: !bip39.wordlists.english.includes(globalSeedWord.name),
            }
          : seedWord;
      });

      setSeedData(updatedSeedData);
    } else {
      setSeedData(generateSeedWordsArray());
    }
  }, [seedWords]);

  const isSeedFilled = (index: number) => {
    for (let i = 0; i < index; i++) {
      if (seedData[i].invalid) {
        return false;
      }
    }
    return true;
  };

  const performHealthCheck = async (remember = false) => {
    const mnemonic = seedWords.map((word) => word.name).join(' ');
    const derivedSigner = await generateDerivedSigner(mnemonic, signer, isMultisig, remember);
    const isHealthy = await healthCheckSigner(derivedSigner);

    if (isHealthy) {
      if (remember) {
        const updatedXpub = {
          ...signer.signerXpubs,
          [XpubTypes.P2WSH]: derivedSigner.signerXpubs[XpubTypes.P2WSH],
          [XpubTypes.P2TR]: derivedSigner.signerXpubs[XpubTypes.P2TR],
          [XpubTypes.P2WPKH]: derivedSigner.signerXpubs[XpubTypes.P2WPKH],
        };
        dispatch(updateSignerDetails(signer, 'signerXpubs', updatedXpub));
        dispatch(updateVaultSignersXpriv([signer]));
      }

      updateHealthCheckStatus(
        derivedSigner.masterFingerprint,
        hcStatusType.HEALTH_CHECK_SUCCESSFULL
      );
      dispatch(resetSeedWords());
      navigateBack(step);
      showToast(healthcheck.HealthCheckSuccessful, <TickIcon />);
    } else {
      updateHealthCheckStatus(derivedSigner.masterFingerprint, hcStatusType.HEALTH_CHECK_FAILED);
      showToast(cloudBackup.CLOUD_BACKUP_HEALTH_FAILED);
    }
  };

  const handleNext = async () => {
    const mnemonic = seedWords.map((word) => word.name).join(' ');

    if (onChangeIndex !== -1 && inputRef.current[onChangeIndex]) {
      inputRef.current[onChangeIndex].blur();
    }
    const areInputsFilled = () => {
      const requiredWordsCount = getRequiredWordsCount();
      return seedData.slice(0, requiredWordsCount).every((word) => word.name !== '');
    };

    if (!areInputsFilled()) {
      showToast(seed.SeedErrorToast, <ToastErrorIcon />);
      return;
    }

    const handleHealthCheck = async () => {
      setHcLoading(true);
      try {
        if (step === 1 && [SEED_WORDS_18, SEED_WORDS_24].includes(selectedNumberOfWords)) {
          navigation.push('EnterSeedScreen', {
            step: 2,
            selectedNumberOfWordsFromParams: selectedNumberOfWords,
            mode,
            setupSeedWordsBasedSigner,
            signer,
          });
        } else {
          const sXpriv = signer.signerXpubs[XpubTypes.P2WSH][0].xpriv;
          if (!sXpriv) return setRememberModal(true);
          await performHealthCheck();
        }
      } catch (err) {
        handleHealthCheckError(err);
      } finally {
        setHcLoading(false);
      }
    };

    const handleIdentification = async () => {
      try {
        const derivedSigner = await generateDerivedSigner(mnemonic, signer, isMultisig);
        const mapped = mapUnknownSigner({
          masterFingerprint: derivedSigner.masterFingerprint,
          type: SignerType.SEED_WORDS,
        });

        if (mapped) {
          updateHealthCheckStatus(
            derivedSigner.masterFingerprint,
            hcStatusType.HEALTH_CHECK_SUCCESSFULL
          );
          showToast(cloudBackup.identificanSuccessful, <TickIcon />);
          dispatch(resetSeedWords());
          navigateBack(step);
        } else {
          showToast(cloudBackup.identificanFailed);
        }
      } catch (err) {
        handleIdentificationError(err);
      }
    };

    const handleImport = () => {
      if (step === 1 && [SEED_WORDS_18, SEED_WORDS_24].includes(selectedNumberOfWords)) {
        navigation.push('EnterSeedScreen', {
          step: 2,
          selectedNumberOfWordsFromParams: selectedNumberOfWords,
          mode,
          isImport: true,
          importSeedCta,
          isUSDTWallet,
        });
      } else if (bip39.validateMnemonic(mnemonic)) {
        if (isUSDTWallet) {
          importSeedCta(mnemonic);
        } else if (mode === InteracationMode.VAULT_IMPORT_SEED) {
          // directly call import and skip remember step
          console.log(`EnterSeedScreen handleImport importSeed to HW`);
          importSeed(true);
        } else setRememberModal(true);
      } else {
        openInvalidSeedsModal();
      }
    };

    const handleSignTransaction = () => {
      if (step === 1 && [SEED_WORDS_18, SEED_WORDS_24].includes(selectedNumberOfWords)) {
        navigation.push('EnterSeedScreen', {
          step: 2,
          selectedNumberOfWordsFromParams: selectedNumberOfWords,
          onSuccess,
          mode,
          xfp,
          parentScreen,
        });
      } else if (bip39.validateMnemonic(mnemonic)) {
        onSuccess({ xfp, seedBasedSingerMnemonic: mnemonic });
        dispatch(resetSeedWords());
        navigateBack(step);
      } else {
        openInvalidSeedsModal();
      }
    };

    const handleGetAppImage = async () => {
      setRecoveryLoading(true);
      try {
        const seedWord = seedWords.map((word) => word.name).join(' ');
        dispatch(getAppImage(seedWord));
      } catch (err) {
        console.error('getAppImage error:', err);
        showToast(seed.SeedErrorToast, <ToastErrorIcon />);
      }
    };

    if (isHealthCheck) {
      await handleHealthCheck();
    } else if (mode === InteracationMode.IDENTIFICATION) {
      await handleIdentification();
    } else if (isImport) {
      handleImport();
    } else if (isSignTransaction) {
      handleSignTransaction();
    } else {
      await handleGetAppImage();
    }
  };

  const generateDerivedSigner = async (mnemonic, signer, isMultisig, remember = false) => {
    if (signer?.type === SignerType.MY_KEEPER) {
      const details = await getCosignerDetails(mnemonic, signer.extraData?.instanceNumber - 1);
      return generateSignerFromMetaData({
        xpub: details.xpubDetails[XpubTypes.P2WSH].xpub,
        xpriv: details.xpubDetails[XpubTypes.P2WSH].xpriv,
        derivationPath: details.xpubDetails[XpubTypes.P2WSH].derivationPath,
        masterFingerprint: details.mfp,
        signerType: SignerType.MY_KEEPER,
        storageType: SignerStorage.WARM,
        isMultisig: true,
      }).signer;
    } else {
      const { signer: newSigner } = setupSeedWordsBasedSigner(mnemonic, isMultisig, remember);
      return newSigner;
    }
  };

  const updateHealthCheckStatus = (signerMasterFingerprint, status) => {
    dispatch(healthCheckStatusUpdate([{ signerId: signerMasterFingerprint, status }]));
  };

  const navigateBack = (step) => {
    step > 1
      ? navigation.dispatch((state) => {
          const routes = state.routes.slice(0, -step);
          return CommonActions.reset({
            ...state,
            routes,
            index: routes.length - 1,
          });
        })
      : navigation.goBack();
  };

  const handleHealthCheckError = (err) => {
    openInvalidSeedsModal();
    console.error('Health check error:', err);
  };

  const handleIdentificationError = (err) => {
    openInvalidSeedsModal();
    console.error('Identification error:', err);
  };

  function InValidSeedsScreen() {
    const { translations } = useContext(LocalizationContext);
    const { seed } = translations;
    return (
      <View>
        <Box style={styles.invalidSeedsIllustration}>
          <InvalidSeeds />
        </Box>
        <Text color={`${colorMode}.secondaryText`} fontSize={13}>
          {seed.InvalidSeedsDesc}
        </Text>
      </View>
    );
  }

  const getSuggestedWords = (text) => {
    const filteredData = bip39.wordlists.english.filter((data) =>
      data.toLowerCase().startsWith(text)
    );
    setSuggestedWords(filteredData);
  };

  const selectNumberOfWords = (option: string) => {
    setSelectedNumberOfWords(option);
  };

  const handleLayout = (index: number) => {
    inputRef.current[index]?.measureInWindow((y: number) => {
      setInputPositions((prev) => ({
        ...prev,
        [index]: { y },
      }));
    });
  };

  const handleInputChange = (text, index) => {
    const data = [...seedData];
    data[index].name = text.trim();
    data[index].invalid = false;
    setSeedData(data);

    dispatch(setSeedWord({ index, wordItem: data[index] }));

    if (text.length > 1) {
      setOnChangeIndex(index);
      getSuggestedWords(text.toLowerCase());
    } else {
      setSuggestedWords([]);
    }
  };

  const handleInputFocus = (index) => {
    const data = [...seedData];
    data[index].invalid = false;
    setSeedData(data);
    setSuggestedWords([]);
    setOnChangeIndex(index);
  };

  const handleInputBlur = (index) => {
    const data = [...seedData];
    if (!bip39.wordlists.english.includes(data[index].name)) {
      data[index].invalid = true;
    }
    setSeedData(data);
    dispatch(setSeedWord({ index, wordItem: seedData[index] }));
  };

  const getRequiredWordsCount = () => {
    const wordsMap = {
      [SEED_WORDS_12]: 12,
      [SEED_WORDS_18]: step === 1 ? 12 : 18,
      [SEED_WORDS_24]: step === 1 ? 12 : 24,
    };
    return wordsMap[selectedNumberOfWordsFromParams || selectedNumberOfWords] || 0;
  };

  const requiredWordsCount = getRequiredWordsCount();

  const getPosition = (index: number) => {
    if ([0, 1, 12, 13, 18, 19, 20, 21].includes(index)) {
      return 1;
    } else if ([2, 3, 6, 7, 8, 9, 10, 11, 14, 15, 22, 23].includes(index)) {
      return 2;
    } else if ([4, 5, 16, 17].includes(index)) {
      return 3;
    } else {
      return 1;
    }
  };

  const seedItem = (item: seedWordItem, index: number) => {
    if (
      (step === 1 && index < 12) ||
      (step === 2 &&
        (selectedNumberOfWords === SEED_WORDS_18 ||
          selectedNumberOfWordsFromParams === SEED_WORDS_18) &&
        index >= 12 &&
        index < 18) ||
      (step === 2 &&
        (selectedNumberOfWords === SEED_WORDS_24 ||
          selectedNumberOfWordsFromParams === SEED_WORDS_24) &&
        index >= 12 &&
        index < 24)
    ) {
      return (
        <Box style={styles.inputListWrapper}>
          <Input
            fontWeight={500}
            fontFamily={item.name === '' ? 'Arial' : Fonts.LoraSemiBold}
            backgroundColor={`${colorMode}.primaryBackground`}
            borderColor={
              item.invalid && item.name != '' ? '#F58E6F' : `${colorMode}.primaryBackground`
            }
            _focus={{ borderColor: `${colorMode}.primaryBackground` }}
            ref={(el) => (inputRef.current[index] = el)}
            style={styles.input}
            placeholder={`Enter ${getPlaceholderSuperScripted(index)} word`}
            placeholderTextColor={`${colorMode}.SlateGreen`}
            value={item?.name}
            textContentType="none"
            returnKeyType={isSeedFilled(12) ? 'done' : 'next'}
            autoCorrect={false}
            autoCapitalize="none"
            blurOnSubmit={false}
            keyboardType={Platform.OS === 'android' ? 'visible-password' : 'name-phone-pad'}
            onLayout={() => handleLayout(index)}
            onChangeText={(text) => handleInputChange(text, index)}
            onBlur={() => handleInputBlur(index)}
            onFocus={() => {
              handleInputFocus(index);
            }}
            onSubmitEditing={() => {
              dispatch(setSeedWord({ index, wordItem: seedData[index] }));
              setSuggestedWords([]);
              Keyboard.dismiss();
            }}
            testID={`input_seedWord${getPlaceholder(index)}`}
            _input={
              colorMode === 'dark' && {
                selectionColor: Colors.bodyText,
                cursorColor: Colors.bodyText,
              }
            }
          />
        </Box>
      );
    } else {
      return null;
    }
  };

  const renderSuggestions = () => {
    if (suggestedWords.length === 0 || onChangeIndex === -1) return null;

    const position = inputPositions[onChangeIndex];
    if (!position) return null;
    return (
      <ScrollView
        style={[
          styles.suggestionScrollView,
          {
            marginTop: getPosition(onChangeIndex) * hp(60),
            height: onChangeIndex === 4 || onChangeIndex === 5 ? hp(90) : null,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        testID="view_suggestionView"
      >
        <Box style={styles.suggestionWrapper}>
          {suggestedWords.map((word, wordIndex) => (
            <Pressable
              testID={`btn_suggested_${word}`}
              key={word ? `${word + wordIndex}` : wordIndex}
              style={styles.suggestionTouchView}
              onPress={() => {
                const updatedSeedData = [...seedData];
                updatedSeedData[onChangeIndex].name = word.trim();
                setSeedData(updatedSeedData);
                setSuggestedWords([]);
                if (onChangeIndex < (step === 1 ? 11 : requiredWordsCount - 1)) {
                  inputRef.current[onChangeIndex + 1]?.focus();
                } else Keyboard.dismiss();
              }}
            >
              <Text>{word}</Text>
            </Pressable>
          ))}
        </Box>
      </ScrollView>
    );
  };
  const isRecovery = !isHealthCheck && !isImport && !isSignTransaction && !isIdentification;

  const rememberModalContent = () => {
    return (
      <>
        <Box style={styles.illustrationCTR}>
          <ThemedSvg name={'RememberSeedKey'} />
        </Box>
        <Text color={green_modal_text_color}>{signerText.seedKeyRememberDesc}</Text>
      </>
    );
  };

  const importSeed = async (remember) => {
    const mnemonic = seedWords.map((word) => word.name).join(' ');
    if (isHealthCheck) {
      await performHealthCheck(remember);
    } else {
      importSeedCta(mnemonic, remember);
      dispatch(resetSeedWords());
    }
  };

  function UsdtWalletImportContent() {
    return (
      <View marginY={5}>
        <Text style={styles.desc} color={green_modal_text_color}>
          {usdtWalletText.importInfoDesc1}
        </Text>
        <Text style={styles.desc} color={green_modal_text_color}>
          {usdtWalletText.importInfoDesc2}
        </Text>
        <Text style={styles.descLast} color={green_modal_text_color}>
          {usdtWalletText.importInfoDescNote}
        </Text>
      </View>
    );
  }

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : null}
        enabled
        keyboardVerticalOffset={Platform.select({ ios: 8, android: 500 })}
        style={styles.container}
      >
        <WalletHeader
          title={
            isHealthCheck || isIdentification
              ? healthcheck.seedHealthCheck
              : isImport
              ? healthcheck.enterSeedWord
              : isSignTransaction
              ? seed?.EnterSeed
              : seed?.enterRecoveryPhrase
          }
          subTitle={
            isHealthCheck || isIdentification
              ? healthcheck.enterSeedKey
              : isImport
              ? healthcheck.toimportEnterSeedKey
              : isSignTransaction
              ? healthcheck.toSignTransaction
              : seed.enterRecoveryPhraseSubTitle
          }
          onPressHandler={() => {
            navigation.goBack();
            if (step === 1) {
              dispatch(resetSeedWords());
            }
          }}
          learnMore={isUSDTWallet}
          learnMorePressed={() => setShowInfo(true)}
        />

        <Box
          style={{
            marginVertical: 20,
            flex: 1,
            gap: hp(20),
          }}
        >
          {(isImport || isSignTransaction || isHealthCheck || isIdentification) && step === 1 && (
            <Box style={styles.dropdownContainer}>
              <Dropdown
                label={selectedNumberOfWords}
                options={options}
                onOptionSelect={selectNumberOfWords}
              />
            </Box>
          )}
          <ScrollView
            contentContainerStyle={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 10,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {seedData?.map((item, index) => seedItem(item, index))}
          </ScrollView>
          {renderSuggestions()}
        </Box>
        <Box style={styles.bottomContainerView}>
          {!isRecovery && (
            <Breadcrumbs
              totalScreens={numberOfWordsToScreensMap[selectedNumberOfWords] || 0}
              currentScreen={step}
            />
          )}

          <Buttons
            primaryCallback={handleNext}
            primaryText={common.next}
            secondaryText={isRecovery || isUSDTWallet ? null : common.needHelp}
            fullWidth={isRecovery}
            secondaryCallback={() => {
              navigation.dispatch(
                CommonActions.navigate({
                  name: 'CreateTicket',
                  params: {
                    tags: [ConciergeTag.VAULT],
                    screenName: 'sign-transaction-seed-key',
                  },
                })
              );
            }}
            primaryLoading={recoveryLoading}
          />
        </Box>

        <KeeperModal
          visible={invalidSeedsModal}
          close={closeInvalidSeedsModal}
          showCloseIcon={false}
          title={seed.InvalidSeeds}
          subTitle={seed.InvalidSeedsSubtitle}
          buttonText={common.retry}
          buttonTextColor={`${colorMode}.buttonText`}
          buttonCallback={closeInvalidSeedsModal}
          textColor={`${colorMode}.textGreen`}
          Content={InValidSeedsScreen}
        />
        <KeeperModal
          visible={recoverySuccessModal}
          title={seed.appRecoveredSuccessfulTitle}
          subTitle={seed.appRecoveredSuccessfulSubTitle}
          buttonText={common.continue}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          buttonTextColor={`${colorMode}.buttonText`}
          buttonBackground={`${colorMode}.pantoneGreen`}
          Content={RecoverySuccessModalContent}
          close={() => {
            setRecoverySuccessModal(false);
            navigation.replace('App', { screen: 'Home' });
          }}
          showCloseIcon={false}
          buttonCallback={() => {
            setRecoverySuccessModal(false);
            navigation.replace('App', { screen: 'Home' });
          }}
        />
        <KeeperModal
          dismissible={false}
          close={() => setShowNetworkModal(false)}
          visible={showNetworkModal}
          title="Something went wrong"
          subTitle="Please check your internet connection and try again."
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          subTitleWidth={wp(230)}
          showCloseIcon={false}
          buttonText={'Try again'}
          buttonCallback={() => setShowNetworkModal(false)}
        />
        <KeeperModal
          close={() => {}}
          showCloseIcon={false}
          dismissible={false}
          visible={rememberModal}
          title={signerText.seedKeyRememberTitle}
          subTitle={signerText.seedKeyRememberSubTitle}
          modalBackground={green_modal_background}
          textColor={green_modal_text_color}
          Content={rememberModalContent}
          subTitleWidth={wp(280)}
          buttonText={common.save}
          secondaryButtonText={common.skip}
          buttonTextColor={green_modal_button_text}
          buttonBackground={green_modal_button_background}
          secButtonTextColor={green_modal_sec_button_text}
          buttonCallback={() => importSeed(true)}
          secondaryCallback={() => importSeed(false)}
        />
        <KeeperModal
          visible={showInfo}
          close={() => setShowInfo(false)}
          title={usdtWalletText.importInfoTitle}
          modalBackground={green_modal_background}
          textColor={green_modal_text_color}
          Content={UsdtWalletImportContent}
          DarkCloseIcon
          buttonText={common.Okay}
          secondaryButtonText={common.needHelp}
          buttonTextColor={green_modal_button_text}
          buttonBackground={green_modal_button_background}
          secButtonTextColor={green_modal_sec_button_text}
          secondaryIcon={<ConciergeNeedHelp />}
          secondaryCallback={() => {
            setShowInfo(false);
            navigation.dispatch(
              CommonActions.navigate({
                name: 'CreateTicket',
                params: {
                  tags: [ConciergeTag.WALLET],
                  screenName: 'import-usdt-wallet-seed-key',
                },
              })
            );
          }}
          buttonCallback={() => setShowInfo(false)}
        />
      </KeyboardAvoidingView>
      <ActivityIndicatorView showLoader={true} visible={hcLoading || recoveryLoading} />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  input: {
    borderRadius: 10,
    fontSize: 13,
    letterSpacing: 0.39,
    height: hp(50),
    width: wp(150),
    zIndex: 1,
  },
  inputListWrapper: {
    width: '48%',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: Colors.separator,
    borderRadius: 10,
  },
  bottomContainerView: {
    marginHorizontal: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionScrollView: {
    zIndex: 99999,
    position: 'absolute',
    maxHeight: hp(100),
    width: '100%',
    alignSelf: 'center',
  },
  suggestionWrapper: {
    backgroundColor: 'white',
    flexDirection: 'row',
    padding: 10,
    borderRadius: 10,
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  suggestionTouchView: {
    backgroundColor: '#f2c693',
    padding: 5,
    borderRadius: 5,
    margin: 5,
  },
  dropdownContainer: {
    zIndex: 9999,
    borderWidth: 1,
    borderColor: Colors.separator,
    borderRadius: 10,
  },
  invalidSeedsIllustration: {
    alignSelf: 'center',
    marginBottom: hp(30),
  },
  illustrationCTR: {
    alignItems: 'center',
    marginBottom: hp(30),
  },
  desc: {
    fontSize: 14,
    letterSpacing: 0.65,
    padding: 5,
    marginBottom: hp(5),
  },
  descLast: {
    fontSize: 14,
    letterSpacing: 0.65,
    padding: 5,
    paddingBottom: 0,
    marginTop: hp(40),
  },
});

export default EnterSeedScreen;
