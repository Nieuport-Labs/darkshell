package cash.darkshell.wallet;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;

import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * The vault's device key (JS side: src/lib/crypto/hwkey.ts). An HMAC-SHA256 key
 * made inside the Android Keystore (StrongBox when the phone has one, else the
 * TEE) that never leaves it. The vault key is HMAC(this key, Argon2id(PIN)), so
 * a copy of the app's data is useless anywhere but on this phone: guessing the
 * PIN offline, on other hardware, is no longer possible.
 *
 * Losing the key (only with the app's data) loses nothing: the recovery phrase
 * restores the wallet, exactly as after a forgotten PIN.
 */
@CapacitorPlugin(name = "VaultKey")
public class VaultKeyPlugin extends Plugin {
    private static final String TAG = "VaultKey";
    private static final String ALIAS = "darkshell.vault.device";
    private static final String STORE = "AndroidKeyStore";

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        try {
            key();
            r.put("available", true);
        } catch (Exception e) {
            Log.w(TAG, "no device key", e);
            r.put("available", false);
        }
        call.resolve(r);
    }

    /** HMAC-SHA256(device key, data); `data` and the result are base64. */
    @PluginMethod
    public void mix(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("no data");
            return;
        }
        // the Keystore call can take a moment on StrongBox: off the bridge thread
        new Thread(() -> {
            try {
                Mac mac = Mac.getInstance("HmacSHA256");
                mac.init(key());
                byte[] in = Base64.decode(data, Base64.NO_WRAP);
                byte[] out = mac.doFinal(in);
                java.util.Arrays.fill(in, (byte) 0);
                JSObject r = new JSObject();
                r.put("out", Base64.encodeToString(out, Base64.NO_WRAP));
                java.util.Arrays.fill(out, (byte) 0);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("device key failed: " + e.getMessage(), e);
            }
        }).start();
    }

    /** The existing key, or a new one (StrongBox first). */
    private static synchronized SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return generate(true);
            } catch (StrongBoxUnavailableException e) {
                /* no StrongBox: the TEE */
            }
        }
        return generate(false);
    }

    private static SecretKey generate(boolean strongBox) throws Exception {
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, STORE);
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN);
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) b.setIsStrongBoxBacked(true);
        g.init(b.build());
        return g.generateKey();
    }
}
