package com.doablink.orbit.dial

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

object DialAlerts {
    private const val CHANNEL = "orbit-dial"

    fun show(context: Context, id: String, name: String, phone: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Calls to place", NotificationManager.IMPORTANCE_HIGH))
        }
        val open = Intent(context, DialActivity::class.java)
            .putExtra("dialId", id)
            .putExtra("phone", phone)
            .putExtra("name", name)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pending = PendingIntent.getActivity(
            context,
            id.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val label = name.ifBlank { phone }
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle("Call $label")
            .setContentText("Uses this phone's SIM. Tap to confirm.")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        manager.notify(id.hashCode(), notification)
    }
}
