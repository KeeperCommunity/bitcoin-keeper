import { changesBackedUpRecovery, isBackedUpSchema } from 'src/services/backup/localMutation';
import { RealmSchema } from './enum';
import realm from './realm';
import type { RecoveryCommitObserver } from './realm';

let recoveryMutationObserver: () => void = () => undefined;
const setRecoveryMutationObserver = (observer: () => void) => {
  recoveryMutationObserver = observer;
};
const setRecoveryCommitObserver = (observer: RecoveryCommitObserver) =>
  realm.setRecoveryCommitObserver(observer);
const notifyRecoveryCreateOrDelete = (schema: RealmSchema, hasObject: boolean) => {
  if (hasObject && isBackedUpSchema(schema)) recoveryMutationObserver();
};
const notifyRecoveryUpdate = (schema: RealmSchema, object: any, updateProps: any) => {
  if (changesBackedUpRecovery(schema, object, updateProps)) recoveryMutationObserver();
};

/**
 * intializes realm
 * @param  {ArrayBuffer|ArrayBufferView|Int8Array} key
 * @returns Promise
 */
const initializeRealm = async (
  key: ArrayBuffer | ArrayBufferView | Int8Array,
  path: string
): Promise<{ success: boolean; error?: string }> => {
  console.log('[Realm]: Database initialising...');
  return realm.initializeDatabase(key, path);
};

/**
 * delete realm
 * @returns Promise
 */
const deleteRealm = (key: ArrayBuffer | ArrayBufferView | Int8Array) => realm.deleteDatabase(key);

/**
 * generic :: creates an object corresponding to provided schema
 * @param  {RealmSchema} schema
 * @param  {any} object
 */
const createObject = (schema: RealmSchema, object: any, updateMode = Realm.UpdateMode.All) => {
  try {
    notifyRecoveryCreateOrDelete(schema, !!object);
    const hasCreated = realm.create(schema, object, updateMode);
    return hasCreated;
  } catch (err) {
    console.log(err);
    return false;
  }
};

/**
 * generic :: creates objects corresponding to provided schema
 * @param  {RealmSchema} schema
 * @param  {any[]} objects
 */
const createObjectBulk = (
  schema: RealmSchema,
  objects: any[],
  updateMode = Realm.UpdateMode.All
) => {
  try {
    notifyRecoveryCreateOrDelete(schema, !!objects?.length);
    const hasCreated = realm.createBulk(schema, objects, updateMode);
    return hasCreated;
  } catch (err) {
    console.log(err);
    return false;
  }
};

/**
 * generic :: fetches an object corresponding to provided schema and the supplied instance num
 * @param  {RealmSchema} schema
 */
const getObjectByIndex = (schema: RealmSchema, index: number = 0, all: boolean = false) => {
  const objects = realm.get(schema);
  if (all) return objects;
  return objects[index];
};

/**
 * generic :: fetches an object corresponding to provided schema and the supplied id
 * @param  {RealmSchema} schema
 * @param  {string} id
 */
const getObjectById = (schema: RealmSchema, id: string) => {
  const objects = realm.get(schema);
  if (
    objects.length > 0 &&
    typeof objects[0].toJSON()['id'] == 'number' &&
    parseInt(id).toString() === id
  ) {
    return objects.filtered(`id == $0`, parseInt(id))[0];
  }
  return objects.filtered(`id == $0`, id)[0];
};

/**
 * generic :: fetches an object corresponding to provided schema and the supplied id
 * @param  {RealmSchema} schema
 * @param  {string} id
 */
const getObjectByPrimaryId = (schema: RealmSchema, name: string, primaryId: string) => {
  const objects = realm.get(schema);
  if (
    objects.length > 0 &&
    typeof objects[0].toJSON()[name] == 'number' &&
    parseInt(primaryId).toString() === primaryId
  ) {
    return objects.filtered(`${name} == $0`, parseInt(primaryId))[0];
  }
  return objects.filtered(`${name} == $0`, primaryId)[0];
};

/**
 * generic :: updates the object, corresponding to provided schema and id, w/ supplied props
 * @param  {RealmSchema} schema
 * @param  {string} id
 * @param  {any} updateProps
 */
const updateObjectById = (schema: RealmSchema, id: string, updateProps: any) => {
  try {
    const object = getObjectById(schema, id);
    notifyRecoveryUpdate(schema, object, updateProps);
    realm.write(() => {
      for (const [key, value] of Object.entries(updateProps)) {
        object[key] = value;
      }
    });
    return true;
  } catch (err) {
    console.error({ err });
    return false;
  }
};

/**
 * generic :: updates the object, corresponding to provided schema and id, w/ supplied props
 * @param  {RealmSchema} schema
 * @param  {string} id
 * @param  {any} updateProps
 */
const updateObjectByPrimaryId = (
  schema: RealmSchema,
  name: string,
  primaryId: string,
  updateProps: any
) => {
  try {
    const object = getObjectByPrimaryId(schema, name, primaryId);
    notifyRecoveryUpdate(schema, object, updateProps);
    realm.write(() => {
      for (const [key, value] of Object.entries(updateProps)) {
        object[key] = value;
      }
    });
    return true;
  } catch (err) {
    console.error({ err });
    return false;
  }
};

/**
 * generic :: fetched the object corresponding to the fieldName and Value
 * @param  {RealmSchema} schema
 * @param  {any} value
 * @param  {string} fieldName
 */
const getObjectByField = (schema: RealmSchema, value: string, fieldName: string) => {
  const objects = realm.get(schema);
  if (
    objects.length > 0 &&
    typeof objects[0].toJSON()[fieldName] == 'number' &&
    parseInt(value).toString() === value
  ) {
    return objects.filtered(`${fieldName} == $0`, parseInt(value))[0];
  }
  return objects.filtered(`${fieldName} == $0`, value);
};

/**
 * generic :: fetches an object corresponding to provided schema and the supplied id
 * @param  {RealmSchema} schema
 */
const getCollection = (schema: RealmSchema) => {
  const objects = realm.get(schema);
  return objects.toJSON();
};

/**
 * generic :: deletes an object corresponding to provided schema and the supplied id
 * @param  {RealmSchema} schema
 */
const deleteObjectById = (schema: RealmSchema, id: string) => {
  try {
    const object = getObjectById(schema, id);
    notifyRecoveryCreateOrDelete(schema, !!object);
    realm.delete(object);
    return true;
  } catch (err) {
    console.error({ err });
    return false;
  }
};

/**
 * generic :: deletes an object corresponding to provided schema and the supplied primary key
 * @param  {RealmSchema} schema
 */
const deleteObjectByPrimaryKey = (schema: RealmSchema, key: string, value: any) => {
  try {
    const object = getObjectByPrimaryId(schema, key, value);
    notifyRecoveryCreateOrDelete(schema, !!object);
    realm.delete(object);
    return true;
  } catch (err) {
    console.error({ err });
    return false;
  }
};

/**
 * generic :: updates the object corresponding to provided schema and query function
 * @param  {RealmSchema} schema
 * @param  {Function} queryFn
 * @param  {any} updateProps
 */
const updateObjectByQuery = (
  schema: RealmSchema,
  queryFn: (obj: any) => boolean,
  updateProps: any
) => {
  try {
    const objects = realm.get(schema);
    const object = objects.find(queryFn);
    if (object) {
      notifyRecoveryUpdate(schema, object, updateProps);
      realm.write(() => {
        for (const [key, value] of Object.entries(updateProps)) {
          object[key] = value;
        }
      });
      return true;
    }
    return false;
  } catch (err) {
    console.error({ err });
    return false;
  }
};

/**
 * generic :: fetches an object corresponding to provided schema and query function
 * @param  {RealmSchema} schema
 * @param  {Function} queryFn
 * @param  {boolean} all whether to return all matching objects or just the first one
 */
const getObjectByQuery = (
  schema: RealmSchema,
  queryFn: (obj: any) => boolean,
  all: boolean = false
) => {
  try {
    const objects = realm.get(schema);
    if (all) {
      return objects.filter(queryFn);
    }
    return objects.find(queryFn);
  } catch (err) {
    console.error({ err });
    return null;
  }
};

export default {
  initializeRealm,
  deleteRealm,
  deleteObjectById,
  deleteObjectByPrimaryKey,
  createObjectBulk,
  createObject,
  getObjectByIndex,
  getObjectById,
  getObjectByPrimaryId,
  updateObjectById,
  updateObjectByPrimaryId,
  getCollection,
  getObjectByField,
  updateObjectByQuery,
  getObjectByQuery,
  setRecoveryMutationObserver,
  setRecoveryCommitObserver,
};
