package cash.darkshell.wallet;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * SNIP-52 for sSCRT, the same algorithms as src/lib/notify/snip52.ts:
 * id = HMAC-SHA256(seed, "recvd:" + TXHASH); payload = ChaCha20-Poly1305 with
 * nonce = sha256(channel)[0..12] xor txhash[0..12] and aad = "height:TXHASH".
 * Batch transfers set bits in the "multirecvd" bloom filter instead.
 */
final class Snip52 {
    private Snip52() {}

    static final class Watch {
        final byte[] seed;
        final String label;
        final int bloomM, bloomK, packetSize;

        Watch(byte[] seed, String label, int bloomM, int bloomK, int packetSize) {
            this.seed = seed;
            this.label = label;
            this.bloomM = bloomM;
            this.bloomK = bloomK;
            this.packetSize = packetSize;
        }
    }

    /** A received transfer; amount is null when the payload could not be read. */
    static final class Hit {
        final Watch watch;
        final String hash;
        final BigInteger amount;

        Hit(Watch watch, String hash, BigInteger amount) {
            this.watch = watch;
            this.hash = hash;
            this.amount = amount;
        }
    }

    static byte[] notificationId(byte[] seed, String channel, String txHash) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(seed, "HmacSHA256"));
            return mac.doFinal((channel + ":" + txHash.toUpperCase()).getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] sha256(byte[] in) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(in);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] hex(String h) {
        byte[] out = new byte[h.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    /** Amount from a `recvd` payload, or null (old Android without ChaCha20, or unreadable). */
    static BigInteger decryptRecvd(byte[] seed, String txHash, long height, String payloadB64) {
        byte[] payload = Base64.getDecoder().decode(payloadB64);
        byte[] chan = sha256("recvd".getBytes(StandardCharsets.UTF_8));
        byte[] hash = hex(txHash);
        byte[] nonce = new byte[12];
        for (int i = 0; i < 12; i++) nonce[i] = (byte) (chan[i] ^ hash[i]);
        for (String h : new String[] { txHash.toUpperCase(), txHash.toLowerCase() }) {
            try {
                Cipher c = Cipher.getInstance("ChaCha20-Poly1305");
                c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(seed, "ChaCha20"), new IvParameterSpec(nonce));
                c.updateAAD((height + ":" + h).getBytes(StandardCharsets.UTF_8));
                return firstCborAmount(c.doFinal(payload));
            } catch (Exception ignored) {
                // other AAD spelling, or no ChaCha20 on this Android version
            }
        }
        return null;
    }

    /** First element of the CBOR tuple [amount, sender, memo_len]: uint or tag-2 bignum. */
    static BigInteger firstCborAmount(byte[] b) {
        int i = 0;
        if ((b[i] & 0xff) >> 5 != 4) return null; // array
        i++;
        int head = b[i++] & 0xff;
        int major = head >> 5, info = head & 31;
        if (major == 6 && info == 2) { // bignum: byte string follows
            int bs = b[i++] & 0xff;
            if (bs >> 5 != 2) return null;
            int len = bs & 31;
            if (len == 24) len = b[i++] & 0xff;
            return new BigInteger(1, Arrays.copyOfRange(b, i, i + len));
        }
        if (major != 0) return null;
        if (info < 24) return BigInteger.valueOf(info);
        int len = 1 << (info - 24);
        return new BigInteger(1, Arrays.copyOfRange(b, i, i + len));
    }

    private static boolean bloomHit(byte[] filter, byte[] id, int m, int k) {
        byte[] h = sha256(id);
        int bitsPer = 31 - Integer.numberOfLeadingZeros(m);
        for (int i = 0; i < k; i++) {
            int v = 0;
            for (int b = 0; b < bitsPer; b++) {
                int pos = i * bitsPer + b;
                v = (v << 1) | ((h[pos >> 3] >> (7 - (pos & 7))) & 1);
            }
            int idx = filter.length - 1 - (v >> 3);
            if (((filter[idx] >> (v & 7)) & 1) == 0) return false;
        }
        return true;
    }

    private static BigInteger readPacket(byte[] data, byte[] id, int packetSize) {
        int step = 8 + packetSize;
        outer:
        for (int off = 0; off + step <= data.length; off += step) {
            for (int i = 0; i < 8; i++) if (data[off + i] != id[i]) continue outer;
            if (packetSize > 24) return null;
            byte[] plain = new byte[8];
            for (int i = 0; i < 8; i++) plain[i] = (byte) (data[off + 8 + i] ^ id[8 + i]);
            return new BigInteger(1, plain).shiftRight(2);
        }
        return null;
    }

    /** Checks one transaction's wasm attributes (key → first value) against one account. */
    static Hit scan(String txHash, long height, Map<String, String> attrs, Watch w) {
        byte[] id = notificationId(w.seed, "recvd", txHash);
        String value = attrs.get("snip52:" + Base64.getEncoder().encodeToString(id));
        if (value != null) return new Hit(w, txHash, decryptRecvd(w.seed, txHash, height, value));
        String bloom = w.bloomM > 0 ? attrs.get("snip52:#multirecvd") : null;
        if (bloom != null) {
            byte[] bytes = Base64.getDecoder().decode(bloom);
            int fl = w.bloomM / 8;
            if (bytes.length < fl) return null;
            byte[] mid = notificationId(w.seed, "multirecvd", txHash);
            if (bloomHit(Arrays.copyOfRange(bytes, 0, fl), mid, w.bloomM, w.bloomK)) {
                return new Hit(w, txHash, readPacket(Arrays.copyOfRange(bytes, fl, bytes.length), mid, w.packetSize));
            }
        }
        return null;
    }
}
