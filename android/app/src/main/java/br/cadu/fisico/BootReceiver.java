package br.cadu.fisico;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Ao ligar o celular, religa o ouvido do Cadu (se a voz estiver ligada). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction()) && c.getSharedPreferences("cadu", Context.MODE_PRIVATE).getBoolean("voz", true)) {
            OuvidoService.ligar(c, true);
        }
    }
}
