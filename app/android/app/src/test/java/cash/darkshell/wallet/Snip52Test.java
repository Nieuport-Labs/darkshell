package cash.darkshell.wallet;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.math.BigInteger;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

/** Same vectors as app/test/round4.test.ts, so Java and TypeScript agree. */
public class Snip52Test {
    static final String HASH = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";

    @Test
    public void idsMatchTheContract() {
        byte[] seed = Base64.getDecoder().decode("AHQLcr5ncTmbeG4H5iGvTI3vCV7Rh+H2gHsqCJYeW60=");
        assertEquals("L1Cf2sWpcqFPwEhN5jDwvq18gljVlUYNmAC+bWFigos=", Base64.getEncoder().encodeToString(Snip52.notificationId(seed, "recvd", HASH)));
        assertEquals("L1Cf2sWpcqFPwEhN5jDwvq18gljVlUYNmAC+bWFigos=", Base64.getEncoder().encodeToString(Snip52.notificationId(seed, "recvd", HASH.toLowerCase())));
        assertEquals("e439jfL6Qbkh9btNJd0/SFPcNYUG5zL5EXvfnLy+D+E=", Base64.getEncoder().encodeToString(Snip52.notificationId(seed, "multirecvd", HASH)));
    }

    @Test
    public void findsAndDecryptsARecvdNotification() {
        byte[] seed = Base64.getDecoder().decode("8z5yqe1vqTPLuJAhgVCaNqVttsxbQmrP+eYAlbnyQ5Q=");
        String payload = "tOAbVMKeaWIguhe95QaNHI1SBhlS9fHU+6teAdyyKkQgBDajWSSptBfZbYBkiR7bVw==";
        Map<String, String> attrs = new HashMap<>();
        attrs.put("snip52:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "x");
        attrs.put("snip52:" + Base64.getEncoder().encodeToString(Snip52.notificationId(seed, "recvd", HASH)), payload);
        Snip52.Watch w = new Snip52.Watch(seed, "", 512, 22, 16);
        Snip52.Hit hit = Snip52.scan(HASH, 27518826, attrs, w);
        assertNotNull(hit);
        assertEquals(BigInteger.valueOf(12_345_678), hit.amount);
        // a different account sees nothing
        assertNull(Snip52.scan(HASH, 27518826, attrs, new Snip52.Watch(new byte[32], "", 0, 0, 0)));
        // wrong height: still a hit, amount unknown
        assertNull(Snip52.scan(HASH, 1, attrs, w).amount);
    }

    @Test
    public void formatsLikeTheApp() {
        assertEquals("1 234.56789", PaymentWatchService.formatSscrt(BigInteger.valueOf(1_234_567_890L)));
        assertEquals("1", PaymentWatchService.formatSscrt(BigInteger.valueOf(1_000_000L)));
    }
}
