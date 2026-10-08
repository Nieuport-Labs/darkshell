package cash.darkshell.wallet;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Resumes payment notifications after a restart or an app update. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if ((Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) && PaymentWatchService.enabled(ctx)) {
            PaymentWatchService.start(ctx);
        }
    }
}
