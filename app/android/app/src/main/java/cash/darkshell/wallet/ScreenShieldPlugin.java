package cash.darkshell.wallet;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Settings → Screenshots (JS side: src/lib/screenshots.ts). Off by default: see WindowShield. */
@CapacitorPlugin(name = "ScreenShield")
public class ScreenShieldPlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void set(PluginCall call) {
        boolean allow = Boolean.TRUE.equals(call.getBoolean("allow", false));
        WindowShield.setCaptureAllowed(getContext(), allow);
        getActivity().runOnUiThread(() -> {
            WindowShield.secure(getActivity(), !allow);
            call.resolve(state());
        });
    }

    private JSObject state() {
        JSObject o = new JSObject();
        o.put("allow", WindowShield.captureAllowed(getContext()));
        return o;
    }
}
