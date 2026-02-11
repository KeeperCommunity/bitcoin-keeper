import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import React, { useContext, useRef } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Sentry from '@sentry/react-native';
import AddSendAmount from 'src/screens/Send/AddSendAmount';
import AddSigningDevice from 'src/screens/Vault/AddSigningDevice';
import AppVersionHistory from 'src/screens/AppSettings/AppVersionHistoty';
import ArchivedVault from 'src/screens/Vault/ArchivedVault';
import ChangeLanguage from 'src/screens/AppSettings/ChangeLanguage';
import ChoosePlan from 'src/screens/ChoosePlanScreen/ChoosePlan';
import ChoosePolicyNew from 'src/screens/Vault/ChoosePolicyNew';
import CreatePin from 'src/screens/LoginScreen/CreatePin';
import EnterSeedScreen from 'src/screens/Recovery/EnterSeedScreen';
import ExportSeedScreen from 'src/screens/SeedScreens/ExportSeedScreen';
import SeedDetailsScreen from 'src/screens/SeedScreens/SeedDetailsScreen';
import KeeperLoader from 'src/components/KeeperLoader';
import NewKeeperApp from 'src/screens/NewKeeperAppScreen/NewKeeperAppScreen';
import OnBoardingSlides from 'src/screens/Splash/OnBoardingSlides';
import { RealmProvider } from 'src/storage/realm/RealmProvider';
import ReceiveScreen from 'src/screens/Recieve/ReceiveScreen';
import RegisterWithQR from 'src/screens/QRScreens/RegisterWithQR';
import ScanQR from 'src/screens/QRScreens/ScanQR';
import ShowPSBT from 'src/screens/QRScreens/ShowPSBT';
import SendConfirmation from 'src/screens/Send/SendConfirmation';
import SendScreen from 'src/screens/Send/SendScreen';
import SetupColdCard from 'src/screens/SigningDevices/SetupColdCard';
import PreviewPDF from 'src/screens/InheritanceToolsAndTips/PreviewPDF';
import SignTransactionScreen from 'src/screens/SignTransaction/SignTransactionScreen';
import SignWithColdCard from 'src/screens/SignTransaction/SignWithColdCard';
import SignWithQR from 'src/screens/SignTransaction/SignWithQR';
import SignerAdvanceSettings from 'src/screens/Vault/SignerAdvanceSettings';
import SigningDeviceDetails from 'src/screens/Vault/SigningDeviceDetails';
import SignerCategoryList from 'src/screens/Vault/SignerCategoryList';
import SigningDeviceList from 'src/screens/Vault/SigningDeviceList';
import SplashScreen from 'src/screens/Splash/SplashScreen';
import TorSettings from 'src/screens/AppSettings/TorSettings';
import ManageWallets from 'src/screens/AppSettings/ManageWallets';
import TransactionDetails from 'src/screens/ViewTransactions/TransactionDetails';
import TransactionAdvancedDetails from 'src/screens/ViewTransactions/TransactionAdvancedDetails';
import TransactionHistory from 'src/screens/ViewTransactions/TransactionHistory';
import VaultDetails from 'src/screens/Vault/VaultDetails';
import VaultSettings from 'src/screens/Vault/VaultSettings';
import AllTransactions from 'src/screens/Vault/AllTransactions';
import WalletBackHistoryScreen from 'src/screens/BackupWallet/WalletBackHistoryScreen';
import WalletDetails from 'src/screens/WalletDetails/WalletDetails';
import WalletSettings from 'src/screens/WalletDetails/WalletSettings';
import Colors from 'src/theme/Colors';
import NodeSettings from 'src/screens/AppSettings/Node/NodeSettings';
import ConnectChannel from 'src/screens/Channel/ConnectChannel';
import RegisterWithChannel from 'src/screens/QRScreens/RegisterWithChannel';
import SignWithChannel from 'src/screens/QRScreens/SignWithChannel';
import UTXOLabeling from 'src/screens/UTXOManagement/UTXOLabeling';
import UTXOManagement from 'src/screens/UTXOManagement/UTXOManagement';
import ImportWalletDetailsScreen from 'src/screens/ImportWalletDetailsScreen/ImportWalletDetailsScreen';
import AddDetailsFinalScreen from 'src/screens/ImportWalletDetailsScreen/AddDetailsFinalScreen';
import UpdateWalletDetails from 'src/screens/WalletDetails/UpdateWalletDetails';
import AssignSignerType from 'src/screens/Vault/AssignSignerType';
import CosignerDetails from 'src/screens/WalletDetails/CosignerDetails';
import WalletDetailsSettings from 'src/screens/WalletDetails/WalletDetailsSettings';
import GenerateVaultDescriptor from 'src/screens/Vault/GenerateVaultDescriptor';
import { AppContext } from 'src/context/AppContext';
import SetupTapsigner from 'src/screens/SigningDevices/SetupTapsigner';
import SetupSatochip from 'src/screens/SigningDevices/SetupSatochip';
import SetupSeedWordSigner from 'src/screens/SigningDevices/SetupSeedWordSigner';
import SetupOtherSDScreen from 'src/screens/SigningDevices/SetupOtherSDScreen';
import SetupCollaborativeWallet from 'src/screens/SigningDevices/SetupCollaborativeWallet';
import SetupSigningServer from 'src/screens/SigningDevices/SetupSigningServer';
import UnlockTapsigner from 'src/screens/SigningDevices/UnlockTapsigner';
import ChangeTapsignerPin from 'src/screens/SigningDevices/ChangeTapsignerPin';
import SatochipSetupPin from 'src/screens/SigningDevices/SatochipSetupPin';
import ChangeSatochipPin from 'src/screens/SigningDevices/ChangeSatochipPin';
import SatochipVerifyAuthenticity from 'src/screens/SigningDevices/SatochipVerifyAuthenticity';
import ResetSatochipSeed from 'src/screens/SigningDevices/ResetSatochipSeed';
import ImportSatochipSeed from 'src/screens/SigningDevices/ImportSatochipSeed';
import SatochipSeedImportModal from 'src/screens/SigningDevices/SatochipSeedImportModal';
import PrivacyAndDisplay from 'src/screens/AppSettings/PrivacyAndDisplay';
import VaultConfigurationCreation from 'src/screens/Vault/VaultConfigurationRecreation';
import AddNewWallet from 'src/screens/AddWalletScreen/AddNewWallet';
import ConfirmWalletDetails from 'src/screens/AddWalletScreen/ConfirmWalletDetails';
import HomeScreen from 'src/screens/Home/HomeScreen';
import ManageSigners from 'src/screens/SigningDevices/ManageSigners';
import AppBackupSettings from 'src/screens/AppSettings/AppBackupSettings';
import DiscountCodes from 'src/screens/DiscountCodes/DiscountCodes';
import BuyBitcoinScreen from 'src/screens/BuyBitcoin/BuyBitcoinScreen';
import CloudBackupScreen from 'src/screens/CloudBackup/CloudBackupScreen';
import DeleteKeys from 'src/screens/SigningDevices/DeleteKeys';

import CanaryWallets from 'src/screens/InheritanceToolsAndTips/components/Canary';
import AssistedKeys from 'src/screens/InheritanceToolsAndTips/components/AssistedKeys';
import SafeKeepingTips from 'src/screens/InheritanceToolsAndTips/components/SafeKeepingTips';
import SafeGuardingTips from 'src/screens/InheritanceToolsAndTips/components/SafeGuardingTips';
import MasterRecoveryKey from 'src/screens/InheritanceToolsAndTips/components/MasterRecoveryKey';
import PersonalCloudBackup from 'src/screens/InheritanceToolsAndTips/components/PersonalCloudBackup';
import WalletConfigurationFiles from 'src/screens/InheritanceToolsAndTips/components/WalletConfigurationFiles';
import BackupAndRecoveryTips from 'src/screens/InheritanceToolsAndTips/components/BackupAndRecoveryTips';
import LetterOfAttorney from 'src/screens/InheritanceToolsAndTips/components/LetterOfAttorney';
import RecoveryInstruction from 'src/screens/InheritanceToolsAndTips/components/RecoveryInstruction';
import PrintableTemplates from 'src/screens/InheritanceToolsAndTips/components/PrintableTemplates';
import InheritanceTips from 'src/screens/InheritanceToolsAndTips/components/InheritanceTips';
import RecoveryPhraseTemplate from 'src/screens/InheritanceToolsAndTips/components/RecoveryPhraseTemplate';
import TrustedContactTemplates from 'src/screens/InheritanceToolsAndTips/components/TrustedContactsTemplate';
import AdditionalSignerDetailsTemplate from 'src/screens/InheritanceToolsAndTips/components/AdditionalSignerDetailsTemplate';
import HandleFileScreen from 'src/screens/SigningDevices/HandleFileScreen';
import ZendeskOnboardingModal from 'src/components/Modal/ConciergeOnboardingModal';
import PassportConfigRecovery from 'src/screens/SigningDevices/PassportConfigRecovery';
import { useAppSelector } from 'src/store/hooks';
import RemoteSharing from 'src/screens/SigningDevices/RemoteSharing';
import SignerSelectionListScreen from 'src/screens/Recieve/SignerSelectionListScreen';
import AssociateContact from 'src/screens/Contact/AssociateContact';
import AddContact from 'src/screens/Contact/AddContact';
import EditContact from 'src/screens/Contact/EditContact';
import ManageTapsignerSettings from 'src/screens/Vault/ManageTapsignerSettings';
import ManageSatochipSettings from 'src/screens/Vault/ManageSatochipSettings';
import SetupPortal from 'src/screens/SigningDevices/SetupPortal';
import SelectWalletScreen from 'src/screens/Send/SelectWallet';
import PSBTSendConfirmation from 'src/screens/Send/PSBTSendConfirmation';
import ResetInitialTimelock from 'src/screens/Vault/ResetInitialTimelock';
import ResetInheritanceKey from 'src/screens/Vault/ResetInheritanceKey';
import ResetEmergencyKey from 'src/screens/Vault/ResetEmergencyKey';
import AdditionalDetails from 'src/screens/Vault/AdditionalDetails';
import SelectInitialTimelock from 'src/screens/Vault/SelectInitialTimelock';
import AddReserveKey from 'src/screens/Vault/AddReserveKey';
import AddEmergencyKey from 'src/screens/Vault/AddEmergencyKey';
import { useColorMode } from 'native-base';
import Login from '../screens/LoginScreen/Login';
import { AppStackParams } from './types';
import config from 'src/utils/service-utilities/config';
import KeyHistory from 'src/screens/Vault/KeyHistory';
import NodeSelection from 'src/screens/AppSettings/Node/NodeSelection';
import KeeperConcierge from 'src/screens/KeeperConcierge/KeeperConcierge';
import TechnicalSupport from 'src/screens/KeeperConcierge/TechnicalSupport';
import TicketDetails from 'src/screens/KeeperConcierge/TicketDetails';
import CreateTicket from 'src/screens/KeeperConcierge/CreateTicket';
import ImportContactFile from 'src/screens/SigningDevices/ImportContactFile';
import ContactDetails from 'src/screens/SigningDevices/ContactDetails';
import ShareQR from 'src/screens/SigningDevices/ShareQR';
import ScanNode from 'src/screens/AppSettings/Node/ScanNode';
import NotificationsCenter from 'src/screens/Home/Notifications/NotificationsCenter';
import SettingsApp from 'src/screens/Home/components/Settings/AppSettings';
import InheritanceDocumentScreen from 'src/screens/Home/components/Settings/InheritanceDocumentScreen';
import HardwareWallet from 'src/screens/Hardware/Hardware';
import SpendingLimit from 'src/screens/Vault/SpendingLimit';
import SigningDelay from 'src/screens/Vault/SigningDelay';
import ServerKeySuccessScreen from 'src/screens/Vault/ServerKeySuccessScreen';
import SigningRequest from 'src/screens/Vault/SigningRequest';
import PurchaseWithChannel from 'src/screens/QRScreens/PurchaseWithChannel';
import { AddMultipleXpub } from 'src/screens/AddSigner/AddMultipleXpub';
import AppStateHandler from './AppStateHandler';
import AdditionalUsers from 'src/screens/Vault/AdditionalUsers';
import SetupAdditionalServerKey from 'src/screens/SigningDevices/SetupAdditionalServerKey';
import { MultiUserScreen } from 'src/screens/AppSettings/MultiUserScreen';
import { AddMultipleXpubFiles } from 'src/screens/AddSigner/AddMultipleXpubFiles';
import { SignMessageScreen } from 'src/screens/WalletDetails/SignMessageScreen';
import AddUsdtWallet from 'src/screens/USDT/UsdtAddWallet';
import UsdtDetails from 'src/screens/USDT/UsdtDetails';
import RecieveUsdt from 'src/screens/USDT/RecieveUsdt';
import BuyUstd from 'src/screens/USDT/BuyUstd';
import SendUsdt from 'src/screens/USDT/SendUsdt';
import UsdtAmount from 'src/screens/USDT/UsdtAmount';
import UsdtSendConfirmation from 'src/screens/USDT/UsdtSendConfirmation';
import UsdtTransactionDetail from 'src/screens/USDT/UsdtTransactionDetail';
import UsdtTransactionHistory from 'src/screens/USDT/UsdtTransactionHistory';
import Usdtsetting from 'src/screens/USDT/Usdtsetting';
import { CloudBackupPassword } from 'src/screens/CloudBackup/CloudBackupPassword';
import { ImportedWalletSetup } from 'src/screens/Vault/ImportedWalletSetup';
import KeeperSupport from 'src/screens/KeeperConcierge/KeeperSupport';
import Advisors from 'src/screens/Advisors/Advisors';
import FilterAdvisor from 'src/screens/Advisors/FilterAdvisor';
import AdvisorDetail from 'src/screens/Advisors/AdvisorDetail';
import { Swaps } from 'src/screens/Home/components/buyBtc/Swap/Swaps';
import { SwapDetails } from 'src/screens/Home/components/buyBtc/Swap/SwapDetails';
import { SwapHistory } from 'src/screens/Home/components/buyBtc/Swap/SwapHistory';
import { SwapHistoryDetail } from 'src/screens/Home/components/buyBtc/Swap/SwapHistoryDetail';
import { SwapAllHistory } from 'src/screens/Home/components/buyBtc/Swap/SwapAllHistory';
import { TipBottomSheet } from 'src/components/Modal/TipBottomSheet';
import { SendTip } from 'src/screens/Send/SendTip';
import { ViewRecoveryKeyScreen } from 'src/screens/BackupWallet/ViewRecoveryKeyScreen';

function LoginStack() {
  const Stack = createNativeStackNavigator();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen options={{ gestureEnabled: false }} name="Splash" component={SplashScreen} />
      <Stack.Screen options={{ gestureEnabled: false }} name="Login" component={Login} />
      <Stack.Screen options={{ gestureEnabled: false }} name="CreatePin" component={CreatePin} />
      <Stack.Screen name="NodeSettings" component={NodeSettings} />
      <Stack.Screen name="NodeSelection" component={NodeSelection} />
      <Stack.Screen name="ScanNode" component={ScanNode} />
      <Stack.Screen
        options={{ gestureEnabled: false }}
        name="OnBoardingSlides"
        component={OnBoardingSlides}
      />
      <Stack.Screen
        name="NewKeeperApp"
        options={{ gestureEnabled: false }}
        component={NewKeeperApp}
      />
      {/* Cold Card */}
      <Stack.Screen name="AddColdCardRecovery" component={SetupColdCard} />
      {/* Tap Signer  */}
      <Stack.Screen name="AddTapsignerRecovery" component={SetupTapsigner} />
      {/* Satochip */}
      <Stack.Screen name="AddSatochipRecovery" component={SetupSatochip} />
      {/* QR Based SDs */}
      <Stack.Screen options={{ gestureEnabled: false }} name="ScanQR" component={ScanQR} />
      {/* Channel Based SDs */}
      <Stack.Screen name="ConnectChannel" component={ConnectChannel} />
      {/* Mobile Key, Seed Key */}
      <Stack.Screen name="EnterSeedScreen" component={EnterSeedScreen} />
      <Stack.Screen name="UnlockTapsigner" component={UnlockTapsigner} />
      {/* Other SD */}
      <Stack.Screen name="SetupOtherSDScreen" component={SetupOtherSDScreen} />
    </Stack.Navigator>
  );
}

function AppStack() {
  const Stack = createNativeStackNavigator<AppStackParams>();
  return (
    <RealmProvider>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="NotificationsCenter" component={NotificationsCenter} />
        <Stack.Screen name="Login" component={Login} />
        <Stack.Screen name="SignerCategoryList" component={SignerCategoryList} />
        <Stack.Screen name="SigningDeviceList" component={SigningDeviceList} />
        <Stack.Screen name="TapsignerAction" component={SetupTapsigner} />
        <Stack.Screen name="SatochipAction" component={SetupSatochip} />
        <Stack.Screen name="SetupPortal" component={SetupPortal} />
        <Stack.Screen name="AddColdCard" component={SetupColdCard} />
        <Stack.Screen name="PassportConfigRecovery" component={PassportConfigRecovery} />
        <Stack.Screen name="AppVersionHistory" component={AppVersionHistory} />
        <Stack.Screen name="TorSettings" component={TorSettings} />
        <Stack.Screen name="ManageWallets" component={ManageWallets} />
        <Stack.Screen name="PreviewPDF" component={PreviewPDF} />
        <Stack.Screen name="Send" component={SendScreen} />
        <Stack.Screen name="SelectWallet" component={SelectWalletScreen} />
        <Stack.Screen name="UTXOLabeling" component={UTXOLabeling} />
        <Stack.Screen name="Receive" component={ReceiveScreen} />
        <Stack.Screen name="SignerSelectionListScreen" component={SignerSelectionListScreen} />
        <Stack.Screen name="ChangeLanguage" component={ChangeLanguage} />
        <Stack.Screen name="ChoosePlan" component={ChoosePlan} />
        <Stack.Screen name="ConfirmWalletDetails" component={ConfirmWalletDetails} />
        <Stack.Screen name="UpdateWalletDetails" component={UpdateWalletDetails} />
        <Stack.Screen name="WalletDetailsSettings" component={WalletDetailsSettings} />
        <Stack.Screen name="ExportSeed" component={ExportSeedScreen} />
        <Stack.Screen name="SeedDetails" component={SeedDetailsScreen} />
        <Stack.Screen name="ImportWalletDetails" component={ImportWalletDetailsScreen} />
        <Stack.Screen name="AddDetailsFinal" component={AddDetailsFinalScreen} />
        <Stack.Screen name="AddSendAmount" component={AddSendAmount} />
        <Stack.Screen name="SendConfirmation" component={SendConfirmation} />
        <Stack.Screen name="PSBTSendConfirmation" component={PSBTSendConfirmation} />
        <Stack.Screen name="WalletDetails" component={WalletDetails} />
        <Stack.Screen name="VaultDetails" component={VaultDetails} />
        <Stack.Screen name="UTXOManagement" component={UTXOManagement} />
        <Stack.Screen name="WalletSettings" component={WalletSettings} />
        <Stack.Screen name="SigningDeviceDetails" component={SigningDeviceDetails} />
        <Stack.Screen name="WalletBackHistory" component={WalletBackHistoryScreen} />
        <Stack.Screen name="AppBackupSettings" component={AppBackupSettings} />
        <Stack.Screen name="SignTransactionScreen" component={SignTransactionScreen} />
        <Stack.Screen name="AddSigningDevice" component={AddSigningDevice} />
        <Stack.Screen name="DiscountCodes" component={DiscountCodes} />
        <Stack.Screen name="CanaryWallets" component={CanaryWallets} />
        <Stack.Screen name="AssistedKeys" component={AssistedKeys} />
        <Stack.Screen name="SafeKeepingTips" component={SafeKeepingTips} />
        <Stack.Screen name="SafeGuardingTips" component={SafeGuardingTips} />
        <Stack.Screen name="MasterRecoveryKey" component={MasterRecoveryKey} />
        <Stack.Screen name="PersonalCloudBackup" component={PersonalCloudBackup} />
        <Stack.Screen name="WalletConfigurationFiles" component={WalletConfigurationFiles} />
        <Stack.Screen name="BackupAndRecoveryTips" component={BackupAndRecoveryTips} />
        <Stack.Screen name="LetterOfAttorney" component={LetterOfAttorney} />
        <Stack.Screen name="RecoveryInstruction" component={RecoveryInstruction} />
        <Stack.Screen name="PrintableTemplates" component={PrintableTemplates} />
        <Stack.Screen name="InheritanceTips" component={InheritanceTips} />
        <Stack.Screen name="RecoveryPhraseTemplate" component={RecoveryPhraseTemplate} />
        <Stack.Screen name="TrustedContactTemplates" component={TrustedContactTemplates} />
        <Stack.Screen
          name="AdditionalSignerDetailsTemplate"
          component={AdditionalSignerDetailsTemplate}
        />
        <Stack.Screen name="SetupSigningServer" component={SetupSigningServer} />
        <Stack.Screen name="HardwareWallet" component={HardwareWallet} />
        <Stack.Screen name="SpendingLimit" component={SpendingLimit} />
        <Stack.Screen name="SigningDelay" component={SigningDelay} />
        <Stack.Screen name="SigningRequest" component={SigningRequest} />
        <Stack.Screen name="AdditionalUsers" component={AdditionalUsers} />
        <Stack.Screen name="ServerKeySuccessScreen" component={ServerKeySuccessScreen} />
        <Stack.Screen name="SetupAdditionalServerKey" component={SetupAdditionalServerKey} />
        <Stack.Screen name="addUsdtWallet" component={AddUsdtWallet} />
        <Stack.Screen name="usdtDetails" component={UsdtDetails} />
        <Stack.Screen name="usdtReceive" component={RecieveUsdt} />
        <Stack.Screen name="buyUstd" component={BuyUstd} />
        <Stack.Screen name="sendUsdt" component={SendUsdt} />
        <Stack.Screen name="usdtAmount" component={UsdtAmount} />
        <Stack.Screen name="usdtSendConfirmation" component={UsdtSendConfirmation} />
        <Stack.Screen name="usdtTransactionDetail" component={UsdtTransactionDetail} />
        <Stack.Screen name="usdtTransactionHistory" component={UsdtTransactionHistory} />
        <Stack.Screen name="usdtsetting" component={Usdtsetting} />

        <Stack.Screen name="SetupSeedWordSigner" component={SetupSeedWordSigner} />
        <Stack.Screen name="ArchivedVault" component={ArchivedVault} />
        <Stack.Screen name="VaultSettings" component={VaultSettings} />
        <Stack.Screen name="SignWithColdCard" component={SignWithColdCard} />
        <Stack.Screen name="ChoosePolicyNew" component={ChoosePolicyNew} />
        <Stack.Screen name="AllTransactions" component={AllTransactions} />
        <Stack.Screen name="TransactionDetails" component={TransactionDetails} />
        <Stack.Screen name="TransactionHistory" component={TransactionHistory} />
        <Stack.Screen name="TransactionAdvancedDetails" component={TransactionAdvancedDetails} />
        <Stack.Screen name="SignerAdvanceSettings" component={SignerAdvanceSettings} />
        <Stack.Screen name="ScanQR" component={ScanQR} />
        <Stack.Screen name="ShowPSBT" component={ShowPSBT} />
        <Stack.Screen name="RegisterWithQR" component={RegisterWithQR} />
        <Stack.Screen name="SignWithQR" component={SignWithQR} />
        <Stack.Screen name="NodeSettings" component={NodeSettings} />
        <Stack.Screen name="NodeSelection" component={NodeSelection} />
        <Stack.Screen name="ScanNode" component={ScanNode} />
        <Stack.Screen name="PrivacyAndDisplay" component={PrivacyAndDisplay} />
        <Stack.Screen name="ConnectChannel" component={ConnectChannel} />
        <Stack.Screen name="RegisterWithChannel" component={RegisterWithChannel} />
        <Stack.Screen name="SetupOtherSDScreen" component={SetupOtherSDScreen} />
        <Stack.Screen name="SignWithChannel" component={SignWithChannel} />
        <Stack.Screen name="CosignerDetails" component={CosignerDetails} />
        <Stack.Screen name="AdditionalDetails" component={AdditionalDetails} />
        <Stack.Screen name="KeyHistory" component={KeyHistory} />
        <Stack.Screen name="RemoteSharing" component={RemoteSharing} />
        <Stack.Screen name="GenerateVaultDescriptor" component={GenerateVaultDescriptor} />
        <Stack.Screen name="SetupCollaborativeWallet" component={SetupCollaborativeWallet} />
        <Stack.Screen name="EnterSeedScreen" component={EnterSeedScreen} />
        <Stack.Screen name="UnlockTapsigner" component={UnlockTapsigner} />
        <Stack.Screen name="ChangeTapsignerPin" component={ChangeTapsignerPin} />
        <Stack.Screen name="SatochipSetupPin" component={SatochipSetupPin} />
        <Stack.Screen name="ChangeSatochipPin" component={ChangeSatochipPin} />
        <Stack.Screen name="SatochipVerifyAuthenticity" component={SatochipVerifyAuthenticity} />
        <Stack.Screen name="ResetSatochipSeed" component={ResetSatochipSeed} />
        <Stack.Screen name="ImportSatochipSeed" component={ImportSatochipSeed} />
        <Stack.Screen name="SatochipSeedImportModal" component={SatochipSeedImportModal} />
        <Stack.Screen name="VaultConfigurationCreation" component={VaultConfigurationCreation} />
        <Stack.Screen name="AssignSignerType" component={AssignSignerType} />
        <Stack.Screen name="AddNewWallet" component={AddNewWallet} />
        <Stack.Screen name="SettingApp" component={SettingsApp} />
        <Stack.Screen name="InheritanceDocumentScreen" component={InheritanceDocumentScreen} />
        <Stack.Screen name="ManageSigners" component={ManageSigners} />
        <Stack.Screen name="BuyBitcoin" component={BuyBitcoinScreen} />
        <Stack.Screen name="CloudBackup" component={CloudBackupScreen} />
        <Stack.Screen name="DeleteKeys" component={DeleteKeys} />
        <Stack.Screen name="HandleFile" component={HandleFileScreen} />
        <Stack.Screen name="AssociateContact" component={AssociateContact} />
        <Stack.Screen name="AddContact" component={AddContact} />
        <Stack.Screen name="EditContact" component={EditContact} />
        <Stack.Screen name="ManageTapsignerSettings" component={ManageTapsignerSettings} />
        <Stack.Screen name="ManageSatochipSettings" component={ManageSatochipSettings} />
        <Stack.Screen name="SelectInitialTimelock" component={SelectInitialTimelock} />
        <Stack.Screen name="AddReserveKey" component={AddReserveKey} />
        <Stack.Screen name="AddEmergencyKey" component={AddEmergencyKey} />
        <Stack.Screen name="ResetInitialTimelock" component={ResetInitialTimelock} />
        <Stack.Screen name="ResetInheritanceKey" component={ResetInheritanceKey} />
        <Stack.Screen name="ResetEmergencyKey" component={ResetEmergencyKey} />
        <Stack.Screen name="KeeperConcierge" component={KeeperConcierge} />
        <Stack.Screen name="TechnicalSupport" component={TechnicalSupport} />
        <Stack.Screen name="TicketDetails" component={TicketDetails} />
        <Stack.Screen name="CreateTicket" component={CreateTicket} />
        <Stack.Screen name="ImportContactFile" component={ImportContactFile} />
        <Stack.Screen name="ContactDetails" component={ContactDetails} />
        <Stack.Screen name="ShareQR" component={ShareQR} />
        <Stack.Screen name="PurchaseWithChannel" component={PurchaseWithChannel} />
        <Stack.Screen name="AddMultipleXpub" component={AddMultipleXpub} />
        <Stack.Screen name="MultiUserScreen" component={MultiUserScreen} />
        <Stack.Screen name="AddMultipleXpubFiles" component={AddMultipleXpubFiles} />
        <Stack.Screen name="SignMessageScreen" component={SignMessageScreen} />
        <Stack.Screen name="CloudBackupPassword" component={CloudBackupPassword} />
        <Stack.Screen name="ImportedWalletSetup" component={ImportedWalletSetup} />
        <Stack.Screen name="KeeperSupport" component={KeeperSupport} />
        <Stack.Screen name="Advisors" component={Advisors} />
        <Stack.Screen name="FilterAdvisor" component={FilterAdvisor} />
        <Stack.Screen name="AdvisorDetail" component={AdvisorDetail} />
        <Stack.Screen name="Swaps" component={Swaps} />
        <Stack.Screen name="SwapDetails" component={SwapDetails} />
        <Stack.Screen name="SwapHistory" component={SwapHistory} />
        <Stack.Screen name="SwapHistoryDetail" component={SwapHistoryDetail} />
        <Stack.Screen name="SwapAllHistory" component={SwapAllHistory} />
        <Stack.Screen name="SendTip" component={SendTip} />
        <Stack.Screen name="ViewRecoveryKeyScreen" component={ViewRecoveryKeyScreen} />
      </Stack.Navigator>
    </RealmProvider>
  );
}

function Navigator() {
  const Stack = createNativeStackNavigator();
  const navigation = useRef();
  const { appLoading, loadingContent } = useContext(AppContext);
  const { colorMode } = useColorMode();
  const defaultTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: colorMode === 'light' ? Colors.secondaryCreamWhite : Colors.PrimaryBlack,
    },
  };
  const navigationIntegration = Sentry.reactNavigationIntegration({
    enableTimeToInitialDisplay: true,
  });

  // Register the navigation container with the instrumentation
  const onReady = () => {
    if (config.isDevMode()) {
      // updated with RNv0.73.0
      navigationIntegration.registerNavigationContainer(navigation);
    }
  };

  const { onboardingModal } = useAppSelector((state) => state.concierge);

  return (
    <NavigationContainer theme={defaultTheme} ref={navigation} onReady={onReady}>
      <AppStateHandler />
      <ZendeskOnboardingModal visible={onboardingModal} />

      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="LoginStack" component={LoginStack} />
        <Stack.Screen name="App" component={AppStack} />
      </Stack.Navigator>
      <KeeperLoader
        visible={appLoading}
        loadingContent={loadingContent}
        close={() => {}}
        title="please wait"
        subTitle="loading"
      />
      <TipBottomSheet />
    </NavigationContainer>
  );
}

export default Navigator;
