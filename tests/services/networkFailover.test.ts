import { getFailoverPeers } from '../../src/services/electrum/peerSelection';
import {
  predefinedMainnetNodes,
  predefinedTestnetNodes,
} from '../../src/services/electrum/predefinedNodes';

describe('Electrum failover peer selection', () => {
  it('retries only the selected private node', () => {
    const privateNode = {
      ...predefinedTestnetNodes[0],
      id: 1001,
      host: 'private.example',
    };

    expect(getFailoverPeers([predefinedTestnetNodes[0], privateNode], privateNode)).toEqual([
      privateNode,
    ]);
  });

  it('uses saved public peers on the same network and never a private node', () => {
    const privateNode = {
      ...predefinedTestnetNodes[0],
      id: 1001,
      host: 'private.example',
    };
    const peers = getFailoverPeers(
      [
        predefinedMainnetNodes[0],
        predefinedTestnetNodes[1],
        privateNode,
        predefinedTestnetNodes[0],
      ],
      predefinedTestnetNodes[0]
    );

    expect(peers).toEqual(predefinedTestnetNodes);
  });

  it('does not reconnect after an explicit disconnect', () => {
    expect(getFailoverPeers(predefinedTestnetNodes, null)).toEqual([]);
  });
});
