package cash.darkshell.wallet;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaymentWatchPlugin.class);
        registerPlugin(TorPlugin.class);
        // with Tor on, route everything through it before the WebView loads anything
        if (TorManager.isEnabled(this)) TorManager.get(this).start();
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        PaymentWatchService.appVisible = true;
    }

    @Override
    public void onPause() {
        PaymentWatchService.appVisible = false;
        super.onPause();
    }
}
