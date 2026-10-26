// Disposable diagnostic service only; no product secure-store or default service.
const SERVICE = 'io.hexawallet.hexakeeper.ci.retained-keychain-v1';
const USERNAME = 'CI-SYNTHETIC-NOT-A-CREDENTIAL';
const FIRST = 'CI-SYNTHETIC-KEYCHAIN-INITIAL';
const SECOND = 'CI-SYNTHETIC-KEYCHAIN-UPDATED';
const SCOPE = 'ACTUAL_RN_KEYCHAIN_DISPOSABLE_SERVICE_ONLY';
const OPTION_PROFILE = 'PRODUCTION_WHEN_UNLOCKED_SERVICE_ONLY_NO_EXPLICIT_ACCESS_GROUP_OR_STORAGE';
class ProbeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new ProbeFailure(code); };
const matches = (value, password) => value && value.service === SERVICE &&
  value.username === USERNAME && value.password === password;

async function runKeychain(Keychain) {
  let operation = 'READ_EXISTING';
  const options = { service: SERVICE };
  try {
    const before = await Keychain.getGenericPassword(options);
    if (before === false) {
      operation = 'WRITE_INITIAL';
      check(await Keychain.setGenericPassword(USERNAME, FIRST, { ...options,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED }), 'WRITE_RETURNED_FALSE');
      operation = 'VERIFY_INITIAL';
      check(matches(await Keychain.getGenericPassword(options), FIRST), 'READBACK_MISMATCH');
      return { stage: 'seeded', operation, failure_code: null, native_code: null };
    }
    check(matches(before, FIRST) || matches(before, SECOND), 'UNEXPECTED_SERVICE_ITEM');
    if (matches(before, FIRST)) {
      operation = 'UPDATE_PERSISTED';
      check(await Keychain.setGenericPassword(USERNAME, SECOND, { ...options,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED }), 'WRITE_RETURNED_FALSE');
      operation = 'VERIFY_UPDATED';
      check(matches(await Keychain.getGenericPassword(options), SECOND), 'READBACK_MISMATCH');
      return { stage: 'updated', operation, failure_code: null, native_code: null };
    }
    operation = 'DELETE_PERSISTED';
    check(await Keychain.resetGenericPassword(options) === true, 'DELETE_RETURNED_FALSE');
    operation = 'VERIFY_DELETED';
    check(await Keychain.getGenericPassword(options) === false, 'DELETE_READBACK_MISMATCH');
    return { stage: 'pass', operation, failure_code: null, native_code: null };
  } catch (error) {
    const missing = error?.code === '-34018' || error?.code === -34018;
    return { stage: 'failed', operation,
      failure_code: missing ? 'MISSING_ENTITLEMENT' : error instanceof ProbeFailure ? error.code : 'NATIVE_EXCEPTION',
      native_code: missing ? -34018 : null };
  }
}
module.exports = { runKeychain, SERVICE, USERNAME, FIRST, SECOND, SCOPE, OPTION_PROFILE };
