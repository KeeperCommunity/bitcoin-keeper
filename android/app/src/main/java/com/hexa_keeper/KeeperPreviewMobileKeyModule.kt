package com.hexa_keeper

import android.util.AtomicFile
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import io.hexawallet.keeper.BuildConfig
import java.io.File
import java.io.RandomAccessFile
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties

/** A device-only seed store available exclusively in the separate testnet preview app. */
class KeeperPreviewMobileKeyModule(
    private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
    override fun getName() = "KeeperPreviewMobileKey"

    @ReactMethod
    fun getOrCreateSeedBase64(promise: Promise) {
        if (!BuildConfig.IS_RECOVERABLE_PREVIEW || context.packageName != PREVIEW_PACKAGE) {
            promise.reject("PREVIEW_ONLY", "Mobile Key requires the testnet preview app")
            return
        }

        try {
            // The monitor protects threads; the file lock protects a second app process.
            val encoded = synchronized(processLock) {
                val directory = context.noBackupFilesDir
                if (!directory.isDirectory) throw IllegalStateException("No-backup storage unavailable")
                RandomAccessFile(File(directory, LOCK_FILE), "rw").use { lockFile ->
                    lockFile.channel.use { channel ->
                        channel.lock().use { getOrCreateLocked(directory) }
                    }
                }
            }
            promise.resolve(encoded)
        } catch (_: Exception) {
            // Never replace an unreadable, corrupted, or inaccessible existing key.
            promise.reject("MOBILE_KEY_STORAGE_UNAVAILABLE", "Mobile Key secure storage is unavailable")
        }
    }

    private fun getOrCreateLocked(directory: File): String {
        val seedFile = File(directory, SEED_FILE)
        val atomicFile = AtomicFile(seedFile)
        // A lone .new file is an interrupted AtomicFile write, not an empty store.
        // Never replace a possible prior seed after a crash.
        val hasAnyRecord = seedFile.exists() ||
            File(seedFile.path + ".bak").exists() || File(seedFile.path + ".new").exists()
        val key = getOrCreateEncryptionKey(hasAnyRecord)

        if (hasAnyRecord) {
            val seed = decrypt(atomicFile.readFully(), key)
            return try {
                Base64.encodeToString(seed, Base64.NO_WRAP)
            } finally {
                seed.fill(0)
            }
        }

        val seed = ByteArray(SEED_LENGTH)
        SecureRandom().nextBytes(seed)
        try {
            val ciphertext = encrypt(seed, key)
            val stream = atomicFile.startWrite()
            try {
                stream.write(ciphertext)
                atomicFile.finishWrite(stream)
            } catch (error: Exception) {
                atomicFile.failWrite(stream)
                throw error
            }

            // Do not expose a newly generated seed unless durable storage reads it back.
            val readback = decrypt(atomicFile.readFully(), key)
            return try {
                if (!MessageDigest.isEqual(seed, readback)) {
                    throw IllegalStateException("Mobile Key readback differs")
                }
                Base64.encodeToString(seed, Base64.NO_WRAP)
            } finally {
                readback.fill(0)
            }
        } finally {
            seed.fill(0)
        }
    }

    private fun getOrCreateEncryptionKey(recordExists: Boolean): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val existing = keyStore.getKey(KEY_ALIAS, null)
        if (existing != null) {
            // The alias can precede the first durable seed write. A crash in
            // that window is ambiguous, so require a manual preview reset.
            if (!recordExists) throw IllegalStateException("Mobile Key record is missing")
            return existing as? SecretKey
                ?: throw IllegalStateException("Mobile Key encryption key is invalid")
        }
        if (recordExists || keyStore.containsAlias(KEY_ALIAS)) {
            throw IllegalStateException("Mobile Key encryption key is missing")
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(seed: ByteArray, key: SecretKey): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(PREVIEW_PACKAGE.toByteArray(Charsets.UTF_8))
        val iv = cipher.iv
        if (iv.size != IV_LENGTH) throw IllegalStateException("Invalid Mobile Key nonce")
        val encrypted = cipher.doFinal(seed)
        return byteArrayOf(RECORD_VERSION) + iv + encrypted
    }

    private fun decrypt(record: ByteArray, key: SecretKey): ByteArray {
        if (record.size != 1 + IV_LENGTH + SEED_LENGTH + TAG_LENGTH ||
            record[0] != RECORD_VERSION
        ) {
            throw IllegalStateException("Invalid Mobile Key record")
        }
        val iv = record.copyOfRange(1, 1 + IV_LENGTH)
        val encrypted = record.copyOfRange(1 + IV_LENGTH, record.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        cipher.updateAAD(PREVIEW_PACKAGE.toByteArray(Charsets.UTF_8))
        val seed = cipher.doFinal(encrypted)
        if (seed.size != SEED_LENGTH) throw IllegalStateException("Invalid Mobile Key seed")
        return seed
    }

    private companion object {
        const val PREVIEW_PACKAGE = "io.hexawallet.keeper.recoverablepreview"
        const val KEY_ALIAS = "$PREVIEW_PACKAGE.mobile-key.v1"
        const val SEED_FILE = "keeper-preview-mobile-key-v1.bin"
        const val LOCK_FILE = "keeper-preview-mobile-key-v1.lock"
        const val SEED_LENGTH = 32
        const val IV_LENGTH = 12
        const val TAG_LENGTH = 16
        const val RECORD_VERSION: Byte = 1
        val processLock = Any()
    }
}
