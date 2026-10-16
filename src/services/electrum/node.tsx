import ElectrumClient from 'src/services/electrum/client';
import { NodeDetail } from 'src/services/wallets/interfaces';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { store } from 'src/store/store';
import { commitBackupLocalOperation } from 'src/services/backup/automatic';
import type { BackupLocalOperation } from 'src/services/backup/automatic';
import { currentBackupAccountSession } from 'src/services/backup/transport';
import { predefinedMainnetNodes, predefinedTestnetNodes } from './predefinedNodes';
import { NetworkType } from '../wallets/enums';

export default class Node {
  public static currentAccountId(): string | undefined {
    const {appId} = store.getState().storage;
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

  public static async save(nodeDetail: NodeDetail, _nodeList: NodeDetail[], originAppId?: string, backupOperation?: BackupLocalOperation) {
    originAppId ??= this.currentAccountId();
    const accountSession = backupOperation?.accountSession ?? currentBackupAccountSession();
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
    if (!this.isAccountActive(originAppId) || accountSession !== currentBackupAccountSession())
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

    if (!node.id && isExistingNode) return { saved: true };
    if (!node.id) {
      // IDs cover both networks because the recoverable node map is account-wide.
      const savedNodes = Array.from(dbManager.getCollection(RealmSchema.NodeConnect)) as unknown as NodeDetail[];
      node.id = Math.max(1000, ...savedNodes.map((saved) => saved.id)) + 1;
    }
    if (backupOperation) {
      const committedOperation = commitBackupLocalOperation(backupOperation, (localRealm) => {
        // NodeConnect has no Realm primary key; use its stable id and network.
        const saved = localRealm.objects(RealmSchema.NodeConnect)
          .filtered('id == $0 AND networkType == $1', node.id, node.networkType)[0];
        if (saved) Object.assign(saved, node);
        else localRealm.create(RealmSchema.NodeConnect, node);
      });
      return { saved: committedOperation.committed, committedOperation,
        connectionError: committedOperation.committed ? undefined : 'Node changes could not be saved' };
    }
    const saved = (isPredefinedNode && !isSavedNode) || !allNodes.some((savedNode) => savedNode.id === node.id)
      ? dbManager.createObject(RealmSchema.NodeConnect, node)
      : dbManager.updateObjectById(RealmSchema.NodeConnect, node.id.toString(), node);
    return { saved: saved === true };
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

  public static async connectToSelectedNode(
    selectedNode: NodeDetail,
    originAppId = this.currentAccountId(),
    originBackupAccountSession = currentBackupAccountSession()
  ) {
    if (!this.isAccountActive(originAppId) || currentBackupAccountSession() !== originBackupAccountSession) {
      return { connected: false, connectedTo: undefined, error: 'Account changed' };
    }
    // The tapped node must connect on its own; only then enable eligible saved
    // public peers for a later connection loss.
    ElectrumClient.setActivePeer([], selectedNode);
    const { connected, connectedTo, error, generation } = await ElectrumClient.connect();
    // The async connection may finish after another account has opened Realm.
    // Never read its nodes or equip them as peers for the old connection.
    if (!this.isAccountActive(originAppId) || currentBackupAccountSession() !== originBackupAccountSession) {
      return { connected: false, connectedTo: undefined, error: 'Account changed' };
    }
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
