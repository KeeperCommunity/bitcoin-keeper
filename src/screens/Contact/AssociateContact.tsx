import { Box, Pressable, useColorMode } from 'native-base';
import React, { useContext, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  TextInput,
  Platform,
  PermissionsAndroid,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Contacts from 'react-native-contacts';
import ScreenWrapper from 'src/components/ScreenWrapper';
import RightArrowIcon from 'src/assets/images/icon_arrow.svg';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import { useNavigation } from '@react-navigation/native';
import KeeperModal from 'src/components/KeeperModal';
import { Signer } from 'src/services/wallets/interfaces/vault';
import { useDispatch, useSelector } from 'react-redux';
import { updateSignerDetails } from 'src/store/sagaActions/wallets';
import { persistDocument } from 'src/services/documents';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import useToastMessage from 'src/hooks/useToastMessage';
import { captureError } from 'src/services/sentry';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import WalletHeader from 'src/components/WalletHeader';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

function AssociateContact({ route }) {
  const {
    signer,
    showAddContact = true,
    popIndex = 1,
    isWalletFlow = false,
  }: {
    signer: Signer;
    showAddContact: boolean;
    popIndex: number;
    isWalletFlow: boolean;
  } = route.params;
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { common, vault: vaultText, error: errorText } = translations;
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const placeholderTextColor = ThemedColor({ name: 'placeholderTextColor' });
  const inputTextColor = ThemedColor({ name: 'inputTextColor' });

  useEffect(() => {
    try {
      if (Platform.OS === 'android') {
        PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS).then((value) => {
          if (value === 'granted') {
            Contacts.getAll().then(setContacts);
          }
        });
      } else {
        Contacts.getAll().then(setContacts);
      }
    } catch (err) {
      console.log('Error loading contacts: ', err);
      captureError(err);
      showToast(errorText.failedToLoadContacts, <ToastErrorIcon />);
    }
  }, []);

  const filteredContacts = contacts.filter((contact) =>
    contact?.givenName?.toLowerCase()?.includes(search?.toLowerCase())
  );

  const handleContactPress = (contact) => {
    setSelectedContact(contact);
    setShowModal(true);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      onPress={() => handleContactPress(item)}
      testID={`contact_item_${item.recordID}`}
    >
      <Box style={styles.contactItem}>
        {item.thumbnailPath !== '' ? (
          <Image source={{ uri: item.thumbnailPath || '' }} style={styles.avatar} />
        ) : (
          <ThemedSvg name={'image_placeholder'} style={styles.avatar} />
        )}
        <Text medium style={styles.contactName}>
          {item.givenName} {item.familyName}
        </Text>
      </Box>
    </TouchableOpacity>
  );

  const renderSeparator = () => (
    <Box
      backgroundColor={`${colorMode}.dullGreyBorder`}
      style={{
        height: 1,
        marginLeft: 55,
      }}
    />
  );

  const onAddAssociateContact = async () => {
    try {
      const persistedImage = await persistDocument(selectedContact.thumbnailPath);
      const extraData = {
        ...signer.extraData,
        givenName: selectedContact.givenName,
        familyName: selectedContact.familyName,
        recordID: selectedContact.recordID,
        thumbnailPath: persistedImage,
      };
      dispatch(updateSignerDetails(signer, 'extraData', extraData));
      setShowModal(false);
      navigation.pop(popIndex);
    } catch (error) {
      console.log('🚀 ~ onAddAssociateContact ~ error:', error);
    }
  };

  const modalSubtitle = isWalletFlow
    ? vaultText.associateContactWalletSub
    : vaultText.associateContactKeySub;

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={vaultText.associateContact} titleColor={`${colorMode}.black`} />
      <Box style={styles.container}>
        <Box style={styles.contentContainer}>
          <Box
            style={styles.searchSection}
            backgroundColor={`${colorMode}.boxSecondaryBackground`}
            borderColor={`${colorMode}.dullGreyBorder`}
          >
            <ThemedSvg name={'search_icon'} width={wp(15)} height={hp(15)} />
            <TextInput
              style={[styles.input, { color: inputTextColor }]}
              placeholderTextColor={placeholderTextColor}
              placeholder={common.search}
              value={search}
              onChangeText={setSearch}
              underlineColorAndroid="transparent"
            />
          </Box>
          {showAddContact && (
            <Pressable onPress={() => navigation.navigate('AddContact', { signer })}>
              <Box
                style={styles.addContactButton}
                backgroundColor={`${colorMode}.boxSecondaryBackground`}
                borderColor={`${colorMode}.dullGreyBorder`}
              >
                <Box style={styles.iconContainer}>
                  <ThemedSvg name={'add_Contact_icon'} width={wp(44)} height={hp(44)} />
                </Box>
                <Text medium style={styles.buttonText}>
                  {vaultText.addContact}
                </Text>
                <RightArrowIcon width={wp(7)} height={hp(12)} style={styles.arrowIcon} />
              </Box>
            </Pressable>
          )}
          <Text medium style={styles.sectionTitle}>
            {vaultText.yourPhoneBook}
          </Text>
        </Box>
        <FlatList
          data={filteredContacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.recordID}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={renderSeparator}
        />
      </Box>
      {selectedContact && (
        <KeeperModal
          visible={showModal}
          close={() => setShowModal(false)}
          showCloseIcon
          DarkCloseIcon={colorMode === 'dark'}
          title={vaultText.associateContact}
          subTitle={modalSubtitle}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.modalWhiteContent`}
          buttonTextColor={`${colorMode}.buttonText`}
          buttonBackground={`${colorMode}.pantoneGreen`}
          buttonText={common.continue}
          buttonCallback={onAddAssociateContact}
          Content={() => (
            <Box
              style={styles.contactInfoCard}
              backgroundColor={`${colorMode}.seashellWhite`}
              borderColor={`${colorMode}.greyBorder`}
            >
              <Box style={styles.iconContainer}>
                {selectedContact.thumbnailPath !== '' ? (
                  <Image
                    source={{ uri: selectedContact.thumbnailPath || 'default-avatar-url' }}
                    style={styles.modalAvatar}
                  />
                ) : (
                  <ThemedSvg name={'image_placeholder'} style={styles.modalAvatar} />
                )}
              </Box>
              <Text medium style={styles.buttonText}>
                {selectedContact.givenName} {selectedContact.familyName}
              </Text>
            </Box>
          )}
        />
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: wp(5),
  },
  sectionTitle: {
    fontSize: 16,
    marginTop: hp(30),
    marginBottom: hp(24),
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: hp(10),
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 25,
    marginRight: 15,
  },
  contactName: {
    flex: 1,
    fontSize: 16,
  },
  addButton: {
    padding: 10,
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    height: 40,
    borderWidth: 1,
    paddingHorizontal: 10,
    marginTop: hp(20),
  },
  input: {
    flex: 1,
    paddingLeft: 10,
    fontSize: 16,
  },
  addContactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: hp(75),
    borderWidth: 1,
    borderRadius: 10,
    paddingTop: hp(16),
    paddingBottom: hp(15),
    paddingHorizontal: wp(17),
    marginTop: hp(15),
  },
  iconContainer: {
    marginRight: 10,
  },
  buttonText: {
    flex: 1,
    fontSize: 16,
  },
  arrowIcon: {
    paddingRight: wp(20),
  },
  modalContent: {
    alignItems: 'center',
    padding: 20,
  },
  modalAvatar: {
    width: 40,
    height: 40,
    borderRadius: 50,
  },
  modalContactName: {
    fontSize: 18,
    marginBottom: 10,
  },
  modalPhoneNumber: {
    fontSize: 16,
  },
  contactInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: hp(85),
    borderWidth: 1,
    borderRadius: 10,
    paddingTop: hp(23),
    paddingBottom: hp(22),
    paddingHorizontal: wp(18),
    marginBottom: hp(10),
  },
  modalContainer: {
    marginTop: hp(20),
  },
  modalTitle: {
    fontSize: 20,
    marginBottom: hp(5),
  },
  modalText: {
    width: wp(300),
    fontSize: 14,
  },
});

export default AssociateContact;
