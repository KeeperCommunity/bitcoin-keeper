import { SignerType } from 'src/services/wallets/enums';
import { getSignerNameFromType, isSignerAMF } from 'src/hardware';
import { SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { VaultScheme, VaultSigner } from 'src/services/wallets/interfaces/vault';
import useSignerMap from './useSignerMap';
import usePlan from './usePlan';
import { getKeyUID } from 'src/utils/utilities';
import { useContext } from 'react';
import { LocalizationContext } from 'src/context/Localization/LocContext';

const areSignersSame = ({ existingKeys, vaultKeys }) => {
  if (!existingKeys.length || !vaultKeys.length) {
    return false;
  }
  const currentXfps = vaultKeys.map((signer) => (signer ? signer.xfp : ''));
  const activeXfps = existingKeys.map((signer) => signer.xfp);
  return currentXfps.sort().join() === activeXfps.sort().join();
};

const useSignerIntel = ({
  scheme,
  vaultKeys,
  selectedSigners,
  existingKeys,
}: {
  scheme: VaultScheme;
  vaultKeys: VaultSigner[];
  selectedSigners;
  existingKeys: VaultSigner[];
}) => {
  const { signerMap } = useSignerMap();
  const { plan } = usePlan();
  const isOnL1 = plan === SubscriptionTier.L1.toUpperCase();
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;

  const amfSigners = [];
  for (const signerIdentifier of selectedSigners.keys()) {
    const signer = signerMap[signerIdentifier];
    if (isSignerAMF(signer)) amfSigners.push(signer.type);
  }

  let invalidSS = false;
  let invalidMessage = '';

  vaultKeys.forEach((key) => {
    if (key) {
      const isSS = signerMap[getKeyUID(key)].type === SignerType.POLICY_SERVER;
      const signerName = getSignerNameFromType(signerMap[getKeyUID(key)].type);
      if (isSS) {
        if (isOnL1) {
          invalidSS = true;
          invalidMessage = `${signerName} ${signerText.isallowedfrom} ${SubscriptionTier.L2} ${signerText.upgradeOrRemove}`;
        } else if (scheme.m < 2 || scheme.n < 3) {
          invalidSS = true;
          invalidMessage = `${signerText.RequiredSigners} ${signerName}. ${signerText.addMoreSigners}`;
        }
      }
    }
  });
  let areSignersValid = false;

  if (!selectedSigners) {
    areSignersValid = false;
  } else {
    const signerCount = Array.from(selectedSigners.keys()).length;
    // AddSigningDevice selects the primary quorum. Inheritance and Emergency
    // Keys are retained/configured separately and must not disable this step.
    const maxKeys = scheme.n;
    areSignersValid =
      signerCount > 0 &&
      !(
        vaultKeys.every((signer) => !signer) ||
        maxKeys !== vaultKeys.length ||
        areSignersSame({ existingKeys, vaultKeys }) ||
        invalidSS
      );
  }
  return {
    areSignersValid,
    amfSigners,
    invalidSS,
    invalidMessage,
  };
};

export default useSignerIntel;
