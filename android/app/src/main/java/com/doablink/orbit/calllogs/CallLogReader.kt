package com.doablink.orbit.calllogs

import android.content.Context
import android.provider.CallLog
import org.json.JSONArray
import org.json.JSONObject

object CallLogReader {
    fun readSince(context: Context, sinceMillis: Long): JSONArray {
        val events = JSONArray()
        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            "${CallLog.Calls.DATE} > ?",
            arrayOf(sinceMillis.toString()),
            "${CallLog.Calls.DATE} ASC"
        )?.use { cursor ->
            val id = cursor.getColumnIndexOrThrow(CallLog.Calls._ID)
            val number = cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val name = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
            val type = cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val date = cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val duration = cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            while (cursor.moveToNext()) {
                val rawType = cursor.getInt(type)
                val seconds = cursor.getInt(duration)
                val callType = when (rawType) {
                    CallLog.Calls.INCOMING_TYPE, CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> "incoming"
                    CallLog.Calls.MISSED_TYPE -> "missed"
                    else -> "outgoing"
                }
                val status = when {
                    rawType == CallLog.Calls.REJECTED_TYPE || rawType == CallLog.Calls.BLOCKED_TYPE -> "rejected"
                    rawType == CallLog.Calls.MISSED_TYPE -> "missed"
                    seconds <= 0 && callType == "outgoing" -> "no_answer"
                    seconds <= 0 -> "not_connected"
                    else -> "connected"
                }
                val eventId = cursor.getString(id) ?: continue
                events.put(JSONObject()
                    .put("androidEventId", eventId)
                    .put("phone", cursor.getString(number) ?: "")
                    .put("contactName", if (name >= 0) cursor.getString(name) ?: "" else "")
                    .put("callType", callType)
                    .put("startedAt", java.time.Instant.ofEpochMilli(cursor.getLong(date)).toString())
                    .put("durationSeconds", seconds)
                    .put("status", status)
                    .put("provider", "sim")
                    .put("providerCallId", eventId))
            }
        }
        return events
    }
}
