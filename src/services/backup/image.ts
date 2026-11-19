/* eslint-disable no-await-in-loop -- Sequential work bounds memory and yields to the mobile UI. */
import cryptoJS from 'crypto-js';
import { decrypt, encrypt } from 'src/utils/service-utilities/encryption';

export type BackupImage = Record<
  'wallets' | 'signers' | 'vaults' | 'nodes' | 'labels',
  Record<string, any>
>;
export type BackupComparison = 'matched' | 'different' | 'conflict';
export const pauseBackup = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
// Conservative local guard below the relay's 50 MB body limit. Native capacity
// testing is still required; never truncate a backup to satisfy these guards.
export const MAX_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

export function canonical(value: any): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

export function recoveryContent(kind: keyof BackupImage, record: any) {
  if (kind === 'nodes') return { ...record, isConnected: false };
  if (kind !== 'wallets' && kind !== 'vaults') return record;
  // Chain caches can be rebuilt. Keep keys, derivation, counters, policies,
  // archive state and user metadata in the comparison.
  const result = { ...record };
  delete result.receivingAddress;
  delete result.accountStatus;
  const specs = { ...record.specs };
  // Manual coin-control choices cannot be reconstructed from the chain. Compare
  // them by outpoint, independent of confirmation state or UTXO/cache ordering.
  // The encrypted record still retains the original UTXOs for existing restore
  // and refresh code to reapply each choice after syncing with the node.
  const manualCoinChoices: Record<string, string> = {};
  for (const utxo of [
    ...(record.specs?.confirmedUTXOs || []),
    ...(record.specs?.unconfirmedUTXOs || []),
  ]) {
    if (utxo.isManualOverride) manualCoinChoices[`${utxo.txId}:${utxo.vout}`] = utxo.spendability;
  }
  for (const field of [
    'balances',
    'balance',
    'transactions',
    'confirmedUTXOs',
    'unconfirmedUTXOs',
    'addresses',
    'addressPubs',
    'receivingAddress',
    'hasNewUpdates',
    'lastSynched',
  ])
    delete specs[field];
  specs.manualCoinChoices = manualCoinChoices;
  return { ...result, specs };
}

function vaultSchemeIdentity(scheme: any) {
  const miniscript = scheme?.miniscriptScheme;
  const elements = miniscript?.miniscriptElements;
  if (!elements) return scheme;
  const keyIdentity = (key: any) => ({
    ...key,
    uniqueKeyIdentifier: key.uniqueKeyIdentifier ?? null,
  });
  // Realm defaults optional key identifiers to null and does not persist the
  // compiler's phase weights. Compare the compiled policy/script unchanged;
  // only then can these non-persisted weights be excluded from key identity.
  const hasCompiledPolicy = !!miniscript.miniscript && !!miniscript.miniscriptPolicy;
  return {
    ...scheme,
    miniscriptScheme: {
      ...miniscript,
      miniscriptElements: {
        ...elements,
        keysInfo: elements.keysInfo?.map(keyIdentity),
        phases: elements.phases?.map((phase: any) => {
          const normalized = {
            ...phase,
            paths: phase.paths?.map((path: any) => ({
              ...path,
              keys: path.keys?.map(keyIdentity),
            })),
          };
          if (hasCompiledPolicy) delete normalized.probability;
          return normalized;
        }),
      },
    },
  };
}

function identity(kind: keyof BackupImage, record: any) {
  if (kind === 'wallets')
    return {
      networkType: record.networkType,
      type: record.type,
      entityKind: record.entityKind,
      derivationDetails: record.derivationDetails,
      scriptType: record.scriptType,
      xpub: record.specs?.xpub,
      xpriv: record.specs?.xpriv,
      address: record.specs?.address,
      privateKey: record.specs?.privateKey,
    };
  if (kind === 'vaults')
    return {
      networkType: record.networkType,
      scheme: vaultSchemeIdentity(record.scheme),
      signers: record.signers,
      scriptType: record.scriptType,
    };
  if (kind === 'signers')
    return {
      masterFingerprint: record.masterFingerprint,
      // Realm adds empty script-type lists when a newly added signer is saved.
      // Incremental backups can contain the pre-persistence form. Empty lists
      // do not change key identity; populated lists and private keys still do.
      signerXpubs: Object.fromEntries(
        Object.entries(record.signerXpubs || {})
          .filter(([, keys]) => !Array.isArray(keys) || keys.length > 0)
          .map(([type, keys]) => [
            type,
            Array.isArray(keys)
              ? keys.map((key) => ({ ...key, xpriv: key.xpriv ?? null }))
              : keys,
          ])
      ),
      networkType: record.networkType,
      type: record.type,
    };
  return null;
}

export async function compareImages(
  local: BackupImage,
  remote: BackupImage,
  checkpoint = () => {}
): Promise<BackupComparison> {
  let result: BackupComparison = 'matched';
  for (const kind of Object.keys(local) as (keyof BackupImage)[]) {
    for (const [id, record] of Object.entries(remote[kind])) {
      checkpoint();
      const current = local[kind][id];
      // A server-only record may have been deliberately removed on this device.
      // Surface it as a difference so the user can explicitly replace the
      // backup with the current recoverable state. Never upload during a check.
      if (!current) {
        result = 'different';
        continue;
      }
      if (canonical(identity(kind, current)) !== canonical(identity(kind, record)))
        return 'conflict';
      for (const counter of [
        'nextFreeAddressIndex',
        'nextFreeChangeAddressIndex',
        'totalExternalAddresses',
      ]) {
        if ((record.specs?.[counter] || 0) > (current.specs?.[counter] || 0)) return 'conflict';
      }
    }
    for (const [id, record] of Object.entries(local[kind])) {
      checkpoint();
      if (
        !remote[kind][id] ||
        canonical(recoveryContent(kind, record)) !==
          canonical(recoveryContent(kind, remote[kind][id]))
      )
        result = 'different';
      await pauseBackup();
    }
  }
  return result;
}

// Preserve the existing CryptoJS/OpenSSL wire format. Chunk the expensive AES
// work so a large wallet does not monopolize the JS thread for the whole cipher.
export async function encryptRecord(key: string, record: any): Promise<string> {
  const text = JSON.stringify(record);
  if (text.length * 3 > MAX_RECORD_BYTES) throw new Error('Backup record exceeds supported size');
  if (text.length < 16_384) {
    await pauseBackup();
    return encrypt(key, text);
  }
  const salt = cryptoJS.lib.WordArray.random(8);
  const derived = cryptoJS.kdf.OpenSSL.execute(key, 8, 4, salt);
  const cipher = cryptoJS.algo.AES.createEncryptor(derived.key, { iv: derived.iv });
  const output = cryptoJS.lib.WordArray.create();
  for (let offset = 0; offset < text.length; ) {
    let end = Math.min(offset + 16_384, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    output.concat(cipher.process(text.slice(offset, end)));
    offset = end;
    await pauseBackup();
  }
  output.concat(cipher.finalize());
  return cryptoJS.format.OpenSSL.stringify(
    cryptoJS.lib.CipherParams.create({ ciphertext: output, salt })
  );
}

export async function decryptRecord(key: string, value: unknown) {
  if (typeof value !== 'string' || value.length > MAX_RECORD_BYTES * 2)
    throw new Error('Invalid backup record');
  // Parsing/format decoding still require native performance validation at the
  // supported size ceiling. Yield before and after each record.
  await pauseBackup();
  let text: string;
  if (value.length < 16_384) text = decrypt(key, value);
  else {
    const params = cryptoJS.format.OpenSSL.parse(value);
    if (!params.salt) throw new Error('Missing backup encryption salt');
    const derived = cryptoJS.kdf.OpenSSL.execute(key, 8, 4, params.salt);
    const decipher = cryptoJS.algo.AES.createDecryptor(derived.key, { iv: derived.iv });
    const output = cryptoJS.lib.WordArray.create();
    const data = params.ciphertext;
    for (let offset = 0; offset < data.words.length; offset += 4096) {
      const bytes = Math.min(4096 * 4, data.sigBytes - offset * 4);
      output.concat(
        decipher.process(
          cryptoJS.lib.WordArray.create(data.words.slice(offset, offset + 4096), bytes)
        )
      );
      await pauseBackup();
    }
    output.concat(decipher.finalize());
    text = output.toString(cryptoJS.enc.Utf8);
  }
  const record = JSON.parse(text);
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new Error('Invalid backup record');
  await pauseBackup();
  return record;
}

export async function decodeImage(
  key: string,
  response: any,
  appId: string,
  checkpoint = () => {}
): Promise<BackupImage> {
  const app = response?.appImage;
  if (
    !app ||
    app.appId !== appId ||
    !app.wallets ||
    !app.signers ||
    !Array.isArray(app.nodes) ||
    !Array.isArray(response.allVaultImages) ||
    !Array.isArray(response.labels)
  )
    throw new Error('Incomplete backup response');
  const checkReferences = (expected: unknown, actual: unknown[]) => {
    if (expected === undefined) return; // Legacy backups can omit reference lists.
    if (
      !Array.isArray(expected) ||
      expected.length !== actual.length ||
      new Set(expected).size !== expected.length ||
      new Set(actual).size !== actual.length ||
      actual.some((id) => typeof id !== 'string' || !expected.includes(id))
    )
      throw new Error('Incomplete backup references');
  };
  checkReferences(
    app.vaults,
    response.allVaultImages.map((record) => record?.vaultId)
  );
  checkReferences(
    app.labels,
    response.labels.map((record) => record?.id)
  );
  const image: BackupImage = { wallets: {}, signers: {}, vaults: {}, nodes: {}, labels: {} };
  let totalBytes = 0;
  const decode = async (value: unknown) => {
    checkpoint();
    if (typeof value !== 'string') throw new Error('Invalid backup record');
    totalBytes += value.length;
    if (totalBytes > MAX_BACKUP_BYTES) throw new Error('Backup exceeds supported size');
    return decryptRecord(key, value);
  };
  const add = (kind: keyof BackupImage, id: string, record: any) => {
    if (!id || image[kind][id]) throw new Error('Duplicate or unidentified backup record');
    image[kind][id] = record;
  };
  for (const value of Object.values(app.wallets)) {
    const record = await decode(value);
    add('wallets', record.id, record);
  }
  for (const [id, value] of Object.entries(app.signers)) {
    const record = await decode(value);
    add('signers', id, record);
  }
  for (const value of response.allVaultImages) {
    const record = await decode(value?.vault);
    if (value.vaultId !== undefined && value.vaultId !== record.id)
      throw new Error('Vault backup identity mismatch');
    add('vaults', record.id, record);
  }
  for (const value of app.nodes) {
    const record = await decode(value);
    add('nodes', record.id || canonical(recoveryContent('nodes', record)), record);
  }
  for (const value of response.labels) {
    const record = await decode(value?.content);
    add('labels', record.id, record);
  }
  // A partial relay response must never look like an empty backup.
  if (Array.isArray(app.vaults) && app.vaults.length !== Object.keys(image.vaults).length)
    throw new Error('Incomplete vault backup');
  if (Array.isArray(app.labels) && app.labels.length !== Object.keys(image.labels).length)
    throw new Error('Incomplete label backup');
  return image;
}
