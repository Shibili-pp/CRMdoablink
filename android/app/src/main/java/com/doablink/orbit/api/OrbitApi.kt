package com.doablink.orbit.api

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class OrbitApi(private val baseUrl: String) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private val json = "application/json".toMediaType()

    fun login(username: String, password: String): String {
        val body = JSONObject().put("username", username).put("password", password)
        val response = post("/auth/login", body, null)
        return response.getJSONObject("data").getString("accessToken")
    }

    fun registerDevice(accessToken: String, deviceId: String, callLogGranted: Boolean, contactsGranted: Boolean): String {
        val body = JSONObject()
            .put("deviceIdentifier", deviceId)
            .put("deviceName", android.os.Build.MODEL)
            .put("manufacturer", android.os.Build.MANUFACTURER)
            .put("model", android.os.Build.MODEL)
            .put("osVersion", android.os.Build.VERSION.RELEASE)
            .put("appVersion", "0.1.0")
            .put("consentAccepted", true)
            .put("contactsConsent", contactsGranted)
            .put("callLogPermission", if (callLogGranted) "granted" else "denied")
            .put("contactsPermission", if (contactsGranted) "granted" else "denied")
        val response = post("/android/devices/register", body, accessToken)
        return response.getJSONObject("data").getString("deviceToken")
    }

    fun syncCalls(deviceToken: String, events: JSONArray) {
        if (events.length() == 0) return
        var start = 0
        while (start < events.length()) {
            val batch = JSONArray()
            val end = minOf(start + 400, events.length())
            for (index in start until end) batch.put(events.get(index))
            post("/android/calls/sync", JSONObject().put("events", batch), deviceToken)
            start = end
        }
    }

    fun syncContacts(deviceToken: String, contacts: JSONArray) {
        if (contacts.length() == 0) return
        var start = 0
        while (start < contacts.length()) {
            val batch = JSONArray()
            val end = minOf(start + 800, contacts.length())
            for (index in start until end) batch.put(contacts.get(index))
            post("/android/contacts/sync", JSONObject().put("contacts", batch), deviceToken)
            start = end
        }
    }

    private fun post(path: String, body: JSONObject, token: String?): JSONObject {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path).post(body.toString().toRequestBody(json))
        if (token != null) builder.header("Authorization", "Bearer $token")
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = runCatching { JSONObject(text).optString("message") }.getOrNull().orEmpty()
                error(message.ifBlank { text.ifBlank { "Orbit API ${response.code}" } })
            }
            if (text.isBlank()) return JSONObject()
            return JSONObject(text)
        }
    }
}
