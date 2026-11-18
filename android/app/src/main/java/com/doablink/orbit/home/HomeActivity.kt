package com.doablink.orbit.home

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.doablink.orbit.auth.LoginActivity
import com.doablink.orbit.dial.DialActivity
import com.doablink.orbit.workers.OrbitSync

class HomeActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private val folder = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) return@registerForActivityResult
        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        getSharedPreferences("orbit", MODE_PRIVATE).edit()
            .putString("recordingTree", uri.toString())
            .putBoolean("recordingUpload", true)
            .apply()
        status.text = "Recordings in this folder will upload on the next sync. This app does not record the call itself."
        OrbitSync.now(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 72, 48, 48)
            addView(TextView(this@HomeActivity).apply {
                text = "Call sync is on"
                textSize = 24f
            })
            addView(TextView(this@HomeActivity).apply {
                text = "This phone sends new SIM calls to DoablinkOrbit about every 15 minutes. A call queued from the CRM asks you to confirm it, then uses this phone's SIM. A recording uploads only from a folder you choose, and only if the dialer already saved the file."
                setPadding(0, 16, 0, 24)
            })
            addView(Button(this@HomeActivity).apply {
                text = "Place waiting call"
                setOnClickListener { openWaitingCall() }
            })
            addView(Button(this@HomeActivity).apply {
                text = "Sync now"
                setOnClickListener {
                    OrbitSync.now(this@HomeActivity)
                    status.text = "Sync started"
                }
            })
            addView(Button(this@HomeActivity).apply {
                text = "Choose recording folder"
                setOnClickListener { folder.launch(null) }
            })
            addView(Button(this@HomeActivity).apply {
                text = "Allow background sync"
                setOnClickListener { askBattery() }
            })
            addView(status)
            addView(Button(this@HomeActivity).apply {
                text = "Sign out of this phone"
                setOnClickListener { signOut() }
            })
        }
        setContentView(layout)
    }

    override fun onResume() {
        super.onResume()
        val prefs = getSharedPreferences("orbit", MODE_PRIVATE)
        val note = prefs.getString("lastSyncMessage", "Waiting for the first sync")
        val at = prefs.getLong("lastSyncAt", 0L)
        val waiting = prefs.getString("pendingDialPhone", null)
        val waitingText = if (waiting.isNullOrBlank()) "" else "\nA call to $waiting is waiting for your confirmation."
        status.text = (if (at == 0L) note else "$note\n${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(at))}") + waitingText
    }

    private fun openWaitingCall() {
        val prefs = getSharedPreferences("orbit", MODE_PRIVATE)
        val id = prefs.getString("pendingDialId", null)
        val phone = prefs.getString("pendingDialPhone", null)
        if (id.isNullOrBlank() || phone.isNullOrBlank()) {
            status.text = "No call is waiting. Use Sync now after a call is queued from the CRM."
            return
        }
        startActivity(Intent(this, DialActivity::class.java)
            .putExtra("dialId", id)
            .putExtra("phone", phone)
            .putExtra("name", prefs.getString("pendingDialName", "")))
    }

    private fun askBattery() {
        val manager = getSystemService(PowerManager::class.java)
        if (manager.isIgnoringBatteryOptimizations(packageName)) {
            status.text = "Background sync is already allowed"
            return
        }
        startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
    }

    private fun signOut() {
        OrbitSync.stop(this)
        getSharedPreferences("orbit", MODE_PRIVATE).edit().remove("deviceToken").apply()
        startActivity(Intent(this, LoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    }
}
