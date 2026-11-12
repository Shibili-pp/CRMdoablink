package com.doablink.orbit.home

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.doablink.orbit.auth.LoginActivity
import com.doablink.orbit.workers.OrbitSync

class HomeActivity : AppCompatActivity() {
    private lateinit var status: TextView

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
                text = "This phone sends new calls to DoablinkOrbit about every 15 minutes while it has a network connection. Open the app and tap Sync now after a calling session if you want the report immediately."
                setPadding(0, 16, 0, 24)
            })
            addView(Button(this@HomeActivity).apply {
                text = "Sync now"
                setOnClickListener {
                    OrbitSync.now(this@HomeActivity)
                    status.text = "Sync started"
                }
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
        status.text = if (at == 0L) note else "$note\n${java.text.DateFormat.getDateTimeInstance().format(java.util.Date(at))}"
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
