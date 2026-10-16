import { NodeDetail } from 'src/services/wallets/interfaces';
import { NetworkType } from '../wallets/enums';

export const predefinedTestnetNodes: NodeDetail[] = [
  {
    id: 336,
    host: 'blackie.c3-soft.com',
    port: '57010',
    isConnected: true,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.TESTNET,
  },
  {
    id: 337,
    host: 'bitcoin.stagemole.eu',
    port: '5010',
    isConnected: false,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.TESTNET,
  },
];

export const predefinedMainnetNodes: NodeDetail[] = [
  {
    id: 442,
    host: 'electrum.emzy.de',
    port: '50002',
    isConnected: true,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.MAINNET,
  },
  {
    id: 443,
    host: 'electrum.bitaroo.net',
    port: '50002',
    isConnected: false,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.MAINNET,
  },
  {
    id: 446,
    host: 'ecdsa.net',
    port: '110',
    isConnected: false,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.MAINNET,
  },
  {
    id: 447,
    host: 'electrum.jochen-hoenicke.de',
    port: '50006',
    isConnected: false,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.MAINNET,
  },
  {
    id: 448,
    host: 'fulcrum.sethforprivacy.com',
    port: '50002',
    isConnected: false,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.MAINNET,
  },
  {
    id: 449,
    host: 'electrum.diynodes.com',
    port: '50022',
    isConnected: false,
    useKeeperNode: false,
    useSSL: true,
    networkType: NetworkType.MAINNET,
  },
];
