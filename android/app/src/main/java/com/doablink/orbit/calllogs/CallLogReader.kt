package com.doablink.orbit.calllogs

import android.content.Context
import android.provider.CallLog
import org.json.JSONArray
import org.json.JSONObject

object CallLogReader {
    fun readSince(context: Context, sinceMillis: Long): JSONArray {
        val events = JSONArray()
        val projection = arrayOf(CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION)
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            "${CallLog.Calls.DATE} > ?",
            arrayOf(sinceMillis.toString()),
            "${CallLog.Calls.DATE} ASC"
        )?.use { cursor ->
            val id = cursor.getColumnIndexOrThrow(CallLog.Calls._ID)
            val number = cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val type = cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val date = cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val duration = cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            while (cursor.moveToNext()) {
                val callType = when (cursor.getInt(type)) {
                    CallLog.Calls.INCOMING_TYPE -> "incoming"
                    CallLog.Calls.MISSED_TYPE -> "missed"
                    else -> "outgoing"
                }
                val seconds = cursor.getInt(duration)
                events.put(JSONObject()
                    .put("androidEventId", cursor.getString(id))
                    .put("phone", cursor.getString(number) ?: "")
                    .put("callType", callType)
                    .put("startedAt", java.time.Instant.ofEpochMilli(cursor.getLong(date)).toString())
                    .put("durationSeconds", seconds)
                    .put("status", if (callType == "missed" || seconds == 0) "not_connected" else "connected"))
            }
        }
        return events
    }
}
