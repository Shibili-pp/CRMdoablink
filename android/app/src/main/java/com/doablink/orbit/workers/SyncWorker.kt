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
import com.doablink.orbit.dial.DialAlerts
import com.doablink.orbit.recordings.RecordingFolder
import org.json.JSONArray

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("orbit", Context.MODE_PRIVATE)
        val base = prefs.getString("apiBase", null) ?: return Result.failure()
        val deviceToken = prefs.getString("deviceToken", null) ?: return Result.failure()
        val api = OrbitApi(base)
        return try {
            var calls = 0
            var events = JSONArray()
            if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
                val since = prefs.getLong("lastCallSync", System.currentTimeMillis() - 7L * 86_400_000L)
                events = usable(CallLogReader.readSince(applicationContext, since))
                calls = events.length()
                api.syncCalls(deviceToken, events)
                if (calls > 0) prefs.edit().putLong("lastCallSync", System.currentTimeMillis()).apply()
            }
            var recordings = 0
            val tree = prefs.getString("recordingTree", null)
            if (prefs.getBoolean("recordingUpload", false) && !tree.isNullOrBlank()) {
                val sinceRecording = prefs.getLong("lastRecordingSync", System.currentTimeMillis() - 7L * 86_400_000L)
                val files = RecordingFolder.pending(applicationContext, tree, sinceRecording, events)
                files.forEach { file ->
                    api.uploadRecording(deviceToken, file.name, file.mime, file.bytes, file.phone, file.androidEventId)
                    recordings += 1
                }
                if (recordings > 0) prefs.edit().putLong("lastRecordingSync", System.currentTimeMillis()).apply()
            }
            val dial = api.nextDial(deviceToken)
            if (dial != null) {
                prefs.edit()
                    .putString("pendingDialId", dial.optString("id"))
                    .putString("pendingDialPhone", dial.optString("phone"))
                    .putString("pendingDialName", dial.optString("contactName"))
                    .apply()
                DialAlerts.show(applicationContext, dial.optString("id"), dial.optString("contactName"), dial.optString("phone"))
            }
            var contacts = 0
            val contactsAllowed = prefs.getBoolean("contactsSync", false)
            if (contactsAllowed && ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
                val rows = usableContacts(ContactReader.read(applicationContext))
                contacts = rows.length()
                api.syncContacts(deviceToken, rows)
            }
            remember("Sent $calls calls, $recordings recordings and $contacts contacts")
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
