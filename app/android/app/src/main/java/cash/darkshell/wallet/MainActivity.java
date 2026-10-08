package cash.darkshell.wallet;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaymentWatchPlugin.class);
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
