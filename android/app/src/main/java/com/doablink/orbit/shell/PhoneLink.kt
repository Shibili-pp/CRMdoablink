package com.doablink.orbit.shell

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Base64
import androidx.core.app.NotificationCompat
import com.doablink.orbit.api.OrbitApi
import com.doablink.orbit.home.HomeActivity
import com.doablink.orbit.workers.OrbitSync
import org.json.JSONObject
import java.util.UUID

object PhoneLink {
    const val WEB = "https://crmorbit.doablink.workers.dev/"
    const val API = "https://crmdoablink.onrender.com/api/v1"
    const val HOST = "crmorbit.doablink.workers.dev"

    const val BOOT = """
      (function(){
        if (window.__orbitBoot) return;
        window.__orbitBoot = true;
        function saved(){
          try { return (window.OrbitNative && OrbitNative.savedAccess()) || ''; }
          catch (e) { return ''; }
        }
        try {
          var token = saved();
          if (token && !sessionStorage.getItem('orbit_access')) sessionStorage.setItem('orbit_access', token);
        } catch (e) {}
        function report(){
          try {
            var current = sessionStorage.getItem('orbit_access') || '';
            if (window.OrbitNative) OrbitNative.onSession(current);
          } catch (e) {}
        }
        report();
        setInterval(report, 1500);
        function hook(){
          try {
            var proto = HTMLAnchorElement.prototype;
            if (!proto || proto.__orbitHook) return;
            proto.__orbitHook = true;
            var nativeClick = proto.click;
            proto.click = function(){
              var self = this;
              if (self.href && self.href.indexOf('blob:') === 0 && self.download) {
                fetch(self.href).then(function(response){ return response.blob(); }).then(function(blob){
                  var reader = new FileReader();
                  reader.onloadend = function(){
                    var data = String(reader.result || '');
                    var id = String(Date.now()) + Math.random();
                    var size = 400000;
                    var parts = Math.max(1, Math.ceil(data.length / size));
                    for (var index = 0; index < parts; index++) {
                      OrbitNative.downloadChunk(id, self.download || 'download', index, parts, data.substring(index * size, (index + 1) * size));
                    }
                  };
                  reader.readAsDataURL(blob);
                }).catch(function(){ nativeClick.call(self); });
                return;
              }
              return nativeClick.call(self);
            };
          } catch (e) {}
        }
        hook();
        document.addEventListener('DOMContentLoaded', hook);
      })();
    """

    fun prefs(context: Context) = context.getSharedPreferences("orbit", Context.MODE_PRIVATE)

    fun ensureApi(context: Context) {
        prefs(context).edit().putString("apiBase", API).apply()
    }

    fun deviceId(context: Context): String {
        val stored = prefs(context).getString("deviceId", null)
        if (!stored.isNullOrBlank()) return stored
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val id = if (androidId.isNullOrBlank()) UUID.randomUUID().toString() else androidId
        prefs(context).edit().putString("deviceId", id).apply()
        return id
    }

    fun subject(token: String): String? {
        val parts = token.split('.')
        if (parts.size < 2) return null
        return try {
            val payload = String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8)
            JSONObject(payload).optString("sub").ifBlank { null }
        } catch (_: Exception) {
            null
        }
    }

    fun register(context: Context, access: String, callLog: Boolean, contacts: Boolean) {
        ensureApi(context)
        val token = OrbitApi(API).registerDevice(access, deviceId(context), callLog, contacts)
        prefs(context).edit()
            .putString("deviceToken", token)
            .putBoolean("contactsSync", contacts)
            .putBoolean("callLogGranted", callLog)
            .putString("linkedSub", subject(access))
            .apply()
        OrbitSync.schedule(context)
        OrbitSync.now(context)
        showPhoneSettings(context)
    }

    fun showPhoneSettings(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel("orbit-sync", "Phone sync", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            context,
            21,
            Intent(context, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val note = prefs(context).getString("lastSyncMessage", "Call history syncs about every 15 minutes")
        val notification = NotificationCompat.Builder(context, "orbit-sync")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Call history sync")
            .setContentText(note)
            .setContentIntent(open)
            .build()
        manager.notify(21, notification)
    }
}
