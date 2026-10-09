import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useCallback, useContext, useState } from 'react';
import { StyleSheet, FlatList } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useAppDispatch } from 'src/store/hooks';
import { NodeDetail } from 'src/services/wallets/interfaces';
import ScreenWrapper from 'src/components/ScreenWrapper';
import KeeperModal from 'src/components/KeeperModal';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import {
  electrumClientConnectionExecuted,
  electrumClientConnectionInitiated,
} from 'src/store/reducers/login';
import Node from 'src/services/electrum/node';
import TickIcon from 'src/assets/images/icon_tick.svg';
import DowngradeToPleb from 'src/assets/images/downgradetopleb.svg';
import DowngradeToPlebDark from 'src/assets/images/downgradetoplebDark.svg';
import Buttons from 'src/components/Buttons';
import EmptyListIllustration from 'src/components/EmptyListIllustration';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import ServerItem from './components/ServerItem';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { updateAppImage } from 'src/store/sagaActions/bhr';
import { ELECTRUM_CLIENT } from 'src/services/electrum/client';
import WalletHeader from 'src/components/WalletHeader';
import Text from 'src/components/KeeperText';

function ElectrumDisconnectWarningContent() {
  const { colorMode } = useColorMode();

  return (
    <Box width="100%" alignItems="center" justifyContent="center">
      <Box marginRight={wp(30)}>
        {colorMode === 'light' ? <DowngradeToPleb /> : <DowngradeToPlebDark />}
      </Box>
    </Box>
  );
}

type SelectedNodeAction = { node: NodeDetail; originAppId: string };

function NodeSettings() {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const dispatch = useAppDispatch();
  const { translations } = useContext(LocalizationContext);
  const { common, settings, error: errorString } = translations;
  const { showToast } = useToastMessage();

  const [nodeList, setNodeList] = useState([]);
  const [nodeListAppId, setNodeListAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [electrumDisconnectWarningVisible, setElectrumDisconnectWarningVisible] = useState(false);
  const [nodeToDisconnect, setNodeToDisconnect] = useState<SelectedNodeAction | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<SelectedNodeAction | null>(null);

  const isNoNodeConnected =
    !ELECTRUM_CLIENT.isClientConnected && nodeList.every((node) => !node.isConnected);

  useFocusEffect(
    useCallback(() => {
      const appId = Node.currentAccountId();
      setNodeListAppId(appId ?? null);
      setNodeList(appId ? Node.getAllNodes() : []);
    }, [])
  );

  const onDelete = async (selectedItem: NodeDetail, originAppId = nodeListAppId) => {
    if (!originAppId || !Node.isAccountActive(originAppId)) return;
    const isConnected = Node.nodeConnectionStatus(selectedItem);
    if (isConnected) await Node.disconnect(selectedItem);

    if (!Node.isAccountActive(originAppId)) return;

    const status = Node.delete(selectedItem);
    if (status) {
      const updatedNodes = Node.getAllNodes();
      setNodeList(updatedNodes);
      dispatch(updateAppImage({ wallets: null, signers: null, updateNodes: true }, originAppId));
    }
  };

  const onConnectToNode = async (selectedNode: NodeDetail) => {
    const originAppId = nodeListAppId;
    if (!originAppId || !Node.isAccountActive(originAppId)) return;
    dispatch(electrumClientConnectionInitiated());
    setLoading(true);
    try {
      const currentlySelectedNode = Node.getAllNodes().find((node) => node.isConnected);
      if (currentlySelectedNode && currentlySelectedNode.id !== selectedNode.id) {
        Node.disconnect(currentlySelectedNode);
        if (!Node.isAccountActive(originAppId)) return;
        Node.update(currentlySelectedNode, { isConnected: false });
      }

      const { connected, connectedTo, error } = await Node.connectToSelectedNode(
        selectedNode,
        originAppId
      );
      if (!Node.isAccountActive(originAppId)) return;
      if (connected) {
        Node.update(selectedNode, { isConnected: true });
        dispatch(electrumClientConnectionExecuted({ successful: true, connectedTo }));
        showToast(`${errorString.ConnectedTo} ${connectedTo}`, <TickIcon />);
      } else {
        dispatch(electrumClientConnectionExecuted({ successful: false, error }));
      }
    } catch (error) {
      if (Node.isAccountActive(originAppId)) {
        dispatch(
          electrumClientConnectionExecuted({
            successful: false,
            error: error?.message || String(error),
          })
        );
      }
    } finally {
      setLoading(false);
      if (Node.isAccountActive(originAppId)) setNodeList(Node.getAllNodes());
    }
  };

  const onDisconnectToNode = async (selectedNode: NodeDetail, originAppId: string) => {
    if (!Node.isAccountActive(originAppId)) return;
    try {
      setLoading(true);
      Node.disconnect(selectedNode);
      if (!Node.isAccountActive(originAppId)) return;
      Node.update(selectedNode, { isConnected: false });
      dispatch(
        electrumClientConnectionExecuted({
          successful: false,
          error: 'Disconnected from Electrum server',
        })
      );
      showToast(`${errorString.disconnectedFrom} ${selectedNode.host}`, <ToastErrorIcon />);
    } catch (error) {
      console.error('Error disconnecting electrum client', error);
      if (Node.isAccountActive(originAppId)) {
        showToast(errorString.failedToDiConnect, <ToastErrorIcon />);
      }
    } finally {
      setLoading(false);
      if (Node.isAccountActive(originAppId)) setNodeList(Node.getAllNodes());
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`} barStyle="dark-content">
      <ActivityIndicatorView visible={loading} />

      <WalletHeader
        title={settings.nodeSettings}
        subTitle={settings.manageElectrumServersSubtitle}
      />
      <Box style={styles.nodesListWrapper}>
        {nodeList.length > 0 ? (
          <FlatList
            data={nodeList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <ServerItem
                item={item}
                onDelete={onDelete}
                onConnectToNode={onConnectToNode}
                setNodeToDelete={(node: NodeDetail) => {
                  if (nodeListAppId) setNodeToDelete({ node, originAppId: nodeListAppId });
                }}
                setNodeToDisconnect={(node: NodeDetail) => {
                  if (nodeListAppId) setNodeToDisconnect({ node, originAppId: nodeListAppId });
                }}
                setElectrumDisconnectWarningVisible={setElectrumDisconnectWarningVisible}
              />
            )}
          />
        ) : (
          <Box flex={1}>
            <EmptyListIllustration listType="nodes" hideIllustration />
          </Box>
        )}
      </Box>
      {isNoNodeConnected && (
        <Text
          key={'node-connection-error'}
          color={`${colorMode}.alertRed`}
          style={{ textAlign: 'center' }}
        >
          {'Currently in Offline Mode'}
        </Text>
      )}
      <Box style={styles.footerContainer}>
        <Buttons
          primaryCallback={() => navigation.dispatch(CommonActions.navigate('NodeSelection'))}
          primaryText={`${settings.addNewNode}`}
          fullWidth
        />
      </Box>
      <KeeperModal
        visible={electrumDisconnectWarningVisible}
        close={() => {
          setNodeToDisconnect(null);
          setNodeToDelete(null);
          setElectrumDisconnectWarningVisible(false);
        }}
        title={common.disconnectingFromServer}
        subTitle={common.disconnectingFromServerText}
        buttonText={common.disconnect}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonCallback={async () => {
          setElectrumDisconnectWarningVisible(false);
          if (nodeToDisconnect) {
            await onDisconnectToNode(nodeToDisconnect.node, nodeToDisconnect.originAppId);
            setNodeToDisconnect(null);
          } else if (nodeToDelete) {
            await onDelete(nodeToDelete.node, nodeToDelete.originAppId);
            setNodeToDelete(null);
          }
        }}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setElectrumDisconnectWarningVisible(false)}
        Content={ElectrumDisconnectWarningContent}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  appSettingTitle: {
    fontSize: 18,
    letterSpacing: 1.2,
    paddingBottom: 5,
  },
  appSettingSubTitle: {
    fontSize: 12,
    letterSpacing: 0.6,
  },
  connectToMyNodeTitle: {
    fontSize: 14,
    letterSpacing: 1.12,
    paddingBottom: 5,
  },
  splitter: {
    marginTop: 35,
    marginBottom: 25,
    opacity: 0.25,
    borderBottomWidth: 1,
  },
  verticleSplitter: {
    opacity: 0.4,
    borderWidth: 0.5,
    height: 45,
  },
  nodesListWrapper: {
    marginVertical: hp(30),
    flexDirection: 'row',
    width: '100%',
    flex: 1,
  },
  nodeListTitle: {
    fontSize: 14,
    letterSpacing: 1.12,
  },
  activityIndicator: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerContainer: {
    marginTop: hp(10),
  },
});

export default NodeSettings;
