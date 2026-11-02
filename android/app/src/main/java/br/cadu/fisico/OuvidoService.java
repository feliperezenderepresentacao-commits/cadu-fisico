package br.cadu.fisico;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Locale;

/**
 * Ouvido do Cadu (Fase 2 — agenda por voz).
 *
 * Fica rodando mesmo com a tela apagada (serviço em primeiro plano + wakelock):
 * capta o microfone (16 kHz, mono) e repassa o áudio para o PC pela porta 8767
 * (cabo: 127.0.0.1 via adb reverse; Wi-Fi: IP do PC + token).
 * Quem reconhece o "Cadu", transcreve e cria o lembrete é o PC — o J3 só escuta e fala:
 *   PC -> celular:  "BIP" (estou ouvindo)  "OK texto" (anotado)  "FALA texto" (falar em voz alta)  "ERRO"
 */
public class OuvidoService extends Service {

    static final int PORTA_VOZ = 8767;
    static final int TAXA = 16000;
    static final double LIMIAR = 450;          // nível que conta como "tem som"
    static final int PRE_BLOCOS = 16, POS_BLOCOS = 40;  // ~1 s antes, ~2,5 s depois
    static volatile boolean conectado = false;
    static volatile String ultimaFala = "";

    private volatile boolean rodando = false;
    private PowerManager.WakeLock trava;
    private WifiManager.WifiLock travaWifi;
    private TextToSpeech tts;
    private volatile boolean ttsPronto = false;
    private ToneGenerator bip;
    private SharedPreferences prefs;

    public static void ligar(Context c, boolean sim) {
        c.getSharedPreferences("cadu", MODE_PRIVATE).edit().putBoolean("voz", sim).apply();
        Intent i = new Intent(c, OuvidoService.class);
        if (sim) {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } else {
            c.stopService(i);
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("cadu", MODE_PRIVATE);
        try { bip = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90); } catch (Exception ignored) { }
        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            public void onInit(int st) {
                if (st == TextToSpeech.SUCCESS) {
                    try { tts.setLanguage(new Locale("pt", "BR")); } catch (Exception ignored) { }
                    ttsPronto = true;
                }
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        primeiroPlano();
        if (!rodando) {
            rodando = true;
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                trava = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cadu:ouvido");
                trava.acquire();
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) { travaWifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL, "cadu:ouvido"); travaWifi.acquire(); }
            } catch (Exception ignored) { }
            Thread t = new Thread(new Runnable() { public void run() { laco(); } });
            t.setDaemon(true);
            t.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        rodando = false;
        conectado = false;
        try { if (trava != null && trava.isHeld()) trava.release(); } catch (Exception ignored) { }
        try { if (travaWifi != null && travaWifi.isHeld()) travaWifi.release(); } catch (Exception ignored) { }
        try { if (tts != null) tts.shutdown(); } catch (Exception ignored) { }
        try { if (bip != null) bip.release(); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void primeiroPlano() {
        Intent abrir = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, abrir, Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel("ouvido", "Cadu ouvindo", NotificationManager.IMPORTANCE_LOW));
            b = new Notification.Builder(this, "ouvido");
        } else {
            b = new Notification.Builder(this);
        }
        b.setContentTitle("Cadu está ouvindo").setContentText("Diga \"Cadu\" e fale o lembrete").setSmallIcon(R.drawable.icone)
                .setContentIntent(pi).setOngoing(true);
        startForeground(77, b.build());
    }

    /** Conecta no PC e fica mandando o áudio; se cair, tenta de novo. */
    private void laco() {
        while (rodando) {
            Socket s = null;
            AudioRecord rec = null;
            try {
                s = conectar();
                if (s == null) { conectado = false; dormir(4000); continue; }
                int min = AudioRecord.getMinBufferSize(TAXA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, TAXA, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT, Math.max(min, TAXA));
                if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
                    rec.release();
                    rec = new AudioRecord(MediaRecorder.AudioSource.MIC, TAXA, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, Math.max(min, TAXA));
                }
                rec.startRecording();
                conectado = true;
                final String host = s.getInetAddress().getHostAddress();
                new Thread(new Runnable() { public void run() { Gravador.enviarPendentes(OuvidoService.this, host); } }).start();
                final Socket sock = s;
                Thread leitor = new Thread(new Runnable() { public void run() { ouvirPC(sock); } });
                leitor.setDaemon(true);
                leitor.start();
                OutputStream out = s.getOutputStream();
                byte[] buf = new byte[2048];  // 64 ms de áudio
                java.util.ArrayDeque<byte[]> antes = new java.util.ArrayDeque<byte[]>();
                int silencioBlocos = POS_BLOCOS + 1;
                while (rodando && !s.isClosed()) {
                    int n = rec.read(buf, 0, buf.length);
                    if (n > 0) {
                        // economia: só manda áudio quando há som (e 2,5 s depois); guarda ~1 s antes para não cortar o começo
                        long soma = 0;
                        for (int i = 0; i + 1 < n; i += 2) { int a = (short) ((buf[i] & 0xff) | (buf[i + 1] << 8)); soma += (long) a * a; }
                        double rms = Math.sqrt(soma / Math.max(1.0, n / 2.0));
                        if (rms > LIMIAR) {
                            if (silencioBlocos > POS_BLOCOS) { for (byte[] b : antes) out.write(b); }
                            antes.clear();
                            silencioBlocos = 0;
                        } else {
                            silencioBlocos++;
                        }
                        if (silencioBlocos <= POS_BLOCOS) out.write(buf, 0, n);
                        else { antes.addLast(java.util.Arrays.copyOf(buf, n)); if (antes.size() > PRE_BLOCOS) antes.removeFirst(); }
                    }
                    else if (n < 0) break;
                }
            } catch (Exception e) {
                // PC desligado, cabo solto ou Wi-Fi caiu: tenta de novo
            } finally {
                conectado = false;
                try { if (rec != null) { rec.stop(); rec.release(); } } catch (Exception ignored) { }
                try { if (s != null) s.close(); } catch (Exception ignored) { }
            }
            dormir(3000);
        }
    }

    private Socket conectar() {
        String token = prefs.getString("token", "-");
        String[] alvos = {"127.0.0.1", prefs.getString("ip", null)};
        for (String ip : alvos) {
            if (ip == null) continue;
            try {
                Socket s = new Socket();
                s.connect(new InetSocketAddress(ip, PORTA_VOZ), 2500);
                s.setTcpNoDelay(true);
                s.getOutputStream().write(("CADU-AUDIO " + token + " 16000\n").getBytes("UTF-8"));
                return s;
            } catch (Exception ignored) { }
        }
        return null;
    }

    /** Recados do PC: bipe, confirmação, fala. */
    private void ouvirPC(Socket s) {
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(s.getInputStream(), "UTF-8"));
            String l;
            while ((l = r.readLine()) != null) {
                if (l.equals("BIP")) { tom(ToneGenerator.TONE_PROP_BEEP, 150); vibrar(40); }
                else if (l.startsWith("OK")) { tom(ToneGenerator.TONE_PROP_ACK, 250); vibrar(60); ultimaFala = l.length() > 3 ? l.substring(3) : ""; }
                else if (l.startsWith("FALA ")) { falar(l.substring(5)); }
                else if (l.equals("ERRO")) { tom(ToneGenerator.TONE_PROP_NACK, 250); }
            }
        } catch (Exception ignored) { }
        try { s.close(); } catch (Exception ignored) { }
    }

    private void tom(int t, int ms) { try { if (bip != null) bip.startTone(t, ms); } catch (Exception ignored) { } }

    private void vibrar(int ms) {
        try { Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE); if (v != null) v.vibrate(ms); } catch (Exception ignored) { }
    }

    @SuppressWarnings("deprecation")
    private void falar(String texto) {
        ultimaFala = texto;
        if (ttsPronto && tts != null) {
            try { tts.speak(texto, TextToSpeech.QUEUE_ADD, null); } catch (Exception ignored) { }
        } else {
            tom(ToneGenerator.TONE_PROP_ACK, 300);
        }
    }

    private static void dormir(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) { } }
}
