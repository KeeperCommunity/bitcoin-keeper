import { useNavigation } from '@react-navigation/native';
import idx from 'idx';
import { useContext, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { captureError } from 'src/services/sentry';
import { VaultType, XpubTypes } from 'src/services/wallets/enums';
import { generateVaultId } from 'src/services/wallets/factories/VaultFactory';
import { VaultSigner } from 'src/services/wallets/interfaces/vault';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { useAppSelector } from 'src/store/hooks';
import { resetRealyVaultState } from 'src/store/reducers/bhr';
import { addNewVault } from 'src/store/sagaActions/vaults';
import { NewVaultInfo } from 'src/store/sagas/wallets';
import useToastMessage from './useToastMessage';
import { LocalizationContext } from 'src/context/Localization/LocContext';

type Params = {
  setLoader?: Function;
};

const CANARY_SCHEME = { m: 1, n: 1 };

const getSingleSigSignerKey = (signer) => {
  try {
    const singleSigSigner = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WPKH][0]);
    const ssVaultKey: VaultSigner = WalletUtilities.getKeyForScheme(
      false,
      signer,
      null,
      singleSigSigner,
      null
    );

    return ssVaultKey;
  } catch (err) {
    console.log('Something went wrong in getting ss config');
    return null;
  }
};

const getSingleSigSignerId = (ssVaultKey) => {
  const canaryVaultId = generateVaultId([ssVaultKey], CANARY_SCHEME);
  return canaryVaultId;
};

const useCanaryWalletSetup = ({ setLoader }: Params) => {
  const dispatch = useDispatch();
  const navigation: any = useNavigation();
  const { showToast } = useToastMessage();
  const [canaryVaultId, setCanaryVaultId] = useState('');
  const { translations } = useContext(LocalizationContext);
  const { wallet: walletText, error: errorText, common, home } = translations;
  const { relayVaultUpdate, relayVaultError, realyVaultErrorMessage } = useAppSelector(
    (state) => state.bhr
  );

  useEffect(() => {
    if (canaryVaultId) {
      if (relayVaultUpdate) {
        showToast(walletText.canaryWalletSuccess);
        if (setLoader) setLoader(false);
        dispatch(resetRealyVaultState());
        navigation.navigate('VaultDetails', { vaultId: canaryVaultId });
      }
      if (relayVaultError) {
        showToast(`${errorText.canaryWalletFailed} ${realyVaultErrorMessage}`);
        dispatch(resetRealyVaultState());
        if (setLoader) setLoader(false);
      }
    }
  }, [relayVaultUpdate, relayVaultError]);

  const createCreateCanaryWallet = (signer) => {
    try {
      if (setLoader) setLoader(true);
      const ssVaultKey = getSingleSigSignerKey(signer);
      const ssKeyVaultId = getSingleSigSignerId(ssVaultKey);
      if (ssVaultKey) {
        setCanaryVaultId(ssKeyVaultId);
        const vaultInfo: NewVaultInfo = {
          vaultType: VaultType.CANARY,
          vaultScheme: CANARY_SCHEME,
          vaultSigners: [ssVaultKey],
          vaultDetails: {
            name: common.CANARY + ' ' + home.wallet,
            description: `${walletText.canaryWalletFor} ${signer.signerName}`,
          },
        };
        dispatch(addNewVault({ newVaultInfo: vaultInfo }));
        return vaultInfo;
      } else {
        console.log('Something went wrong');
      }
    } catch (err) {
      captureError(err);
      return false;
    }
  };

  return { createCreateCanaryWallet };
};

export default useCanaryWalletSetup;
