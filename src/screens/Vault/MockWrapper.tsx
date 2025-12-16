import { CommonActions, NavigationProp, useNavigation } from '@react-navigation/native';
import React from 'react';
import { TapGestureHandler } from 'react-native-gesture-handler';
import { useDispatch } from 'react-redux';
import { SignerType } from 'src/services/wallets/enums';
import { getMockSigner } from 'src/hardware';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import { addSigningDevice } from 'src/store/sagaActions/vaults';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { captureError } from 'src/services/sentry';
import { View } from 'native-base';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import useUnkownSigners from 'src/hooks/useUnkownSigners';
import { InteracationMode } from './HardwareModalMap';
import useCanaryWalletSetup from 'src/hooks/UseCanaryWalletSetup';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { setShowTipModal } from 'src/store/reducers/settings';
import config from 'src/utils/service-utilities/config';

function MockWrapper({
  children,
  signerType,
  enable = true,
  navigation = null,
  addSignerFlow = false,
  mode = InteracationMode.VAULT_ADDITION,
  signerXfp,
}: {
  children: any;
  signerType: SignerType;
  enable?: boolean;
  navigation?: NavigationProp<any>;
  addSignerFlow?: boolean;
  mode: InteracationMode;
  signerXfp?: string;
}) {
  const dispatch = useDispatch();
  const nav = navigation ?? useNavigation();
  const { showToast } = useToastMessage();
  const addMockSigner = () => {
    try {
      const data = getMockSigner(signerType);
      if (data?.signer && data?.key) {
        const { signer } = data;
        dispatch(addSigningDevice([signer]));
        const navigationState = addSignerFlow
          ? {
              name: 'Home',
              params: { selectedOption: 'Keys', addedSigner: signer },
            }
          : {
              name: 'AddSigningDevice',
              merge: true,
              params: { addedSigner: signer },
            };
        nav.dispatch(CommonActions.navigate(navigationState));
      }
    } catch (error) {
      if (error.toString().includes("We don't support")) {
        showToast(error.toString());
        return;
      }
      captureError(error);
    }
  };
  const { mapUnknownSigner } = useUnkownSigners();
  const verifyMockSigner = () => {
    try {
      const data = getMockSigner(signerType);
      const handleSuccess = () => {
        dispatch(
          healthCheckStatusUpdate([
            { signerId: data.signer.masterFingerprint, status: hcStatusType.HEALTH_CHECK_MANAUAL },
          ])
        );
        nav.dispatch(CommonActions.goBack());
        showToast(`${data.signer.type} verified successfully`, <TickIcon />);
        dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
      };

      const handleFailure = () => {
        showToast('Something went wrong, please try again!');
      };

      if (mode === InteracationMode.IDENTIFICATION) {
        const mapped = mapUnknownSigner({
          masterFingerprint: data.signer.masterFingerprint,
          type: data.signer.type,
        });
        if (mapped) {
          handleSuccess();
        } else {
          handleFailure();
        }
      } else {
        if (signerXfp === data.signer.masterFingerprint) {
          handleSuccess();
        } else {
          handleFailure();
        }
      }
    } catch (error) {
      captureError(error);
      console.error('Vrification Failed', error);
    }
  };

  const { createCreateCanaryWallet } = useCanaryWalletSetup({});

  const addCanarySingleSig = () => {
    try {
      const data = getMockSigner(signerType);
      if (data?.signer && data?.key) {
        const { signer } = data;
        dispatch(addSigningDevice([signer]));
        createCreateCanaryWallet(signer);
      }
    } catch (error) {
      console.log('Something Went Wrong');
      captureError(error);
    }
  };

  const handleMockTap = () => {
    if (mode === InteracationMode.VAULT_ADDITION || mode === InteracationMode.APP_ADDITION) {
      addMockSigner();
    } else if (mode === InteracationMode.HEALTH_CHECK) {
      verifyMockSigner();
    } else if (mode === InteracationMode.IDENTIFICATION) {
      verifyMockSigner();
    } else if (mode === InteracationMode.CANARY_ADDITION) {
      addCanarySingleSig();
    } else {
      console.log('unhandled case');
    }
  };
  if (!enable) {
    return children;
  }
  return (
    <TapGestureHandler numberOfTaps={3} onActivated={handleMockTap}>
      <View flex={1}>{children}</View>
    </TapGestureHandler>
  );
}

export default MockWrapper;
