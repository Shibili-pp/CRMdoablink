package com.doablink.orbit.shell

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.File

object Share {
    fun text(context: Context, text: String) {
        val body = text.trim().take(4000)
        if (body.isEmpty()) error("There is nothing to share")
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, body)
        }
        open(context, send)
    }

    fun file(context: Context, name: String, dataUrl: String) {
        val comma = dataUrl.indexOf(',')
        if (comma < 0 || !dataUrl.startsWith("data:")) error("This file could not be shared")
        val meta = dataUrl.substring(5, comma)
        val mime = meta.substringBefore(';').ifBlank {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
        val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
        if (bytes.isEmpty() || bytes.size > 8 * 1024 * 1024) error("This file could not be shared")
        val safe = name.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._ -]"), "_")
            .trim()
            .take(80)
            .ifBlank { "hourly-report.xlsx" }
        val dir = File(context.cacheDir, "share")
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, safe)
        file.writeBytes(bytes)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(context.contentResolver, safe, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        open(context, send)
    }

    private fun open(context: Context, send: Intent) {
        for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            val targeted = Intent(send).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (targeted.resolveActivity(context.packageManager) != null) {
                context.startActivity(targeted)
                return
            }
        }
        context.startActivity(Intent.createChooser(send, "Share on WhatsApp").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
