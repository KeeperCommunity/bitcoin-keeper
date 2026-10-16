import { NodeDetail } from 'src/services/wallets/interfaces';
import { NetworkType } from 'src/services/wallets/enums';
import { predefinedMainnetNodes, predefinedTestnetNodes } from './predefinedNodes';

const isPredefinedNode = (node: NodeDetail): boolean => {
  const predefinedNodes =
    node.networkType === NetworkType.TESTNET ? predefinedTestnetNodes : predefinedMainnetNodes;

  return predefinedNodes.some(
    (candidate) =>
      candidate.id === node.id &&
      candidate.host === node.host &&
      candidate.port === node.port &&
      candidate.useSSL === node.useSSL
  );
};

/** Only a selected public server may fail over to other saved public servers. */
export const getFailoverPeers = (nodes: NodeDetail[], selectedPeer: NodeDetail): NodeDetail[] => {
  if (!selectedPeer) return [];
  if (!isPredefinedNode(selectedPeer)) return [selectedPeer];

  return [
    selectedPeer,
    ...nodes.filter(
      (node) =>
        node.networkType === selectedPeer.networkType &&
        node.id !== selectedPeer.id &&
        isPredefinedNode(node)
    ),
  ];
};
