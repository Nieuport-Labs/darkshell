package cash.darkshell.wallet;

import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;

import java.util.Arrays;

/**
 * The open invoice as an NFC tag: emulates an NFC Forum Type 4 Tag (NDEF over
 * ISO-DEP) holding one URI record, the invoice's link. A phone held to this one
 * reads it like a sticker: Android opens the link (DarkShell's payment sheet),
 * or DarkShell, when it is open, shows the invoice itself.
 *
 * Answers only while an invoice is shared (NfcPlugin.share); otherwise the
 * reader sees no tag.
 */
public class InvoiceHceService extends HostApduService {
    /** NDEF message bytes being shared, or null */
    static volatile byte[] ndef;

    private static final byte[] OK = { (byte) 0x90, 0x00 };
    private static final byte[] NOT_FOUND = { 0x6A, (byte) 0x82 };
    private static final byte[] WRONG_P1P2 = { 0x6B, 0x00 };
    private static final byte[] NOT_SUPPORTED = { 0x6D, 0x00 };

    private static final byte[] NDEF_AID = { (byte) 0xD2, 0x76, 0x00, 0x00, (byte) 0x85, 0x01, 0x01 };
    private static final byte[] CC_FILE = { (byte) 0xE1, 0x03 };
    private static final byte[] NDEF_FILE = { (byte) 0xE1, 0x04 };

    /** Capability Container: mapping 2.0, read 255 bytes at a time, NDEF file E104 up to 4 KiB, read-only */
    private static final byte[] CC = {
        0x00, 0x0F, 0x20, 0x00, (byte) 0xFF, 0x00, (byte) 0xFF,
        0x04, 0x06, (byte) 0xE1, 0x04, 0x10, 0x00, 0x00, (byte) 0xFF
    };

    private byte[] selected;
    private byte[] file;

    @Override
    public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
        byte[] message = ndef;
        if (message == null || apdu == null || apdu.length < 4) return NOT_FOUND;
        int ins = apdu[1] & 0xFF;
        int p1 = apdu[2] & 0xFF;
        int p2 = apdu[3] & 0xFF;

        if (ins == 0xA4) { // SELECT
            byte[] data = apdu.length > 5 ? Arrays.copyOfRange(apdu, 5, 5 + Math.min(apdu[4] & 0xFF, apdu.length - 5)) : new byte[0];
            if (p1 == 0x04) { // by AID
                if (!Arrays.equals(data, NDEF_AID)) return NOT_FOUND;
                selected = null;
                file = null;
                return OK;
            }
            if (p1 == 0x00) { // by file id
                if (Arrays.equals(data, CC_FILE)) {
                    selected = CC_FILE;
                    file = CC;
                    return OK;
                }
                if (Arrays.equals(data, NDEF_FILE)) {
                    selected = NDEF_FILE;
                    file = new byte[message.length + 2];
                    file[0] = (byte) (message.length >> 8);
                    file[1] = (byte) message.length;
                    System.arraycopy(message, 0, file, 2, message.length);
                    return OK;
                }
                return NOT_FOUND;
            }
            return WRONG_P1P2;
        }

        if (ins == 0xB0) { // READ BINARY
            if (selected == null || file == null) return NOT_FOUND;
            int offset = (p1 << 8) | p2;
            int le = apdu.length > 4 ? apdu[apdu.length - 1] & 0xFF : 0;
            if (le == 0) le = 256;
            if (offset > file.length) return WRONG_P1P2;
            int n = Math.min(le, file.length - offset);
            byte[] out = new byte[n + 2];
            System.arraycopy(file, offset, out, 0, n);
            out[n] = (byte) 0x90;
            out[n + 1] = 0x00;
            return out;
        }

        return NOT_SUPPORTED;
    }

    @Override
    public void onDeactivated(int reason) {
        selected = null;
        file = null;
    }
}
