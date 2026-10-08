package cash.darkshell.wallet;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS side: src/lib/notify/background.ts. */
@CapacitorPlugin(name = "PaymentWatch")
public class PaymentWatchPlugin extends Plugin {

    /** Saves the accounts' notification seeds and (re)starts the service. */
    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        JSObject cfg = call.getData();
        ctx.getSharedPreferences(PaymentWatchService.PREFS, Context.MODE_PRIVATE).edit().putString("config", cfg.toString()).apply();
        PaymentWatchService.start(ctx);
        call.resolve();
    }

    /** Stops the service and forgets the seeds and position. */
    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(PaymentWatchService.PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        PaymentWatchService.stop(ctx);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        JSObject r = new JSObject();
        r.put("enabled", PaymentWatchService.enabled(ctx));
        r.put("unrestricted", pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        call.resolve(r);
    }

    /** Asks Android to let the service run without battery restrictions (system dialog). */
    @PluginMethod
    public void allowBackground(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
        } catch (Exception e) {
            ctx.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }
}
