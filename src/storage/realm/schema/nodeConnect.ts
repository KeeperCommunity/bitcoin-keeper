import { ObjectSchema } from 'realm';
import { RealmSchema } from '../enum';

// hosts own/private/user-provided nodes

const nodeProperties = {
  id: 'int',
  host: 'string',
  port: 'string',
  useKeeperNode: 'bool',
  isConnected: 'bool',
  useSSL: 'bool',
  tlsCa: 'string?',
  networkType: 'string',
};

export const NodeConnectSchema: ObjectSchema = {
  name: RealmSchema.NodeConnect,
  properties: nodeProperties,
};

export const DefualtNodeConnectSchema: ObjectSchema = {
  name: RealmSchema.DefaultNodeConnect,
  properties: nodeProperties,
};
