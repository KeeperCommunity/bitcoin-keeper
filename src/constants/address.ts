export const devAddress: Address = {
  settings: 'tb1q8rarxyjt9pumj8gsx770d4tmcced6ewpzjtjtp',
  assistServer: 'tb1qtp5xngklpc9d9qajeps5zwaud0g2g5hj6tpefp',
  inheritanceDoc: 'tb1qs58amjlnhk40frgtjysve0s2hmfem7zk6heps5',
  health: 'tb1qs58amjlnhk40frgtjysve0s2hmfem7zk6heps5',
  canary: 'tb1qs58amjlnhk40frgtjysve0s2hmfem7zk6heps5',
  miniscript: 'tb1q5uhyrlsc28e656smvrm94pcgltlxgu9jvqgpnz',
  serverKey: 'tb1qs58amjlnhk40frgtjysve0s2hmfem7zk6heps5',
  multiSigCreate: 'tb1qs58amjlnhk40frgtjysve0s2hmfem7zk6heps5',
  multiSigImport: 'tb1qs58amjlnhk40frgtjysve0s2hmfem7zk6heps5',
};

export const prodAddress: Address = {
  settings: 'bc1q3usznw6j7j32hrq594zshmrkueccvqaene9d84',
  assistServer: 'bc1qsmpp37ddcpz58n35ka5nq0kqva2lhkzjye0z22',
  inheritanceDoc: 'bc1qumm0fm39vz2yngx363jxgwwzpg4gms82eculd3',
  health: 'bc1qdhwpu5jua7yls6ayryart4ahtsefh6c0lek880',
  canary: 'bc1q5uqck8a6dnfpz7kejagsmfcctfgn4007y93wen',
  miniscript: 'bc1q3sjawu2asxsuqhlss5f7mwnx55g43jvsup4gz6',
  serverKey: 'bc1q7chvxphswyp7l7fuwjvtmhr9hgfa6hd0csa7qs',
  multiSigCreate: 'bc1q5hupxjdtvnxl3m9pwdkz9zvfe2f7n94ec425r0',
  multiSigImport: 'bc1qwtzgguy7epug60g3pgz9zxg5qgs8g4dexw2m0d',
};

export type Address = {
  settings: string;
  assistServer: string;
  inheritanceDoc: string;
  health: string;
  canary: string;
  miniscript: string;
  serverKey: string;
  multiSigCreate: string;
  multiSigImport: string;
};
