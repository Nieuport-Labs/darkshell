package cash.darkshell.wallet;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.util.Locale;

import com.getcapacitor.BridgeActivity;

/**
 * The payment sheet: opened by a payment link (`secret:`, a /pay/ web link) or by
 * another app (action cash.darkshell.wallet.action.PAY, for a result). A
 * translucent activity over the caller, with its own WebView running the same
 * web app in sheet mode (src/PaySheetApp.svelte, chosen through PaySheetPlugin).
 */
public class PayActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaySheetPlugin.class);
        registerPlugin(PaymentWatchPlugin.class);
        registerPlugin(TorPlugin.class);
        if (TorManager.isEnabled(this)) TorManager.get(this).start();
        super.onCreate(savedInstanceState);
        // edge to edge: the dimmed backdrop also covers the status and navigation bars
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        coverSystemBars();
        clearBackgrounds();
    }

    /**
     * Replaces the SystemBars plugin's insets handling here: the WebView is never
     * padded (so the backdrop reaches the screen edges) and the sheet keeps clear
     * of the bars through the --safe-area-inset-* CSS variables instead.
     */
    private void coverSystemBars() {
        View decor = getWindow().getDecorView();
        float density = getResources().getDisplayMetrics().density;
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            v.setPadding(0, 0, 0, keyboard ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0);
            String js = String.format(
                Locale.US,
                "document.documentElement.style.setProperty('--safe-area-inset-top','%dpx');document.documentElement.style.setProperty('--safe-area-inset-bottom','%dpx')",
                (int) (bars.top / density),
                (int) ((keyboard ? 0 : bars.bottom) / density)
            );
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
            return insets;
        });
        decor.requestApplyInsets();
    }

    @Override
    public void onResume() {
        super.onResume();
        // plugins (SystemBars) may repaint the window after start
        getBridge().getWebView().post(() -> {
            clearBackgrounds();
            getWindow().getDecorView().requestApplyInsets();
        });
    }

    /** The caller stays visible behind the sheet: nothing from the window down to the WebView paints a background. */
    private void clearBackgrounds() {
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        getWindow().getDecorView().setBackgroundColor(Color.TRANSPARENT);
        View v = getBridge().getWebView();
        v.setBackgroundColor(Color.TRANSPARENT);
        while (v.getParent() instanceof ViewGroup) {
            v = (View) v.getParent();
            v.setBackgroundColor(Color.TRANSPARENT);
        }
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(0, 0);
    }
}
