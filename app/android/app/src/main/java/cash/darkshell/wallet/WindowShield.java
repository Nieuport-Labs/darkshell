package cash.darkshell.wallet;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * What every wallet window does to keep the seed and the PIN to itself:
 * - FLAG_SECURE: no screenshots, screen recording, casting or Recents thumbnail
 *   (the recovery phrase and the PIN pad are shown in these windows), unless
 *   the user allowed screenshots in Settings (ScreenShieldPlugin);
 * - other apps' overlays are hidden while a wallet window is in front (API 31+),
 *   and taps that arrive through an overlay are dropped, so nothing drawn over
 *   the PIN pad or the payment sheet can read or steer them.
 */
final class WindowShield {
    private static final String PREFS = "darkshell.shield";
    private static final String KEY_ALLOW = "allowCapture";

    private WindowShield() {}

    /** Call right after super.onCreate (needs the bridge's WebView). */
    static void apply(BridgeActivity a) {
        secure(a, !captureAllowed(a));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) a.getWindow().setHideOverlayWindows(true);
        a.getBridge().getWebView().setFilterTouchesWhenObscured(true);
    }

    static boolean captureAllowed(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ALLOW, false);
    }

    static void setCaptureAllowed(Context c, boolean allow) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ALLOW, allow).apply();
    }

    static void secure(Activity a, boolean on) {
        if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
