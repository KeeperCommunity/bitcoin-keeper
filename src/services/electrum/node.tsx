import ElectrumClient from 'src/services/electrum/client';
import { NodeDetail } from 'src/services/wallets/interfaces';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { NetworkType } from '../wallets/enums';
import { predefinedMainnetNodes, predefinedTestnetNodes } from './predefinedNodes';
import { store } from 'src/store/store';

export default class Node {
  public static async save(nodeDetail: NodeDetail, nodeList: NodeDetail[]) {
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
    // The tapped node must connect on its own; only then enable eligible saved
    // public peers for a later connection loss.
    ElectrumClient.setActivePeer([], selectedNode);
    const { connected, connectedTo, error, generation } = await ElectrumClient.connect();
    if (connected) {
      ElectrumClient.setFailoverPeers(
        this.getAllNodes().filter((node) => node.networkType === selectedNode.networkType),
        generation
      );
    }
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
