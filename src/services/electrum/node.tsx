import ElectrumClient from 'src/services/electrum/client';
import { NodeDetail } from 'src/services/wallets/interfaces';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { NetworkType } from '../wallets/enums';
import { predefinedMainnetNodes, predefinedTestnetNodes } from './predefinedNodes';
import { store } from 'src/store/store';

export default class Node {
  public static currentAccountId(): string | undefined {
    const appId = store.getState().storage.appId;
    return this.isAccountActive(appId) ? appId : undefined;
  }

  public static isAccountActive(appId?: string): boolean {
    try {
      return !!appId && store.getState().storage.appId === appId &&
        (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as any)?.id === appId;
    } catch {
      return false;
    }
  }

  public static async save(nodeDetail: NodeDetail, nodeList: NodeDetail[], originAppId = this.currentAccountId()) {
    if (!this.isAccountActive(originAppId))
      return { saved: false, connectionError: 'Account changed' };
    const { bitcoinNetworkType } = store.getState().settings;
    if (!nodeDetail.host || !nodeDetail.port) {
      return { saved: false, connectionError: 'Missing node host URL or port' };
    }

    // test connection before saving
    const { connected: isConnectable, error: connectionError } =
      await ElectrumClient.testConnection(nodeDetail);
    if (!isConnectable) {
      return { saved: false, connectionError };
    }
    if (!this.isAccountActive(originAppId))
      return { saved: false, connectionError: 'Account changed' };

    const node = { ...nodeDetail };

    const predefinedNodes =
      bitcoinNetworkType === NetworkType.TESTNET ? predefinedTestnetNodes : predefinedMainnetNodes;

    const allNodes = this.getAllNodes();

    const isPredefinedNode = predefinedNodes.some(
      (predefinedNode) =>
        predefinedNode.id === node.id ||
        (predefinedNode.host === node.host && predefinedNode.port === node.port)
    );
    const isExistingNode = allNodes.some(
      (savedNode) => savedNode.host === node.host && savedNode.port === node.port
    );
    const isSavedNode = allNodes.some(
      (savedNode) =>
        savedNode.id === node.id || (savedNode.host === node.host && savedNode.port === node.port)
    );

    if (isPredefinedNode && !isSavedNode) {
      if (!node.id) {
        node.id = nodeList.length + 1001;
      }
      dbManager.createObject(RealmSchema.NodeConnect, node);
      return { saved: true };
    }

    if (!node.id) {
      if (isExistingNode) {
        return { saved: true };
      }
      // case: save new node (first 1000 IDs reserved to predefined nodes)
      node.id = nodeList.length + 1001;
      dbManager.createObject(RealmSchema.NodeConnect, node);
    } else {
      // case: update existing node
      dbManager.updateObjectById(RealmSchema.NodeConnect, node.id.toString(), {
        ...node,
      });
    }

    return { saved: true };
  }

  public static update(nodeDetail: NodeDetail, propsToUpdate: any) {
    if (!nodeDetail) return null;

    dbManager.updateObjectById(RealmSchema.NodeConnect, nodeDetail.id.toString(), {
      ...propsToUpdate,
    });
  }

  public static delete(nodeDetail: NodeDetail) {
    if (!nodeDetail) return null;

    const status: boolean = dbManager.deleteObjectById(
      RealmSchema.NodeConnect,
      nodeDetail.id.toString()
    );
    return status;
  }

  public static getAllNodes(): NodeDetail[] {
    const { bitcoinNetworkType } = store.getState().settings;
    return (dbManager.getCollection(RealmSchema.NodeConnect) as unknown as NodeDetail[]).filter(
      (node) => node.networkType === bitcoinNetworkType
    );
  }

  public static async connectToSelectedNode(selectedNode: NodeDetail) {
    // connects to the selected node
    ElectrumClient.setActivePeer([], selectedNode);
    const { connected, connectedTo, error } = await ElectrumClient.connect();
    return { connected, connectedTo, error };
  }

  public static disconnect(selectedNode: NodeDetail) {
    const activePeer = ElectrumClient.getActivePeer();
    if (selectedNode.host === activePeer?.host && selectedNode.port === activePeer?.port) {
      ElectrumClient.forceDisconnect();
    }
  }

  public static nodeConnectionStatus = (node: NodeDetail) => {
    const activePeer = ElectrumClient.getActivePeer();

    if (
      activePeer?.host === node.host &&
      activePeer?.port === node.port &&
      activePeer?.isConnected
    ) {
      return true;
    }

    return false;
  };

  public static decodeQR(qrData: string) {
    const parts = qrData.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid QR data format');
    }

    const host = parts[0];
    const port = parts[1];
    const useSSL = parts[2] === 't';

    return {
      host,
      port,
      useSSL,
    };
  }
}
