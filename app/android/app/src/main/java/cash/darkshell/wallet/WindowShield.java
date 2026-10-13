package cash.darkshell.wallet;

import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * What every wallet window does to keep the seed and the PIN to itself:
 * - FLAG_SECURE: no screenshots, screen recording, casting or Recents thumbnail
 *   (the recovery phrase and the PIN pad are shown in these windows);
 * - other apps' overlays are hidden while a wallet window is in front (API 31+),
 *   and taps that arrive through an overlay are dropped, so nothing drawn over
 *   the PIN pad or the payment sheet can read or steer them.
 */
final class WindowShield {
    private WindowShield() {}

    /** Call right after super.onCreate (needs the bridge's WebView). */
    static void apply(BridgeActivity a) {
        a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) a.getWindow().setHideOverlayWindows(true);
        a.getBridge().getWebView().setFilterTouchesWhenObscured(true);
    }
}
