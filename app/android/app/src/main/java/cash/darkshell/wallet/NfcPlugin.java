package cash.darkshell.wallet;

import android.app.Activity;
import android.content.ComponentName;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.cardemulation.CardEmulation;
import android.nfc.tech.Ndef;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * NFC for invoices (JS side: src/lib/nfc.ts).
 *
 * - share: while an invoice is open, this phone is an NFC tag with its link
 *   (InvoiceHceService). Reading is off meanwhile, and on Android 15+ so is the
 *   phone's own polling, so two phones don't both try to read.
 * - read: while DarkShell is open (and not sharing), a sticker or a phone that
 *   is sharing is read here, and the link goes to the app (the full invoice)
 *   instead of the system (which would open the payment sheet).
 */
@CapacitorPlugin(name = "Nfc")
public class NfcPlugin extends Plugin {
    private boolean reading;
    private boolean sharing;

    private NfcAdapter adapter() {
        return NfcAdapter.getDefaultAdapter(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        NfcAdapter a = adapter();
        JSObject r = new JSObject();
        r.put("available", a != null);
        r.put("enabled", a != null && a.isEnabled());
        r.put("hce", getContext().getPackageManager().hasSystemFeature("android.hardware.nfc.hce"));
        call.resolve(r);
    }

    @PluginMethod
    public void share(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("no url");
            return;
        }
        InvoiceHceService.ndef = new NdefMessage(NdefRecord.createUri(Uri.parse(url))).toByteArray();
        sharing = true;
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            stopReader(a);
            listenOnly(a, true);
            preferUs(a, true);
        });
        call.resolve();
    }

    @PluginMethod
    public void stopShare(PluginCall call) {
        InvoiceHceService.ndef = null;
        sharing = false;
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            listenOnly(a, false);
            preferUs(a, false);
            if (reading) startReader(a);
        });
        call.resolve();
    }

    @PluginMethod
    public void startReading(PluginCall call) {
        reading = true;
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            if (!sharing) startReader(a);
        });
        call.resolve();
    }

    @PluginMethod
    public void stopReading(PluginCall call) {
        reading = false;
        Activity a = getActivity();
        a.runOnUiThread(() -> stopReader(a));
        call.resolve();
    }

    @Override
    protected void handleOnResume() {
        Activity a = getActivity();
        if (sharing) {
            listenOnly(a, true);
            preferUs(a, true);
        } else if (reading) startReader(a);
    }

    @Override
    protected void handleOnPause() {
        Activity a = getActivity();
        stopReader(a);
        listenOnly(a, false);
        preferUs(a, false);
    }

    private void startReader(Activity a) {
        NfcAdapter nfc = adapter();
        if (nfc == null || !nfc.isEnabled()) return;
        try {
            int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V;
            nfc.enableReaderMode(a, this::onTag, flags, null);
        } catch (IllegalStateException e) {
            /* not resumed: started again in handleOnResume */
        }
    }

    private void stopReader(Activity a) {
        NfcAdapter nfc = adapter();
        if (nfc == null) return;
        try {
            nfc.disableReaderMode(a);
        } catch (IllegalStateException e) {
            /* not resumed */
        }
    }

    /** Android 15+: stop polling for tags while this phone is the tag. */
    private void listenOnly(Activity a, boolean on) {
        NfcAdapter nfc = adapter();
        if (nfc == null || Build.VERSION.SDK_INT < 35) return;
        try {
            if (on) nfc.setDiscoveryTechnology(a, NfcAdapter.FLAG_READER_DISABLE, NfcAdapter.FLAG_LISTEN_KEEP);
            else nfc.resetDiscoveryTechnology(a);
        } catch (RuntimeException e) {
            /* not resumed, or not supported by this NFC controller */
        }
    }

    /** While sharing, our tag wins over other apps' services for the same (NDEF) AID. */
    private void preferUs(Activity a, boolean on) {
        NfcAdapter nfc = adapter();
        if (nfc == null) return;
        try {
            CardEmulation ce = CardEmulation.getInstance(nfc);
            if (on) ce.setPreferredService(a, new ComponentName(a, InvoiceHceService.class));
            else ce.unsetPreferredService(a);
        } catch (RuntimeException e) {
            /* no HCE */
        }
    }

    private void onTag(Tag tag) {
        Ndef ndef = Ndef.get(tag);
        if (ndef == null) return;
        try {
            ndef.connect();
            NdefMessage m = ndef.getNdefMessage();
            if (m == null) return;
            for (NdefRecord r : m.getRecords()) {
                String url = null;
                Uri uri = r.toUri();
                if (uri != null) url = uri.toString();
                else if (r.getTnf() == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(r.getType(), NdefRecord.RTD_TEXT)) {
                    byte[] p = r.getPayload();
                    int lang = p.length > 0 ? p[0] & 0x3F : 0;
                    if (p.length > 1 + lang) url = new String(p, 1 + lang, p.length - 1 - lang, StandardCharsets.UTF_8);
                }
                if (url != null && !url.isEmpty()) {
                    JSObject e = new JSObject();
                    e.put("url", url);
                    notifyListeners("read", e);
                    return;
                }
            }
        } catch (Exception e) {
            /* moved away too soon: the next tap tries again */
        } finally {
            try {
                ndef.close();
            } catch (Exception ignored) {
                /* already closed */
            }
        }
    }
}
