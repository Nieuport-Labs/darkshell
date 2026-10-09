package cash.darkshell.wallet;

import com.getcapacitor.JSObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS side: src/lib/tor.svelte.ts. */
@CapacitorPlugin(name = "Tor")
public class TorPlugin extends Plugin {
    private final TorManager.Listener listener = (status, port) -> {
        JSObject e = new JSObject();
        e.put("status", status);
        e.put("port", port);
        notifyListeners("status", e);
    };

    @Override
    public void load() {
        TorManager.get(getContext()).addListener(listener);
    }

    @Override
    protected void handleOnDestroy() {
        TorManager.get(getContext()).removeListener(listener);
    }

    /** Turns Tor on (remembered across restarts) and routes the app through it. */
    @PluginMethod
    public void start(PluginCall call) {
        TorManager.setEnabled(getContext(), true);
        TorManager.get(getContext()).start();
        call.resolve(state());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TorManager.setEnabled(getContext(), false);
        TorManager.get(getContext()).stop();
        call.resolve(state());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    /** Asks check.torproject.org, through the app's own (proxied) HTTP, whether we look like Tor. */
    @PluginMethod
    public void check(PluginCall call) {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL("https://check.torproject.org/api/ip").openConnection();
                c.setConnectTimeout(30000);
                c.setReadTimeout(30000);
                StringBuilder b = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) b.append(line);
                }
                JSObject j = new JSObject(b.toString());
                JSObject out = new JSObject();
                out.put("isTor", j.optBoolean("IsTor", false));
                out.put("ip", j.optString("IP", ""));
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        }).start();
    }

    private JSObject state() {
        TorManager t = TorManager.get(getContext());
        JSObject r = new JSObject();
        r.put("enabled", TorManager.isEnabled(getContext()));
        r.put("status", t.status());
        r.put("port", t.port());
        return r;
    }
}
