import Capacitor
import CryptoKit
import Foundation
import Security

/// The vault's device key on iOS (JS side: src/lib/crypto/hwkey.ts), the
/// counterpart of VaultKeyPlugin.java on Android.
///
/// A P-256 key is made inside the Secure Enclave and never leaves it; what is
/// kept in the Keychain is only the enclave's own wrapped blob, which no other
/// device can use (and which, with ThisDeviceOnly, is not in backups).
///
/// `mix(data)` must be a fixed function of `data` that only this phone can
/// compute. The enclave does ECDH, not HMAC, so: a point is derived from
/// `data` (scalar = SHA-256 of it, times G), the enclave multiplies it by its
/// own key, and the shared secret is hashed with `data`. Same input, same
/// output; without this phone's enclave, nothing.
@objc(VaultKeyPlugin)
public class VaultKeyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VaultKeyPlugin"
    public let jsName = "VaultKey"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mix", returnType: CAPPluginReturnPromise)
    ]

    private static let account = "cash.darkshell.wallet.vault.device"
    private static let service = "cash.darkshell.wallet"
    private let queue = DispatchQueue(label: "cash.darkshell.vaultkey")

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": SecureEnclave.isAvailable])
    }

    @objc func mix(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64), !data.isEmpty else {
            call.reject("no data")
            return
        }
        queue.async {
            do {
                let key = try Self.deviceKey()
                let peer = try Self.point(for: data)
                let shared = try key.sharedSecretFromKeyAgreement(with: peer)
                var h = SHA256()
                shared.withUnsafeBytes { h.update(bufferPointer: $0) }
                h.update(data: data)
                let out = Data(h.finalize())
                call.resolve(["out": out.base64EncodedString()])
            } catch {
                call.reject("The device key could not be used: \(error.localizedDescription)")
            }
        }
    }

    /// A public point that depends only on `data`.
    private static func point(for data: Data) throws -> P256.KeyAgreement.PublicKey {
        var counter: UInt8 = 0
        while true {
            var h = SHA256()
            h.update(data: Data("darkshell/vault-peer/v1".utf8))
            h.update(data: Data([counter]))
            h.update(data: data)
            // almost every hash is a valid scalar; the rare one that isn't tries the next counter
            if let k = try? P256.KeyAgreement.PrivateKey(rawRepresentation: Data(h.finalize())) {
                return k.publicKey
            }
            counter &+= 1
            if counter == 0 { throw CocoaError(.featureUnsupported) }
        }
    }

    /// The enclave key, made on first use.
    private static func deviceKey() throws -> SecureEnclave.P256.KeyAgreement.PrivateKey {
        if let blob = load() {
            return try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blob)
        }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &error) else {
            throw error!.takeRetainedValue() as Error
        }
        let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
        try store(key.dataRepresentation)
        // another call may have stored one first: always use what is stored
        guard let stored = load() else { throw CocoaError(.fileWriteUnknown) }
        return try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: stored)
    }

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private static func load() -> Data? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    private static func store(_ blob: Data) throws {
        var q = query()
        q[kSecValueData as String] = blob
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        // never overwrite: a vault may already be sealed under the stored key
        if status != errSecSuccess && status != errSecDuplicateItem {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }
}
