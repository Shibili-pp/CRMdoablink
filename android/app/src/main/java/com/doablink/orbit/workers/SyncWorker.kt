package com.doablink.orbit.workers

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.doablink.orbit.api.OrbitApi
import com.doablink.orbit.calllogs.CallLogReader
import com.doablink.orbit.contacts.ContactReader
import org.json.JSONArray

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("orbit", Context.MODE_PRIVATE)
        val base = prefs.getString("apiBase", null) ?: return Result.failure()
        val deviceToken = prefs.getString("deviceToken", null) ?: return Result.failure()
        val api = OrbitApi(base)
        return try {
            var calls = 0
            if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
                val since = prefs.getLong("lastCallSync", System.currentTimeMillis() - 7L * 86_400_000L)
                val events = usable(CallLogReader.readSince(applicationContext, since))
                calls = events.length()
                api.syncCalls(deviceToken, events)
                if (calls > 0) prefs.edit().putLong("lastCallSync", System.currentTimeMillis()).apply()
            }
            var contacts = 0
            val contactsAllowed = prefs.getBoolean("contactsSync", false)
            if (contactsAllowed && ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
                val rows = usableContacts(ContactReader.read(applicationContext))
                contacts = rows.length()
                api.syncContacts(deviceToken, rows)
            }
            remember("Sent $calls calls and $contacts contacts")
            Result.success()
        } catch (error: Exception) {
            remember(error.message ?: "Sync failed")
            if ((error.message ?: "").contains("not registered", ignoreCase = true)) Result.failure() else Result.retry()
        }
    }

    private fun remember(message: String) {
        applicationContext.getSharedPreferences("orbit", Context.MODE_PRIVATE).edit()
            .putString("lastSyncMessage", message)
            .putLong("lastSyncAt", System.currentTimeMillis())
            .apply()
    }

    private fun usable(events: JSONArray): JSONArray {
        val rows = JSONArray()
        for (index in 0 until events.length()) {
            val event = events.getJSONObject(index)
            if (event.optString("phone").isNotBlank() && event.optString("androidEventId").isNotBlank()) rows.put(event)
        }
        return rows
    }

    private fun usableContacts(events: JSONArray): JSONArray {
        val rows = JSONArray()
        for (index in 0 until events.length()) {
            val event = events.getJSONObject(index)
            if (event.optString("phone").isNotBlank() && event.optString("deviceContactId").isNotBlank()) rows.put(event)
        }
        return rows
    }
}
