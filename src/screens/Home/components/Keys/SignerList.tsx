import { CommonActions } from '@react-navigation/native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import SignerCard from 'src/screens/AddSigner/SignerCard';
import { getSignerDescription, getSignerNameFromType } from 'src/hardware';
import { useIndicatorHook } from 'src/hooks/useIndicatorHook';
import useSigners from 'src/hooks/useSigners';
import { uaiType } from 'src/models/interfaces/Uai';
import { SDIcons } from 'src/screens/Vault/SigningDeviceIcons';
import { SignerType } from 'src/services/wallets/enums';
import { getKeyUID } from 'src/utils/utilities';
import { windowWidth, wp } from 'src/constants/responsive';
import HardwareModalMap, { InteracationMode } from 'src/screens/Vault/HardwareModalMap';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';

const SignerList = ({ navigation }) => {
  const { signers } = useSigners('', false);
  const { colorMode } = useColorMode();
  const [showSSModal, setShowSSModal] = useState(false);

  const list = signers.filter((signer) => !signer.hidden);
  const { typeBasedIndicator } = useIndicatorHook({
    types: [uaiType.SIGNING_DEVICES_HEALTH_CHECK, uaiType.RECOVERY_PHRASE_HEALTH_CHECK],
  });

  const handleCardSelect = (signer) => {
    navigation.dispatch(
      CommonActions.navigate('SigningDeviceDetails', {
        signerId: getKeyUID(signer),
      })
    );
  };

  const closeSSModal = () => setShowSSModal(false);
  const { primaryMnemonic }: KeeperApp = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0];

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
      <Box style={styles.wrapper}>
        <Box style={styles.addedSignersContainer}>
          {list.map((item) => {
            const signer = item;
            if (!signer || signer.archived) {
              return null;
            }

            const showDot =
              signer.type !== SignerType.MY_KEEPER &&
              typeBasedIndicator?.[uaiType.SIGNING_DEVICES_HEALTH_CHECK]?.[item.id];

            const cardName =
              signer.type === SignerType.ONEKEY && signer.signerName
                ? signer.signerName
                : getSignerNameFromType(signer.type, signer.isMock, false);
            const cardDescription =
              signer.type === SignerType.ONEKEY &&
              signer.extraData?.bleConnectId &&
              signer.signerDescription
                ? signer.signerDescription.replace(
                    /^OneKey(?: (?:Classic(?: 1S(?: Pure)?)?|Touch|Pro(?: 2)?|Neo))? · /,
                    ''
                  )
                : getSignerDescription(signer);

            return (
              <SignerCard
                key={getKeyUID(signer)}
                onCardSelect={() => {
                  handleCardSelect(signer);
                }}
                name={signer.isBIP85 ? `${cardName} +` : cardName}
                subtitle={cardDescription}
                icon={SDIcons({ type: signer.type, light: true }).Icon}
                image={signer?.extraData?.thumbnailPath}
                showSelection={false}
                showDot={showDot}
                colorVarient="green"
                colorMode={colorMode}
              />
            );
          })}
        </Box>
        <HardwareModalMap
          visible={showSSModal}
          close={closeSSModal}
          type={SignerType.POLICY_SERVER}
          mode={InteracationMode.VAULT_ADDITION}
          isMultisig={true}
          primaryMnemonic={primaryMnemonic}
          addSignerFlow={true}
        />
      </Box>
    </ScrollView>
  );
};

export default SignerList;

const styles = StyleSheet.create({
  wrapper: {
    display: 'flex',
    alignContent: 'center',
    justifyContent: 'center',
    width: windowWidth,
  },
  addedSignersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wp(2),
    paddingBottom: 20,
  },
});
