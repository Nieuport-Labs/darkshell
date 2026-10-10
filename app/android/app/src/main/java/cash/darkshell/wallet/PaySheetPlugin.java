package cash.darkshell.wallet;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS side: src/lib/pay/sheet.ts. */
@CapacitorPlugin(name = "PaySheet")
public class PaySheetPlugin extends Plugin {
    public static final String ACTION_PAY = "cash.darkshell.wallet.action.PAY";

    private PayActivity sheet() {
        Activity a = getActivity();
        return a instanceof PayActivity ? (PayActivity) a : null;
    }

    /** The request this sheet was opened for; `url` is null in the main app. */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        PayActivity a = sheet();
        if (a != null) {
            Intent i = a.getIntent();
            Uri data = i.getData();
            String url = data != null ? data.toString() : i.getStringExtra("request");
            r.put("url", url);
            r.put("forResult", a.getCallingActivity() != null);
            r.put("caller", a.getCallingActivity() != null ? a.getCallingActivity().getPackageName() : null);
        } else {
            r.put("url", null);
            r.put("forResult", false);
        }
        call.resolve(r);
    }

    /** Closes the sheet; an app that asked for a result gets status, tx and id back. */
    @PluginMethod
    public void finish(PluginCall call) {
        PayActivity a = sheet();
        if (a == null) {
            call.reject("not a payment sheet");
            return;
        }
        String status = call.getString("status", "cancelled");
        Intent data = new Intent();
        data.putExtra("status", status);
        if (call.getString("tx") != null) data.putExtra("tx", call.getString("tx"));
        if (call.getString("id") != null) data.putExtra("id", call.getString("id"));
        a.setResult("paid".equals(status) ? Activity.RESULT_OK : Activity.RESULT_CANCELED, data);
        call.resolve();
        a.runOnUiThread(a::finish);
    }

    /** Opens the payee's return URL in the browser, then closes the sheet. */
    @PluginMethod
    public void openUrl(PluginCall call) {
        PayActivity a = sheet();
        String url = call.getString("url");
        if (a == null || url == null || !(url.startsWith("https://") || url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1"))) {
            call.reject("bad url");
            return;
        }
        Intent v = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        v.addCategory(Intent.CATEGORY_BROWSABLE);
        v.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // in the browser: an invoice page (/pay/…) is a link DarkShell itself claims,
        // and would open the sheet again instead of the page
        String browser = defaultBrowser(a);
        if (browser != null) v.setPackage(browser);
        try {
            a.startActivity(v);
        } catch (ActivityNotFoundException e) {
            /* no browser: just close */
        }
        call.resolve();
        a.runOnUiThread(a::finish);
    }

    private static String defaultBrowser(Activity a) {
        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"));
        probe.addCategory(Intent.CATEGORY_BROWSABLE);
        ResolveInfo r = a.getPackageManager().resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY);
        if (r == null || r.activityInfo == null) return null;
        String pkg = r.activityInfo.packageName;
        // "android" is the chooser: no default browser set
        return "android".equals(pkg) || a.getPackageName().equals(pkg) ? null : pkg;
    }

    /** Hands a request the sheet can't show (no amount, Lightning, …) to the full app. */
    @PluginMethod
    public void openInApp(PluginCall call) {
        PayActivity a = sheet();
        String url = call.getString("url");
        if (a == null) {
            call.reject("not a payment sheet");
            return;
        }
        Intent m = new Intent(a, MainActivity.class);
        m.setAction(Intent.ACTION_VIEW);
        if (url != null) m.setData(Uri.parse(url));
        m.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        a.startActivity(m);
        a.setResult(Activity.RESULT_CANCELED);
        call.resolve();
        a.runOnUiThread(a::finish);
    }
}
