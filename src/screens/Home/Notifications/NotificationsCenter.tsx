import { Box, useColorMode } from 'native-base';
import React, { memo, useEffect, useState, useMemo, useContext } from 'react';
import { ActivityIndicator, StyleSheet, SectionList } from 'react-native';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import Instruction from 'src/components/Instruction';
import KeeperModal from 'src/components/KeeperModal';
import useUaiStack from 'src/hooks/useUaiStack';
import FeeInsightsContent from 'src/screens/FeeInsights/FeeInsightsContent';
import { SentryErrorBoundary } from 'src/services/sentry';
import { uaiActioned, uaisSeen } from 'src/store/sagaActions/uai';
import { useDispatch } from 'react-redux';
import { CommonActions, useNavigation } from '@react-navigation/native';
import useToastMessage from 'src/hooks/useToastMessage';
import ServerTransNotificaiton from 'src/assets/images/server-transaction-notification-icon.svg';
import useSignerMap from 'src/hooks/useSignerMap';
import { SignerType } from 'src/services/wallets/enums';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { UAI, uaiType } from 'src/models/interfaces/Uai';
import { hp, wp } from 'src/constants/responsive';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import Text from 'src/components/KeeperText';
import BackupRecoveryIcon from 'src/assets/images/backup_recovery_key.svg';
import CanaryWalletIcon from 'src/assets/images/canary_wallet_notification.svg';
import FeeInsightsIcon from 'src/assets/images/fee_insights.svg';
import HealthCheckIcon from 'src/assets/images/health_check_reminder.svg';
import TechSupportIcon from 'src/assets/images/tech_support_received.svg';
import TransferToVaultIcon from 'src/assets/images/transfer_to_vault.svg';
import NotificationSimpleIcon from 'src/assets/images/header-notification-simple-icon.svg';
import CloudBackupIcon from 'src/assets/images/cloud-backup-icon.svg';
import RecevieIcon from 'src/assets/images/send-diagonal-arrow-down.svg';
import DiscountIcon from 'src/assets/images/discountIcon.svg';
import { useAppSelector } from 'src/store/hooks';
import { cachedTxSnapshot } from 'src/store/reducers/cachedTxn';
import UAIView from '../components/UAIView';
import { setStateFromSnapshot } from 'src/store/reducers/send_and_receive';
import { backupAllSignersAndVaults } from 'src/store/sagaActions/bhr';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import Fonts from 'src/constants/Fonts';

type CardProps = {
  uai: any;
};
interface uaiDefinationInterface {
  heading: string;
  body: string;
  icon: React.ComponentType<any>;
  btnConfig: {
    primary: {
      text: string;
      cta: any;
    };
  };
  modalDetails?: {
    heading: string;
    subTitle: string;
    body: any;
    sender?: Object;
    recipient?: Object;
    btnConfig: {
      primary: {
        text: string;
        cta: any;
      };
    };
    hideHiddenVaults?: boolean;
  };
}

const SUPPORTED_NOTOFOCATION_TYPES = [
  uaiType.SECURE_VAULT,
  uaiType.SIGNING_DEVICES_HEALTH_CHECK,
  uaiType.RECOVERY_PHRASE_HEALTH_CHECK,
  uaiType.RECOVERY_PHRASE_HEALTH_CHECK,
  uaiType.CANARAY_WALLET,
  uaiType.ZENDESK_TICKET,
  uaiType.SIGNING_DELAY,
  uaiType.POLICY_DELAY,
  uaiType.INCOMING_TRANSACTION,
  uaiType.SERVER_BACKUP_FAILURE,
];

const Card = memo(({ uai }: CardProps) => {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const navigtaion = useNavigation();
  const { showToast } = useToastMessage();
  const [showModal, setShowModal] = useState(false);
  const [insightModal, setInsightModal] = useState(false);
  const { signerMap } = useSignerMap();
  const snapshots = useAppSelector((state) => state.cachedTxn.snapshots);
  const { backupAllLoading } = useAppSelector((state) => state.bhr);
  const { translations } = useContext(LocalizationContext);
  const { common, notification, error: errorTranslation } = translations;

  const getUaiTypeDefinations = (uai: UAI): uaiDefinationInterface => {
    const backupHistory = useQuery(RealmSchema.BackupHistory);
    const content = getUaiContent(uai.uaiType, uai.uaiDetails);

    switch (uai.uaiType) {
      case uaiType.SECURE_VAULT:
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.continue,
              cta: () => {
                navigtaion.navigate('AddNewWallet');
              },
            },
          },
          modalDetails: {
            heading: notification.setupFirstVault,
            subTitle: notification.createVault,
            body: notification.enhancedSecurityofVault,
            btnConfig: {
              primary: {
                text: common.continue,
                cta: () => {
                  setShowModal(false);
                },
              },
            },
          },
        };
      case uaiType.SIGNING_DEVICES_HEALTH_CHECK:
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.continue,
              cta: () => {
                navigtaion.navigate('SigningDeviceDetails', {
                  signerId: uai.entityId,
                  isUaiFlow: true,
                });
              },
            },
          },
        };
      case uaiType.RECOVERY_PHRASE_HEALTH_CHECK:
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.backup,
              cta: () => {
                if (backupHistory.length === 0) {
                  navigtaion.navigate('Home', {
                    selectedOption: 'More',
                    isUaiFlow: true,
                  });
                } else {
                  navigtaion.navigate('WalletBackHistory', {
                    isUaiFlow: true,
                  });
                }
              },
            },
          },
        };
      case uaiType.FEE_INISGHT:
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: notification.viewInsights,
              cta: () => {
                setInsightModal(true);
              },
            },
          },
          modalDetails: {
            heading: notification.feeInsight,
            subTitle: '',
            body: '',
            btnConfig: {
              primary: {
                text: common.continue,
                cta: () => {},
              },
            },
          },
        };
      case uaiType.CANARAY_WALLET:
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.View,
              cta: () => {
                navigtaion.navigate('VaultDetails', { vaultId: uai.entityId });
              },
            },
          },
        };
      case uaiType.ZENDESK_TICKET: {
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.View,
              cta: () => {
                dispatch(uaiActioned({ uaiId: uai.id, action: false }));
                navigtaion.navigate('TicketDetails', {
                  ticketId: parseInt(uai.entityId),
                  ticketStatus: uai.uaiDetails.heading,
                });
              },
            },
          },
        };
      }
      case uaiType.SIGNING_DELAY: {
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.View,
              cta: () => {
                const delayedTxid = uai.entityId;
                const snapshot: cachedTxSnapshot = snapshots[delayedTxid]; // cachedTxid is same as delayedTxid
                dispatch(uaiActioned({ uaiId: uai.id, action: false }));
                if (snapshot) {
                  dispatch(setStateFromSnapshot(snapshot.state));
                  navigtaion.dispatch(
                    CommonActions.navigate('SendConfirmation', {
                      ...snapshot.routeParams,
                      addresses: snapshot.routeParams.addresses,
                      amounts: snapshot.routeParams.amounts,
                      internalRecipients: snapshot.routeParams.internalRecipients,
                    })
                  );
                } else {
                  showToast(errorTranslation.pendingTransactionsNotFound);
                }
              },
            },
          },
        };
      }
      case uaiType.POLICY_DELAY: {
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.View,
              cta: () => {
                dispatch(uaiActioned({ uaiId: uai.id, action: false }));
                navigtaion.dispatch(
                  CommonActions.navigate({
                    name: 'ChoosePolicyNew',
                    params: {
                      isUpdate: true,
                      signer: Object.values(signerMap).find(
                        (signer) => signer.type === SignerType.POLICY_SERVER
                      ),
                    },
                  })
                );
              },
            },
          },
        };
      }
      case uaiType.INCOMING_TRANSACTION: {
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.View,
              cta: () => {
                dispatch(uaiActioned({ uaiId: uai.id, action: false }));

                const navigationState = {
                  index: 1,
                  routes: [
                    { name: 'Home' },
                    {
                      name:
                        uai.entityId.split('_')[0] === 'VAULT' ? 'VaultDetails' : 'WalletDetails',
                      params: {
                        vaultId: uai.entityId.split('_')[1],
                        walletId: uai.entityId.split('_')[1],
                        viewTransaction: uai.entityId.split('_')[2],
                      },
                    },
                  ],
                };
                navigtaion.dispatch(CommonActions.reset(navigationState));
              },
            },
          },
        };
      }
      case uaiType.SERVER_BACKUP_FAILURE: {
        return {
          heading: content.heading,
          body: content.body,
          icon: content.icon,
          btnConfig: {
            primary: {
              text: common.View,
              cta: () => {
                dispatch(uaiActioned({ uaiId: uai.id, action: false }));
                dispatch(backupAllSignersAndVaults());
              },
            },
          },
        };
      }

      default:
        return null;
    }
  };

  const uaiConfig = getUaiTypeDefinations(uai);

  if (!uaiConfig) {
    return <></>;
  }

  return (
    <>
      <Box style={styles.card} backgroundColor={`${colorMode}.seashellWhite`}>
        <UAIView
          title={uaiConfig.heading}
          subTitle={uaiConfig.body}
          icon={uaiConfig.icon}
          primaryCallback={uaiConfig.btnConfig.primary.cta}
        />
      </Box>
      <KeeperModal
        visible={showModal}
        close={() => {
          setShowModal(false);
        }}
        title={uaiConfig?.modalDetails?.heading}
        subTitle={uaiConfig?.modalDetails?.subTitle}
        buttonText={uaiConfig?.modalDetails?.btnConfig.primary.text}
        buttonCallback={uaiConfig?.modalDetails?.btnConfig.primary.cta}
        showCloseIcon={false}
        Content={() => <Instruction text={uaiConfig?.modalDetails?.body} />}
      />
      <KeeperModal
        visible={insightModal}
        close={() => {
          setInsightModal(false);
          dispatch(uaiActioned({ uaiId: uai.id, action: false }));
        }}
        showCloseIcon={false}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonText={common.done}
        buttonCallback={() => {
          setInsightModal(false);
          dispatch(uaiActioned({ uaiId: uai.id, action: false }));
        }}
        Content={() => <FeeInsightsContent />}
      />
      <ActivityIndicatorView visible={backupAllLoading} showLoader />
    </>
  );
});

function NotificationsCenter() {
  const { colorMode } = useColorMode();
  let { uaiStack, isLoading } = useUaiStack();
  const dispatch = useDispatch();
  const { translations } = useContext(LocalizationContext);
  const { common, notification } = translations;

  const { unseenNotifications, seenNotifications } = useMemo(
    () => ({
      unseenNotifications: uaiStack
        .filter((uai) => !uai.seenAt)
        .filter((uai) => SUPPORTED_NOTOFOCATION_TYPES.includes(uai.uaiType))
        .sort((a, b) => {
          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return b.createdAt.getTime() - a.createdAt.getTime();
        }),
      seenNotifications: uaiStack
        .filter((uai) => uai.seenAt)
        .filter((uai) => SUPPORTED_NOTOFOCATION_TYPES.includes(uai.uaiType))
        .sort((a, b) => {
          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return b.createdAt.getTime() - a.createdAt.getTime();
        }),
    }),
    [uaiStack]
  );

  useEffect(() => {
    if (uaiStack?.length) {
      const unseenNotifications = uaiStack.filter((notification) => !notification.seenAt);
      if (unseenNotifications.length) {
        dispatch(uaisSeen({ uaiIds: unseenNotifications.map((uai) => uai.id) }));
      }
    }
  }, [uaiStack]);

  const renderNotificationCard = ({ uai }: { uai: UAI }) => {
    return <Card uai={uai} key={uai.id} />;
  };

  return (
    <ScreenWrapper paddingHorizontal={0} backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box
        style={{
          paddingHorizontal: 20,
          paddingTop: hp(15),
          paddingBottom: hp(5),
        }}
        backgroundColor={`${colorMode}.primaryBackground`}
      >
        <WalletHeader title={common.Notifications} />
      </Box>
      <Box
        style={styles.notificationsContainer}
        height="93%"
        backgroundColor={`${colorMode}.primaryBackground`}
      >
        {isLoading ? (
          <Box height="100%" justifyContent="center" alignItems="center">
            <ActivityIndicator testID="activityIndicator" size="large" animating color="#00836A" />
          </Box>
        ) : (
          <Box height="95%">
            <Box height="95%">
              {seenNotifications.length === 0 && unseenNotifications.length === 0 ? (
                <Box
                  style={styles.NonotificationsContainer}
                  backgroundColor={`${colorMode}.textInputBackground`}
                  borderColor={`${colorMode}.separator`}
                >
                  <ThemedSvg name={'no_notification_illustration'} />
                  <Text fontSize={18} medium style={styles.text} color={`${colorMode}.primaryText`}>
                    {notification.noNewNotification}
                  </Text>
                  <Text fontSize={13} color={`${colorMode}.primaryText`} style={styles.subTitle}>
                    {notification.noNotiSub}
                  </Text>
                </Box>
              ) : (
                <SectionList
                  sections={[
                    {
                      title: common.New,
                      data: unseenNotifications,
                      show: unseenNotifications.length > 0,
                    },
                    {
                      title: common.Seen,
                      data: seenNotifications,
                      show: seenNotifications.length > 0,
                    },
                  ].filter((section) => section.show)}
                  renderItem={({ item }) => renderNotificationCard({ uai: item })}
                  renderSectionHeader={({ section: { title } }) => (
                    <Box style={styles.listHeader} backgroundColor={`${colorMode}.seashellWhite`}>
                      <Text fontSize={16} semiBold>
                        {title}
                      </Text>
                      <Box
                        style={{ borderBottomWidth: 1, marginTop: hp(8) }}
                        borderColor={`${colorMode}.pantoneGreenLight`}
                      />
                    </Box>
                  )}
                  keyExtractor={(item) => item.id}
                  showsVerticalScrollIndicator={false}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>
    </ScreenWrapper>
  );
}

export default SentryErrorBoundary(NotificationsCenter);

const styles = StyleSheet.create({
  card: {
    height: hp(100),
    justifyContent: 'center',
  },
  notificationsContainer: {
    marginTop: hp(10),
    marginBottom: hp(10),
    width: '100%',
  },
  listHeader: {
    width: '100%',
    paddingHorizontal: wp(22),
    paddingTop: wp(20),
    paddingBottom: wp(10),
  },
  NonotificationsContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginHorizontal: wp(22),
    paddingTop: hp(40),
    paddingBottom: hp(80),
    borderRadius: 20,
    paddingHorizontal: wp(30),
  },
  text: {
    marginTop: hp(30),
    marginBottom: hp(10),
    fontFamily: Fonts.LoraSemiBold,
  },
  subTitle: {
    textAlign: 'center',
  },
});

export const getUaiContent = (type: uaiType, details?: any) => {
  switch (type) {
    case uaiType.SECURE_VAULT:
      return {
        heading: 'Create Your First Vault',
        body: 'Secure your sats with a vault',
        icon: <TransferToVaultIcon />,
      };

    case uaiType.SIGNING_DEVICES_HEALTH_CHECK:
      return {
        heading: 'Health check pending',
        body: details?.body || 'Health Check for your Ledger',
        icon: <HealthCheckIcon />,
      };

    case uaiType.RECOVERY_PHRASE_HEALTH_CHECK:
      return {
        heading: 'Backup Recovery Key',
        body: 'Backup the Recovery Key to secure the app',
        icon: <BackupRecoveryIcon />,
      };

    case uaiType.FEE_INISGHT:
      return {
        heading: 'Fee Insights',
        body: details?.body || 'Check your fee insights',
        icon: <FeeInsightsIcon />,
      };

    case uaiType.CANARAY_WALLET:
      return {
        heading: 'Canary Wallet Accessed',
        body: 'One of your key has been used',
        icon: <CanaryWalletIcon />,
      };

    case uaiType.ZENDESK_TICKET:
      return {
        heading: 'Technical Support',
        body: details?.body || 'Support ticket update',
        icon: <TechSupportIcon />,
      };
    case uaiType.SIGNING_DELAY:
      return {
        heading: 'Server Key Signed Transaction',
        body: 'The Server Key signed your requested transaction',
        icon: <ServerTransNotificaiton />,
      };
    case uaiType.POLICY_DELAY:
      return {
        heading: 'Server Key Policy Updated',
        body: 'The Server Key has activated the requested policy',
        icon: <ServerTransNotificaiton />,
      };
    case uaiType.INCOMING_TRANSACTION:
      return {
        heading: 'New Transaction Received',
        body: 'Click to view the transaction details',
        icon: <RecevieIcon />,
      };
    case uaiType.SERVER_BACKUP_FAILURE:
      return {
        heading: details?.heading,
        body: details?.body,
        icon: <CloudBackupIcon />,
      };
    default:
      return {
        heading: '',
        body: '',
        icon: <NotificationSimpleIcon />,
      };
  }
};
