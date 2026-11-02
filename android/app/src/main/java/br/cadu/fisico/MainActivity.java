package br.cadu.fisico;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.widget.Toast;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.provider.Settings;
import android.net.wifi.WifiInfo;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Casca do Cadu físico.
 *
 * Acha o agente do PC por dois caminhos, nesta ordem:
 *  1. CABO  -> http://127.0.0.1:8765 (via "adb reverse" feito pelo agente)
 *  2. WI-FI -> http://IP_DO_PC:8765 com o token de pareamento.
 *     O IP vem do "grito" UDP que o agente faz na rede (porta 8766)
 *     ou do último IP salvo. O token é recebido uma vez pelo cabo.
 * Sem PC: mostra o rosto offline e continua procurando sozinho.
 */
public class MainActivity extends Activity {

    static final int PORTA = 8765;
    static final int PORTA_BEACON = 8766;
    static final String URL_USB = "http://127.0.0.1:" + PORTA + "/";
    static final String URL_OFFLINE = "file:///android_asset/offline.html";

    private WebView web;
    private SharedPreferences prefs;
    private volatile boolean conectado = false;
    private volatile String ipBeacon = null;
    private volatile String urlAtual = null;
    private volatile boolean carregou = true;
    private volatile boolean vivo = true;
    private volatile DatagramSocket sockBeacon;
    private volatile long desde = 0;
    private WifiManager.MulticastLock trava;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("cadu", MODE_PRIVATE);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.addJavascriptInterface(new Ponte(), "Cadu");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                android.util.Log.i("cadu", "página aberta: " + (url == null ? "" : url.replaceAll("t=.*", "t=***")));
                if (url != null && !url.startsWith("file:")) carregou = true;
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String desc, String url) {
                // PC desligado / cabo solto / Wi-Fi caiu -> rosto offline e volta a procurar
                android.util.Log.w("cadu", "pagina falhou " + code + " " + desc + " " + url);
                if (url != null && !url.startsWith("file:")) { diag = "página: " + desc; irOffline(); }
            }
        });

        setContentView(web);
        telaCheia();
        travarSeForDono();
        web.loadUrl(URL_OFFLINE);

        escutarBeacon();
        procurarPC();
        if (prefs.getBoolean("voz", true)) OuvidoService.ligar(this, true);  // Fase 2: agenda por voz
    }

    // ------------------------------------------------------------------ conexão
    /** Devolve o brilho ao controle do Android (a barra de brilho volta a funcionar). */
    private void brilhoNormal() {
        runOnUiThread(new Runnable() { public void run() {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            if (lp.screenBrightness != WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE) {
                lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                getWindow().setAttributes(lp);
            }
        } });
    }

    @Override
    protected void onDestroy() {
        vivo = false;  // as buscas desta tela param (se a tela for recriada, a nova assume)
        try { if (sockBeacon != null) sockBeacon.close(); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        brilhoNormal();  // ao voltar para o app (ex.: depois de mexer na barra de brilho), nunca fica preso no escuro
    }

    private void irOffline() {
        brilhoNormal();
        conectado = false;
        urlAtual = null;
        runOnUiThread(new Runnable() {
            public void run() { web.loadUrl(URL_OFFLINE); }
        });
    }

    /** Loop em segundo plano: enquanto desconectado, testa cabo e depois Wi-Fi. */
    private void procurarPC() {
        Thread t = new Thread(new Runnable() {
            public void run() {
                while (vivo) {
                    if (!conectado) {
                        final String url = acharAgente();
                        if (url != null) {
                            android.util.Log.i("cadu", "conectando " + url.replaceAll("t=.*", "t=***"));
                            carregou = false;
                            desde = System.currentTimeMillis();
                            conectado = true;
                            urlAtual = url;
                            runOnUiThread(new Runnable() {
                                public void run() { web.loadUrl(url); }
                            });
                        }
                    }
                    else if (!carregou && System.currentTimeMillis() - desde > 20000) {
                        android.util.Log.w("cadu", "a tela do PC não abriu em 20 s — tentando de novo");
                        diag = "a tela do PC não abriu (tentando de novo)";
                        conectado = false;
                    }
                    dormir(3000);
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    private String acharAgente() {
        if (ping("http://127.0.0.1:" + PORTA + "/api/ping")) return URL_USB;
        String token = prefs.getString("token", null);
        if (token == null) return null;  // ainda não pareado pelo cabo
        String[] candidatos = {ipBeacon, prefs.getString("ip", null), null};
        // nem o "grito" nem o último IP responderam: varre a rede atual (qualquer Wi-Fi), no máx. 1x a cada 20 s
        if (ipBeacon == null || !ping("http://" + ipBeacon + ":" + PORTA + "/api/ping")) {
            String salvo = prefs.getString("ip", null);
            if ((salvo == null || !ping("http://" + salvo + ":" + PORTA + "/api/ping"))
                    && System.currentTimeMillis() - ultimaVarredura > 20000) {
                ultimaVarredura = System.currentTimeMillis();
                candidatos[2] = varrerRede();
            }
        }
        for (String ip : candidatos) {
            if (ip != null && ping("http://" + ip + ":" + PORTA + "/api/ping")) {
                prefs.edit().putString("ip", ip).apply();
                if (codigoHttp("http://" + ip + ":" + PORTA + "/api/prefs?t=" + token) == 403) {
                    // o PC trocou o token: esquece o pareamento para a tela offline mostrar "Parear"
                    prefs.edit().remove("token").apply();
                    diag = "pareamento vencido — toque em Parear";
                    return null;
                }
                return "http://" + ip + ":" + PORTA + "/?t=" + token;
            }
        }
        return null;
    }

    static volatile String diag = "";
    private volatile long ultimaVarredura = 0;

    /** Procura o PC em todos os 254 endereços da rede do celular (porta 8765 + resposta "cadu"). */
    private String varrerRede() {
        int meu;
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            meu = wm == null ? 0 : wm.getConnectionInfo().getIpAddress();
        } catch (Exception e) { meu = 0; }
        if (meu == 0) { meu = ipDoHotspot(); }   // celular roteando (PC no hotspot do celular)
        if (meu == 0) return null;
        final String base = (meu & 0xff) + "." + ((meu >> 8) & 0xff) + "." + ((meu >> 16) & 0xff) + ".";
        final int eu = (meu >> 24) & 0xff;
        diag = "procurando o PC na rede " + base + "x";
        android.util.Log.i("cadu", diag);
        final String[] achou = {null};
        final java.util.concurrent.atomic.AtomicInteger prox = new java.util.concurrent.atomic.AtomicInteger(1);
        Thread[] ts = new Thread[24];
        for (int k = 0; k < ts.length; k++) {
            ts[k] = new Thread(new Runnable() { public void run() {
                int n;
                while (achou[0] == null && (n = prox.getAndIncrement()) < 255) {
                    if (n == eu) continue;
                    java.net.Socket so = new java.net.Socket();
                    try {
                        so.connect(new java.net.InetSocketAddress(base + n, PORTA), 350);
                        so.close();
                        if (eCadu(base + n)) { synchronized (achou) { if (achou[0] == null) achou[0] = base + n; } }
                    } catch (Exception ignored) {
                        try { so.close(); } catch (Exception ignored2) { }
                    }
                }
            } });
            ts[k].setDaemon(true);
            ts[k].start();
        }
        for (Thread t : ts) { try { t.join(8000); } catch (InterruptedException ignored) { } }
        diag = achou[0] != null ? "PC achado na rede: " + achou[0] : "PC não encontrado na rede " + base + "x";
        android.util.Log.i("cadu", diag);
        return achou[0];
    }

    /** IP do próprio celular quando ele é o roteador (hotspot), ex.: 192.168.43.1. */
    private static int ipDoHotspot() {
        try {
            java.util.Enumeration<java.net.NetworkInterface> it = java.net.NetworkInterface.getNetworkInterfaces();
            while (it != null && it.hasMoreElements()) {
                java.net.NetworkInterface ni = it.nextElement();
                String nome = ni.getName() == null ? "" : ni.getName();
                if (!ni.isUp() || ni.isLoopback() || nome.startsWith("rmnet") || nome.startsWith("ccmni") || nome.startsWith("pdp") || nome.startsWith("dummy")) continue;
                java.util.Enumeration<java.net.InetAddress> ad = ni.getInetAddresses();
                while (ad.hasMoreElements()) {
                    java.net.InetAddress a = ad.nextElement();
                    byte[] b = a.getAddress();
                    if (b.length == 4 && a.isSiteLocalAddress())
                        return (b[0] & 0xff) | ((b[1] & 0xff) << 8) | ((b[2] & 0xff) << 16) | ((b[3] & 0xff) << 24);
                }
            }
        } catch (Exception ignored) { }
        return 0;
    }

    private static boolean eCadu(String ip) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://" + ip + ":" + PORTA + "/api/ping").openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(1500); c.setReadTimeout(2000);
            if (c.getResponseCode() != 200) return false;
            byte[] b = new byte[64]; int n = c.getInputStream().read(b);
            return n > 0 && new String(b, 0, n, "UTF-8").contains("\"cadu\"");
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static int codigoHttp(String endereco) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(endereco).openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(3000); c.setReadTimeout(5000);
            return c.getResponseCode();
        } catch (Exception e) {
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static boolean ping(String endereco) {
        HttpURLConnection c = null;
        long t0 = System.currentTimeMillis();
        try {
            c = (HttpURLConnection) new URL(endereco).openConnection(java.net.Proxy.NO_PROXY);  // nunca passa por proxy
            c.setConnectTimeout(3000);
            c.setReadTimeout(5000);
            c.setUseCaches(false);
            c.setRequestProperty("Connection", "close");
            int r = c.getResponseCode();
            diag = endereco.replace("/api/ping", "") + " → " + r + " em " + (System.currentTimeMillis() - t0) + " ms";
            android.util.Log.i("cadu", "ping " + diag);
            return r == 200;
        } catch (Exception e) {
            diag = endereco.replace("/api/ping", "") + " → " + e.getClass().getSimpleName() + ": " + e.getMessage();
            android.util.Log.w("cadu", "ping falhou " + diag);
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Escuta o "CADU|8765" que o agente grita na rede a cada 3 s. */
    private void escutarBeacon() {
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                trava = wm.createMulticastLock("cadu");
                trava.setReferenceCounted(false);
                trava.acquire();
            }
        } catch (Exception ignored) {
        }
        Thread t = new Thread(new Runnable() {
            public void run() {
                while (vivo) {
                    DatagramSocket sock = null;
                    try {
                        sock = new DatagramSocket(null);
                        sock.setReuseAddress(true);
                        sock.bind(new java.net.InetSocketAddress(PORTA_BEACON));
                        sockBeacon = sock;
                        sock.setBroadcast(true);
                        byte[] buf = new byte[64];
                        while (vivo) {
                            DatagramPacket p = new DatagramPacket(buf, buf.length);
                            sock.receive(p);
                            String msg = new String(p.getData(), 0, p.getLength(), "UTF-8");
                            if (msg.startsWith("CADU|")) ipBeacon = p.getAddress().getHostAddress();
                        }
                    } catch (Exception e) {
                        dormir(5000);
                    } finally {
                        if (sock != null) sock.close();
                    }
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    private static void dormir(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }

    // ------------------------------------------------------------------ tela
    private void telaCheia() {
        if (Build.VERSION.SDK_INT >= 19) {
            web.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    private void travarSeForDono() {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
                dpm.setLockTaskPackages(new ComponentName(this, AdminReceiver.class),
                        new String[]{getPackageName()});
                startLockTask();
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) telaCheia();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.aoVoltar && window.aoVoltar()", null);
    }

    private void avisar(final String texto) {
        runOnUiThread(new Runnable() {
            public void run() { Toast.makeText(MainActivity.this, texto, Toast.LENGTH_LONG).show(); }
        });
    }

    private void abrir(final String acao) {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    Intent i = new Intent(acao);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ignored) { }
            }
        });
    }

    /** IP do PC: o do "grito" na rede, ou o último salvo (espera o grito até 8 s). */
    private String ipDoPC() {
        for (int i = 0; i < 16 && ipBeacon == null; i++) dormir(500);
        String ip = ipBeacon != null ? ipBeacon : prefs.getString("ip", null);
        return (ip != null && ping("http://" + ip + ":" + PORTA + "/api/ping")) ? ip : null;
    }

    private static String postar(String endereco, String json) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(endereco).openConnection();
            c.setConnectTimeout(3000); c.setReadTimeout(5000);
            c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.getOutputStream().write(json.getBytes("UTF-8"));
            InputStream in = c.getInputStream();
            java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[1024]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toString("UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void js(final String codigo) {
        runOnUiThread(new Runnable() { public void run() { web.evaluateJavascript("window." + codigo.replaceFirst("^", ""), null); } });
    }

    // ------------------------------------------------------------------ ponte JS
    /** Funções que a interface (HTML) pode chamar: Cadu.vibrar(30), Cadu.parear(...) */
    class Ponte {
        @JavascriptInterface
        public void vibrar(int ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(Math.max(5, Math.min(ms, 500)));
        }

        @JavascriptInterface
        public void vibrarPadrao() {  // aviso urgente: três toques
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(new long[]{0, 120, 90, 120, 90, 220}, -1);
        }

        @JavascriptInterface
        public String versao() { return "0.9.7-rede"; }

        /** Chamado pela interface quando está no cabo: guarda token + IP para o Wi-Fi. */
        @JavascriptInterface
        public void parear(String token, String ip) {
            SharedPreferences.Editor e = prefs.edit();
            if (token != null && token.length() >= 20) e.putString("token", token);
            if (ip != null && ip.length() > 0) e.putString("ip", ip);
            e.apply();
        }

        @JavascriptInterface
        public boolean pareado() { return prefs.getString("token", null) != null; }

        /** Abre a tela de Wi-Fi do Android (o botão Home volta para o Cadu). */
        @JavascriptInterface
        public void abrirWifi() { abrir(Settings.ACTION_WIFI_SETTINGS); }

        /** Abre as configurações gerais do Android. */
        @JavascriptInterface
        public void abrirAjustes() { abrir(Settings.ACTION_SETTINGS); }

        /** Situação da rede do celular, em JSON, para a tela de Ajustes. */
        @JavascriptInterface
        public String infoRede() {
            String ssid = "", ip = "";
            boolean ligado = false;
            try {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    ligado = wm.isWifiEnabled();
                    WifiInfo wi = wm.getConnectionInfo();
                    if (wi != null) {
                        ssid = wi.getSSID() == null ? "" : wi.getSSID().replace("\"", "");
                        if (ssid.contains("unknown")) ssid = "";
                        int n = wi.getIpAddress();
                        if (n != 0) ip = (n & 255) + "." + (n >> 8 & 255) + "." + (n >> 16 & 255) + "." + (n >> 24 & 255);
                    }
                }
            } catch (Exception ignored) { }
            return "{\"wifiLigado\":" + ligado + ",\"rede\":\"" + ssid.replace("\\", "") + "\",\"ip\":\"" + ip
                    + "\",\"pareado\":" + (prefs.getString("token", null) != null)
                    + ",\"ipPC\":\"" + (prefs.getString("ip", "") == null ? "" : prefs.getString("ip", "")) + "\""
                    + ",\"diag\":\"" + diag.replace("\\", "/").replace("\"", "'") + "\"}";
        }

        /**
         * Atualização sem cabo: baixa o APK que o agente do PC oferece (/apk)
         * e abre o instalador do Android. Você só confirma "Instalar" na tela.
         */
        @JavascriptInterface
        public boolean atualizarApp(final String url) {
            if (url == null || !(url.startsWith("http://127.0.0.1:") || url.startsWith("http://" + prefs.getString("ip", "-") + ":"))) return false;
            avisar("Baixando atualização…");
            Thread t = new Thread(new Runnable() {
                public void run() {
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(5000); c.setReadTimeout(30000);
                        String token = prefs.getString("token", null);
                        if (token != null) c.setRequestProperty("X-Cadu-Token", token);
                        if (c.getResponseCode() != 200) { avisar("PC sem APK novo (" + c.getResponseCode() + ")."); return; }
                        File destino = new File(getExternalFilesDir(null), "cadu-novo.apk");
                        InputStream in = c.getInputStream();
                        FileOutputStream out = new FileOutputStream(destino);
                        byte[] buf = new byte[16384]; int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        out.close(); in.close();
                        destino.setReadable(true, false);
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(Uri.fromFile(destino), "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception e) {
                        avisar("Falhou ao baixar: " + e.getMessage());
                    } finally {
                        if (c != null) c.disconnect();
                    }
                }
            });
            t.setDaemon(true);
            t.start();
            return true;
        }

        /** Esquece o pareamento (o próximo cabo pareia de novo). */
        @JavascriptInterface
        public void esquecerPareamento() { prefs.edit().remove("token").remove("ip").apply(); }

        /** Pareamento sem cabo, passo 1: pede ao PC (achado pelo "grito" na rede) para mostrar um código. */
        @JavascriptInterface
        public void pedirCodigo() {
            new Thread(new Runnable() { public void run() {
                String ip = ipDoPC();
                if (ip == null) { js("aoParear('erro','Não achei o PC na rede. O Wi-Fi do celular está na rede de casa e o agente ligado?')"); return; }
                String r = postar("http://" + ip + ":" + PORTA + "/api/parear/pedir", "{}");
                if (r != null && r.contains("\"ok\": true")) { prefs.edit().putString("ip", ip).apply(); js("aoParear('pedido','Olhe a tela do PC: apareceu um código de 6 números.')"); }
                else js("aoParear('erro','O PC não respondeu (" + ip + "). Atualize o agente do PC.')");
            } }).start();
        }

        /** Pareamento sem cabo, passo 2: manda o código e guarda o token. */
        @JavascriptInterface
        public void enviarCodigo(final String codigo) {
            new Thread(new Runnable() { public void run() {
                String ip = ipDoPC();
                if (ip == null) { js("aoParear('erro','Não achei o PC na rede.')"); return; }
                String c = codigo == null ? "" : codigo.replaceAll("[^0-9]", "");
                String r = postar("http://" + ip + ":" + PORTA + "/api/parear", "{\"codigo\": \"" + c + "\"}");
                java.util.regex.Matcher m = r == null ? null : java.util.regex.Pattern.compile("\"token\": \"([^\"]+)\"").matcher(r);
                if (m != null && m.find()) {
                    prefs.edit().putString("token", m.group(1)).putString("ip", ip).apply();
                    js("aoParear('ok','Pareado! Conectando…')");
                    if (prefs.getBoolean("voz", true)) OuvidoService.ligar(MainActivity.this, true);
                } else {
                    String msg = "Código errado ou vencido.";
                    if (r != null && r.contains("vencido")) msg = "Código vencido. Peça outro.";
                    js("aoParear('erro','" + msg + "')");
                }
            } }).start();
        }

        /** Sem PC: grava um post-it de voz no próprio celular (enviado quando o PC voltar). */
        @JavascriptInterface
        public boolean gravarIniciar() { return Gravador.iniciar(MainActivity.this, new Gravador.Aviso() {
            public void mudou(String estado, int segundos, int pendentes) { js("aoGravador('" + estado + "'," + segundos + "," + pendentes + ")"); }
        }); }

        @JavascriptInterface
        public void gravarParar() { Gravador.parar(); }

        @JavascriptInterface
        public int pendentes() { return Gravador.pendentes(MainActivity.this); }

        /** Brilho da tela só deste app (0.01–1); valor negativo = volta ao brilho do sistema. Usado no modo economia (olhos). */
        @JavascriptInterface
        public void brilho(final float v) {
            runOnUiThread(new Runnable() { public void run() {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = v < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : Math.max(0.01f, Math.min(1f, v));
                getWindow().setAttributes(lp);
            } });
        }

        /** Bateria do celular: {"nivel": 0-100, "carregando": true/false}. */
        @JavascriptInterface
        public String bateria() {
            try {
                Intent b = registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                int nivel = b.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1), escala = b.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100);
                int st = b.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                boolean carregando = st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL;
                return "{\"nivel\":" + (nivel < 0 ? -1 : nivel * 100 / Math.max(1, escala)) + ",\"carregando\":" + carregando + "}";
            } catch (Exception e) {
                return "{\"nivel\":-1}";
            }
        }

        /** Fase 2: liga/desliga o ouvido (microfone repassado ao PC). */
        @JavascriptInterface
        public void vozLigar(boolean sim) { OuvidoService.ligar(MainActivity.this, sim); }

        /** Situação do ouvido, em JSON. */
        @JavascriptInterface
        public String vozEstado() {
            return "{\"ligado\":" + prefs.getBoolean("voz", true) + ",\"conectado\":" + OuvidoService.conectado + "}";
        }

        /** A interface perdeu o agente: volta a procurar (cabo ou Wi-Fi). */
        @JavascriptInterface
        public void recarregar() { android.util.Log.w("cadu", "a tela pediu recarregar"); diag = "a tela desistiu (falhas seguidas)"; irOffline(); }
    }
}
