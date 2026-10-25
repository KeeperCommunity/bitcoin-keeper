package com.asterinet.react.tcpsocket;

import com.facebook.react.bridge.*;
import java.nio.file.*;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.util.*;
import javax.net.ssl.*;

// Executes the dependency's real connect/startTLS and certificate helper. Only
// resource/bridge/event APIs are stubbed; JDK TLS is not Android TLS execution.
public final class NativeTlsProbe {
    static final class Options extends HashMap<String, Object> implements WritableMap {
        public boolean hasKey(String k) { return containsKey(k); }
        public String getString(String k) { return (String)get(k); }
        public boolean getBoolean(String k) { return (Boolean)get(k); }
        public int getInt(String k) { return (Integer)get(k); }
        public ReadableArray getArray(String k) { return (ReadableArray)get(k); }
        public void putString(String k, String v) { put(k, v); }
        public void putBoolean(String k, boolean v) { put(k, v); }
        public void putInt(String k, int v) { put(k, v); }
        public void putMap(String k, ReadableMap v) { put(k, v); }
    }
    static final class Probe extends TcpSocketClient {
        Probe() { super(new TcpEventListener(), 1, null); }
        public void startListening() {} // Event delivery is outside this TLS proof.
    }
    public static void main(String[] args) throws Exception {
        KeyStore roots = KeyStore.getInstance(KeyStore.getDefaultType());
        roots.load(null, null);
        try (java.io.InputStream in = Files.newInputStream(Path.of(args[0]))) {
            roots.setCertificateEntry("fixture", CertificateFactory.getInstance("X.509").generateCertificate(in));
        }
        java.security.cert.X509Certificate policyCertificate = null;
        if (args[3].equals("policy") || args[3].equals("filter") || args[3].equals("explicit")) {
            try (java.io.InputStream in = Files.newInputStream(Path.of(args[2]))) {
                policyCertificate = (java.security.cert.X509Certificate)CertificateFactory.getInstance("X.509").generateCertificate(in);
                if (!args[3].equals("policy")) roots.setCertificateEntry("withdrawn", policyCertificate);
            }
        }
        Path store = Path.of(args[0]).resolveSibling("fixture-store");
        try (java.io.OutputStream out = Files.newOutputStream(store)) { roots.store(out, "fixture".toCharArray()); }
        System.setProperty("javax.net.ssl.trustStore", store.toString());
        System.setProperty("javax.net.ssl.trustStorePassword", "fixture");
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(roots);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, tmf.getTrustManagers(), null);
        SSLContext.setDefault(context); // Disposable test-process trust only.
        if (policyCertificate != null) {
            Class<?> policy = Class.forName("com.asterinet.react.tcpsocket.KeeperTrustPolicy");
            try {
                if (args[3].equals("policy")) {
                    policy.getDeclaredMethod("checkCertificate", java.security.cert.X509Certificate.class).invoke(null, policyCertificate);
                } else if (args[3].equals("explicit")) {
                    policy.getDeclaredMethod("trustManagers", KeyStore.class).invoke(null, roots);
                } else {
                    TrustManager[] filtered = (TrustManager[])policy.getDeclaredMethod("trustManagers", KeyStore.class).invoke(null, (Object)null);
                    int retained = 0;
                    for (TrustManager manager : filtered) if (manager instanceof X509TrustManager) {
                        for (java.security.cert.X509Certificate cert : ((X509TrustManager)manager).getAcceptedIssuers()) {
                            if (cert.equals(policyCertificate)) throw new AssertionError("Withdrawn system root retained");
                            if (cert.equals(roots.getCertificate("fixture"))) retained++;
                        }
                    }
                    if (retained != 1) throw new AssertionError("Supported system root lost");
                }
                System.out.println("ACCEPT");
            } catch (java.lang.reflect.InvocationTargetException error) {
                System.out.println("REJECT " + error.getCause().getMessage()); System.exit(2);
            }
            return;
        }
        Options options = new Options(), tls = new Options();
        options.put("connectTimeout", 3000);
        tls.put("rejectUnauthorized", !args[3].equals("legacy"));
        tls.put("host", "localhost");
        if (!args[2].equals("none")) tls.put("ca", Files.readString(Path.of(args[2])));
        Probe client = new Probe();
        try {
            if (args[3].equals("upgrade")) {
                client.connect(null, "localhost", Integer.valueOf(args[1]), options, null, null);
                client.startTLS(null, tls);
            } else {
                client.connect(null, "localhost", Integer.valueOf(args[1]), options, null, tls);
            }
            System.out.println("ACCEPT");
        } catch (Exception error) {
            System.out.println("REJECT " + error.getClass().getSimpleName());
            System.exit(2);
        } finally { client.destroy(); }
    }
}
