package cash.darkshell.wallet;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;

import org.torproject.jni.TorService;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * Runs Tor inside the app (Guardian Project tor-android) and sends all of the
 * app's traffic through it: the WebView (ProxyController) and native HTTP
 * (system proxy properties, read by HttpURLConnection and OkHttp).
 *
 * Fail-closed: the proxy is set before Tor is up, so nothing goes out directly
 * while it connects; requests simply fail until the first circuit exists.
 */
public final class TorManager {
    private static final String TAG = "TorManager";
    static final String PREFS = "darkshell.tor";
    static final String KEY_ENABLED = "enabled";
    /** TorService's preferred HTTP tunnel port (it falls back to "auto" if taken) */
    private static final int DEFAULT_HTTP_PORT = 8118;

    public interface Listener {
        void onStatus(String status, int port);
    }

    private static TorManager instance;

    public static synchronized TorManager get(Context context) {
        if (instance == null) instance = new TorManager(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final List<Listener> listeners = new ArrayList<>();
    private String status = TorService.STATUS_OFF;
    private int port = 0;
    private boolean bound = false;
    private TorService service;

    private TorManager(Context context) {
        this.context = context;
    }

    public static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false);
    }

    public static void setEnabled(Context context, boolean on) {
        SharedPreferences.Editor e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putBoolean(KEY_ENABLED, on).apply();
    }

    public synchronized String status() {
        return status;
    }

    public synchronized int port() {
        return port;
    }

    public synchronized void addListener(Listener l) {
        listeners.add(l);
    }

    public synchronized void removeListener(Listener l) {
        listeners.remove(l);
    }

    private void emit() {
        List<Listener> copy;
        String s;
        int p;
        synchronized (this) {
            copy = new ArrayList<>(listeners);
            s = status;
            p = port;
        }
        for (Listener l : copy) {
            try {
                l.onStatus(s, p);
            } catch (Exception e) {
                Log.w(TAG, "listener", e);
            }
        }
    }

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            String s = intent.getStringExtra(TorService.EXTRA_STATUS);
            if (s != null) onStatus(s);
        }
    };

    private void onStatus(String s) {
        synchronized (this) {
            if (s.equals(status)) return;
            status = s;
            if (service != null && service.getHttpTunnelPort() > 0) port = service.getHttpTunnelPort();
        }
        if (TorService.STATUS_ON.equals(s)) applyProxy(port() > 0 ? port() : DEFAULT_HTTP_PORT);
        emit();
    }

    /** The status broadcast can be missed; ask Tor itself whether a circuit is up. */
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            TorService svc;
            synchronized (TorManager.this) {
                if (!bound || TorService.STATUS_ON.equals(status)) return;
                svc = service;
            }
            if (svc != null) {
                new Thread(() -> {
                    try {
                        String v = svc.getInfo("status/circuit-established");
                        if (v != null && v.trim().equals("1")) handler.post(() -> onStatus(TorService.STATUS_ON));
                    } catch (Exception ignored) {
                    }
                }).start();
            }
            handler.postDelayed(this, 2000);
        }
    };

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            synchronized (TorManager.this) {
                service = ((TorService.LocalBinder) binder).getService();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            synchronized (TorManager.this) {
                service = null;
                status = TorService.STATUS_OFF;
            }
            emit();
        }
    };

    /** Starts Tor (if not running) and routes the app through it. */
    public synchronized void start() {
        // fail closed from the first moment: the expected port, before Tor is listening
        applyProxy(port > 0 ? port : DEFAULT_HTTP_PORT);
        if (bound) return;
        IntentFilter f = new IntentFilter(TorService.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(statusReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        else context.registerReceiver(statusReceiver, f);
        LocalBroadcastManager.getInstance(context).registerReceiver(statusReceiver, f);
        bound = context.bindService(new Intent(context, TorService.class), connection, Context.BIND_AUTO_CREATE);
        status = TorService.STATUS_STARTING;
        handler.postDelayed(poll, 2000);
    }

    /** Stops Tor and goes back to direct connections. */
    public synchronized void stop() {
        clearProxy();
        if (bound) {
            try {
                context.unbindService(connection);
            } catch (Exception ignored) {
            }
            try {
                context.unregisterReceiver(statusReceiver);
                LocalBroadcastManager.getInstance(context).unregisterReceiver(statusReceiver);
            } catch (Exception ignored) {
            }
            handler.removeCallbacks(poll);
            context.stopService(new Intent(context, TorService.class));
        }
        bound = false;
        service = null;
        status = TorService.STATUS_OFF;
        port = 0;
        emit();
    }

    private static final Executor DIRECT = Runnable::run;

    private void applyProxy(int p) {
        String host = "127.0.0.1";
        System.setProperty("http.proxyHost", host);
        System.setProperty("http.proxyPort", Integer.toString(p));
        System.setProperty("https.proxyHost", host);
        System.setProperty("https.proxyPort", Integer.toString(p));
        System.setProperty("http.nonProxyHosts", "");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            ProxyConfig cfg = new ProxyConfig.Builder().addProxyRule("http://" + host + ":" + p).build();
            ProxyController.getInstance().setProxyOverride(cfg, DIRECT, () -> Log.i(TAG, "WebView proxy on :" + p));
        }
    }

    private void clearProxy() {
        System.clearProperty("http.proxyHost");
        System.clearProperty("http.proxyPort");
        System.clearProperty("https.proxyHost");
        System.clearProperty("https.proxyPort");
        System.clearProperty("http.nonProxyHosts");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            ProxyController.getInstance().clearProxyOverride(DIRECT, () -> Log.i(TAG, "WebView proxy off"));
        }
    }
}
