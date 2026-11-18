package com.doablink.orbit.recordings

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray

object RecordingFolder {
    data class SavedRecording(val name: String, val mime: String, val bytes: ByteArray, val phone: String, val androidEventId: String)

    fun pending(context: Context, tree: String, sinceMillis: Long, events: JSONArray): List<SavedRecording> {
        val root = DocumentFile.fromTreeUri(context, Uri.parse(tree)) ?: return emptyList()
        val found = mutableListOf<SavedRecording>()
        collect(context, root, sinceMillis, events, found)
        return found.take(5)
    }

    private fun collect(context: Context, file: DocumentFile, sinceMillis: Long, events: JSONArray, found: MutableList<SavedRecording>) {
        if (found.size >= 5) return
        if (file.isDirectory) {
            file.listFiles().forEach { collect(context, it, sinceMillis, events, found) }
            return
        }
        val mime = file.type.orEmpty()
        if (!mime.startsWith("audio/")) return
        if (file.lastModified() <= sinceMillis) return
        if (file.length() <= 0L || file.length() > 20L * 1024L * 1024L) return
        val name = file.name ?: return
        val match = matchCall(name, events)
        val bytes = context.contentResolver.openInputStream(file.uri)?.use { it.readBytes() } ?: return
        found.add(SavedRecording(name, mime, bytes, match.first, match.second))
    }

    private fun matchCall(fileName: String, events: JSONArray): Pair<String, String> {
        val digits = fileName.filter { it.isDigit() }
        if (digits.length < 10) return "" to ""
        val tail = digits.takeLast(10)
        for (index in 0 until events.length()) {
            val event = events.optJSONObject(index) ?: continue
            val phone = event.optString("phone").filter { it.isDigit() }
            if (phone.endsWith(tail)) return event.optString("phone") to event.optString("androidEventId")
        }
        return tail to ""
    }
}
