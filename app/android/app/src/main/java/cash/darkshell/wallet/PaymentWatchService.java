package cash.darkshell.wallet;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Incoming-payment notifications while DarkShell is closed (SNIP-52).
 *
 * One WebSocket to a public RPC node, subscribed to sSCRT executions: the node
 * pushes each one as it lands in a block (a few per minute at most), so the
 * phone sleeps in between instead of polling. Every transaction is checked
 * locally against each account's notification seed; the node only learns that
 * someone follows sSCRT. After a dropped connection the missed blocks are read
 * once over HTTP, so nothing is skipped. Android requires a visible (silent,
 * minimised) notification for a service that runs all the time.
 */
public class PaymentWatchService extends Service {
    static final String TAG = "PaymentWatch";
    static final String PREFS = "payment_watch";
    static final String SSCRT = "secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek";
    static final String CH_SERVICE = "watching";
    static final String CH_PAYMENTS = "payments";
    static final int ONGOING_ID = 1;
    /** don't catch up further back than this after a long gap (≈ 5 h of blocks) */
    static final long MAX_CATCH_UP = 3000;

    /** true while the app is on screen: it shows its own notice then */
    static volatile boolean appVisible = false;

    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        // notices a silently dead connection; the node pings on its own as well
        .pingInterval(90, TimeUnit.SECONDS)
        .build();
    private HandlerThread thread;
    private Handler handler;
    private WebSocket socket;
    private List<Snip52.Watch> watches = new ArrayList<>();
    private List<String> wsUrls = new ArrayList<>();
    private List<String> httpUrls = new ArrayList<>();
    private int urlIndex = 0;
    private long backoffMs = 2000;
    private boolean stopped = false;
    private ConnectivityManager.NetworkCallback netCallback;

    static void start(Context ctx) {
        Intent i = new Intent(ctx, PaymentWatchService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, PaymentWatchService.class));
    }

    static boolean enabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getString("config", null) != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        channels();
        Notification n = new NotificationCompat.Builder(this, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Watching for payments")
            .setContentText("You'll be told when sSCRT arrives.")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(openApp())
            .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ONGOING_ID, n);

        thread = new HandlerThread("payment-watch");
        thread.start();
        handler = new Handler(thread.getLooper());

        // reconnect at once when the phone gets a network back
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                handler.post(() -> {
                    if (socket == null && !stopped) {
                        backoffMs = 2000;
                        connect();
                    }
                });
            }
        };
        try {
            cm.registerDefaultNetworkCallback(netCallback);
        } catch (Exception e) {
            Log.w(TAG, "no network callback", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!enabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // the plugin calls start again after the accounts changed
        handler.post(() -> {
            if (socket != null) socket.close(1000, "reload");
            socket = null;
            loadAndConnect();
        });
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        try {
            getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCallback);
        } catch (Exception ignored) {}
        if (socket != null) socket.close(1000, "stop");
        thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ------------------------------------------------------------------ */

    private void loadAndConnect() {
        try {
            JSONObject cfg = new JSONObject(getSharedPreferences(PREFS, MODE_PRIVATE).getString("config", "{}"));
            List<Snip52.Watch> list = new ArrayList<>();
            JSONArray ws = cfg.optJSONArray("watches");
            for (int i = 0; ws != null && i < ws.length(); i++) {
                JSONObject w = ws.getJSONObject(i);
                JSONObject b = w.optJSONObject("bloom");
                list.add(new Snip52.Watch(
                    java.util.Base64.getDecoder().decode(w.getString("seed")),
                    w.optString("label", ""),
                    b != null ? b.optInt("m") : 0,
                    b != null ? b.optInt("k") : 0,
                    b != null ? b.optInt("packetSize") : 0));
            }
            watches = list;
            wsUrls = strings(cfg.optJSONArray("ws"));
            httpUrls = strings(cfg.optJSONArray("rpc"));
        } catch (Exception e) {
            Log.e(TAG, "bad config", e);
            stopSelf();
            return;
        }
        if (watches.isEmpty() || wsUrls.isEmpty()) {
            stopSelf();
            return;
        }
        connect();
    }

    private static List<String> strings(JSONArray a) {
        List<String> out = new ArrayList<>();
        for (int i = 0; a != null && i < a.length(); i++) out.add(a.optString(i));
        return out;
    }

    private void connect() {
        if (stopped || socket != null) return;
        String url = wsUrls.get(urlIndex % wsUrls.size());
        socket = http.newWebSocket(new Request.Builder().url(url).build(), new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                Log.i(TAG, "connected to " + url);
                String q = "tm.event='Tx' AND wasm.contract_address='" + SSCRT + "'";
                ws.send("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"subscribe\",\"params\":{\"query\":\"" + q + "\"}}");
                handler.post(() -> {
                    backoffMs = 2000;
                    catchUp();
                });
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                handler.post(() -> onEvent(text));
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                handler.post(() -> dropped(ws));
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response r) {
                Log.w(TAG, "socket failed: " + t);
                handler.post(() -> dropped(ws));
            }
        });
    }

    private void dropped(WebSocket ws) {
        if (socket != ws) return;
        socket = null;
        if (stopped) return;
        urlIndex++;
        // while no socket works, fall back to reading new blocks over HTTP at
        // the same pace as the retries (at most every 15 s)
        catchUp();
        handler.postDelayed(this::connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 15_000);
    }

    private long lastHeight() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getLong("height", 0);
    }

    private void saveHeight(long h) {
        if (h > lastHeight()) getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("height", h).apply();
    }

    /** A pushed sSCRT execution: {result: {events: {"tx.hash": [...], "wasm.snip52:…": [...]}}}. */
    private void onEvent(String text) {
        try {
            JSONObject ev = new JSONObject(text).optJSONObject("result");
            ev = ev == null ? null : ev.optJSONObject("events");
            if (ev == null) return;
            String hash = ev.getJSONArray("tx.hash").getString(0).toUpperCase();
            long height = Long.parseLong(ev.getJSONArray("tx.height").getString(0));
            Map<String, String> attrs = new HashMap<>();
            for (Iterator<String> it = ev.keys(); it.hasNext(); ) {
                String k = it.next();
                if (k.startsWith("wasm.snip52:")) attrs.put(k.substring(5), ev.getJSONArray(k).getString(0));
            }
            Log.d(TAG, "sSCRT tx " + hash.substring(0, 8) + " at " + height);
            check(hash, height, attrs);
            saveHeight(height);
        } catch (Exception e) {
            Log.w(TAG, "bad event", e);
        }
    }

    /** Reads what happened while the socket was down (once per connect). */
    private void catchUp() {
        long from = lastHeight();
        if (from == 0) return; // first run: start from now
        for (String base : httpUrls) {
            try {
                long latest = new JSONObject(get(base + "/status")).getJSONObject("result").getJSONObject("sync_info").getLong("latest_block_height");
                long after = Math.max(from, latest - MAX_CATCH_UP);
                for (int page = 1; page <= 5; page++) {
                    String q = URLEncoder.encode("\"wasm.contract_address='" + SSCRT + "' AND tx.height>" + after + "\"", "UTF-8");
                    JSONObject res = new JSONObject(get(base + "/tx_search?query=" + q + "&per_page=100&page=" + page + "&order_by=%22asc%22")).getJSONObject("result");
                    JSONArray txs = res.getJSONArray("txs");
                    for (int i = 0; i < txs.length(); i++) {
                        JSONObject t = txs.getJSONObject(i);
                        Map<String, String> attrs = new HashMap<>();
                        JSONArray events = t.getJSONObject("tx_result").getJSONArray("events");
                        for (int e = 0; e < events.length(); e++) {
                            JSONObject event = events.getJSONObject(e);
                            if (!"wasm".equals(event.optString("type"))) continue;
                            JSONArray at = event.getJSONArray("attributes");
                            for (int a = 0; a < at.length(); a++) {
                                String k = at.getJSONObject(a).optString("key");
                                if (k.startsWith("snip52:") && !attrs.containsKey(k)) attrs.put(k, at.getJSONObject(a).optString("value"));
                            }
                        }
                        check(t.getString("hash").toUpperCase(), t.getLong("height"), attrs);
                    }
                    if (page * 100 >= res.getLong("total_count")) break;
                }
                saveHeight(latest);
                return;
            } catch (Exception e) {
                Log.w(TAG, "catch-up via " + base + " failed: " + e);
            }
        }
    }

    private String get(String url) throws Exception {
        try (Response r = http.newCall(new Request.Builder().url(url).build()).execute()) {
            if (!r.isSuccessful() || r.body() == null) throw new Exception("HTTP " + r.code());
            return r.body().string();
        }
    }

    private void check(String hash, long height, Map<String, String> attrs) {
        if (attrs.isEmpty()) return;
        for (Snip52.Watch w : watches) {
            Snip52.Hit hit = Snip52.scan(hash, height, attrs, w);
            if (hit != null) {
                Log.i(TAG, "payment received in " + hash.substring(0, 8));
                notifyPayment(hit);
            }
        }
    }

    private void notifyPayment(Snip52.Hit hit) {
        if (appVisible) return;
        String title = hit.amount != null ? "+" + formatSscrt(hit.amount) + " sSCRT" : "Payment received";
        String body = hit.watch.label.isEmpty() ? "Received privately on DarkShell." : "Received privately on " + hit.watch.label + ".";
        Notification n = new NotificationCompat.Builder(this, CH_PAYMENTS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xFFFF3912)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build();
        // same id the app uses for this tx, so it never shows twice
        getSystemService(NotificationManager.class).notify(Integer.parseInt(hit.hash.substring(0, 7), 16), n);
    }

    static String formatSscrt(BigInteger base) {
        BigDecimal d = new BigDecimal(base, 6).stripTrailingZeros();
        String s = d.scale() < 0 ? d.setScale(0).toPlainString() : d.toPlainString();
        String[] parts = s.split("\\.");
        String grouped = parts[0].replaceAll("\\B(?=(\\d{3})+(?!\\d))", " ");
        return parts.length > 1 ? grouped + "." + parts[1] : grouped;
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void channels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel quiet = new NotificationChannel(CH_SERVICE, "Watching for payments", NotificationManager.IMPORTANCE_MIN);
        quiet.setDescription("The always-on connection that notices incoming payments. Silent.");
        quiet.setShowBadge(false);
        nm.createNotificationChannel(quiet);
        NotificationChannel pay = new NotificationChannel(CH_PAYMENTS, "Payments received", NotificationManager.IMPORTANCE_HIGH);
        pay.setDescription("Incoming sSCRT payments");
        pay.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(pay);
    }
}
