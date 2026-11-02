package br.cadu.fisico;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Post-it de voz sem PC (Fase 2, opção A): você toca no 🎤, fala, e o áudio fica guardado no celular.
 * Quando o ouvido volta a falar com o PC, as gravações são enviadas e viram post-its
 * (com a hora em que você falou — "daqui a 2 horas" conta a partir da gravação).
 */
public class Gravador {
    interface Aviso { void mudou(String estado, int segundos, int pendentes); }

    static final int TAXA = 16000, MAX_S = 30;
    private static volatile boolean gravando = false, parar = false;
    private static final java.util.concurrent.atomic.AtomicBoolean enviando = new java.util.concurrent.atomic.AtomicBoolean(false);

    static File pasta(Context c) {
        File d = new File(c.getFilesDir(), "pendentes");
        if (!d.isDirectory()) d.mkdirs();
        return d;
    }

    static int pendentes(Context c) {
        File[] l = pasta(c).listFiles();
        return l == null ? 0 : l.length;
    }

    static void parar() { parar = true; }

    static boolean iniciar(final Context c, final Aviso aviso) {
        if (gravando) { parar = true; return false; }
        gravando = true; parar = false;
        new Thread(new Runnable() { public void run() {
            AudioRecord rec = null;
            ByteArrayOutputStream pcm = new ByteArrayOutputStream();
            long inicio = System.currentTimeMillis();
            try {
                int min = AudioRecord.getMinBufferSize(TAXA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                rec = new AudioRecord(MediaRecorder.AudioSource.MIC, TAXA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, TAXA));
                if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("microfone ocupado");
                rec.startRecording();
                aviso.mudou("gravando", 0, pendentes(c));
                byte[] buf = new byte[2048];
                boolean falou = false; double silencio = 0; int ultimoSeg = -1;
                while (!parar) {
                    int n = rec.read(buf, 0, buf.length);
                    if (n <= 0) break;
                    pcm.write(buf, 0, n);
                    long soma = 0;
                    for (int i = 0; i + 1 < n; i += 2) { int a = (short) ((buf[i] & 0xff) | (buf[i + 1] << 8)); soma += (long) a * a; }
                    double rms = Math.sqrt(soma / Math.max(1.0, n / 2.0));
                    double dur = n / 2.0 / TAXA;
                    if (rms > 900) { falou = true; silencio = 0; } else silencio += dur;
                    int seg = (int) ((System.currentTimeMillis() - inicio) / 1000);
                    if (seg != ultimoSeg) { ultimoSeg = seg; aviso.mudou("gravando", seg, pendentes(c)); }
                    if (seg >= MAX_S || (falou && silencio > 2.0) || (!falou && seg >= 8)) break;  // para sozinho
                }
            } catch (Exception e) {
                aviso.mudou("erro", 0, pendentes(c));
                gravando = false;
                return;
            } finally {
                try { if (rec != null) { rec.stop(); rec.release(); } } catch (Exception ignored) { }
            }
            byte[] dados = pcm.toByteArray();
            if (dados.length > TAXA) {  // mais de meio segundo
                try {
                    OutputStream out = new FileOutputStream(new File(pasta(c), inicio + ".pcm"));
                    out.write(dados); out.close();
                    aviso.mudou("salvo", (int) (dados.length / 2 / TAXA), pendentes(c));
                } catch (Exception e) { aviso.mudou("erro", 0, pendentes(c)); }
            } else {
                aviso.mudou("vazio", 0, pendentes(c));
            }
            gravando = false;
        } }).start();
        return true;
    }

    /** Manda as gravações guardadas para o PC (chamado quando o ouvido conecta). */
    static void enviarPendentes(Context c, String host) {
        if (!enviando.compareAndSet(false, true)) return;   // um envio por vez (evita post-it duplicado)
        try { enviarPendentesAgora(c, host); } finally { enviando.set(false); }
    }

    private static void enviarPendentesAgora(Context c, String host) {
        File[] l = pasta(c).listFiles();
        if (l == null) return;
        String token = c.getSharedPreferences("cadu", Context.MODE_PRIVATE).getString("token", "");
        for (File f : l) {
            HttpURLConnection con = null;
            try {
                String ts = f.getName().replace(".pcm", "");
                byte[] dados = new byte[(int) f.length()];
                FileInputStream in = new FileInputStream(f);
                int lidos = 0;
                while (lidos < dados.length) { int n = in.read(dados, lidos, dados.length - lidos); if (n < 0) break; lidos += n; }
                in.close();
                con = (HttpURLConnection) new URL("http://" + host + ":" + MainActivity.PORTA + "/api/voz/audio?ts=" + ts).openConnection();
                con.setConnectTimeout(4000); con.setReadTimeout(90000);  // o PC transcreve antes de responder
                con.setRequestMethod("POST"); con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/octet-stream");
                if (token != null) con.setRequestProperty("X-Cadu-Token", token);
                con.setFixedLengthStreamingMode(dados.length);
                con.getOutputStream().write(dados);
                if (con.getResponseCode() == 200) f.delete();
            } catch (Exception ignored) {
            } finally {
                if (con != null) con.disconnect();
            }
        }
    }
}
