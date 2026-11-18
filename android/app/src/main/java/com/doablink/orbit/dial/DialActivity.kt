package com.doablink.orbit.dial

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.doablink.orbit.api.OrbitApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DialActivity : AppCompatActivity() {
    private lateinit var message: TextView
    private var dialId = ""
    private var phone = ""

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) place() else report("failed", "Call permission was not allowed")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dialId = intent.getStringExtra("dialId").orEmpty()
        phone = intent.getStringExtra("phone").orEmpty()
        val name = intent.getStringExtra("name").orEmpty()
        message = TextView(this)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 72, 48, 48)
            addView(TextView(this@DialActivity).apply {
                text = "Call ${name.ifBlank { phone }}"
                textSize = 24f
            })
            addView(TextView(this@DialActivity).apply {
                text = "This places a normal call through this phone's SIM. It is not a paid calling service. The other person sees your mobile number."
                setPadding(0, 16, 0, 24)
            })
            addView(Button(this@DialActivity).apply {
                text = "Call $phone"
                setOnClickListener { confirm() }
            })
            addView(Button(this@DialActivity).apply {
                text = "Not now"
                setOnClickListener { report("cancelled", "Employee dismissed the call") }
            })
            addView(message)
        }
        setContentView(layout)
    }

    private fun confirm() {
        if (dialId.isBlank() || phone.isBlank()) {
            message.text = "This call request is incomplete."
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) place()
        else permission.launch(Manifest.permission.CALL_PHONE)
    }

    private fun place() {
        report("completed", "") {
            startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:$phone")))
        }
    }

    private fun report(status: String, reason: String, after: () -> Unit = { finish() }) {
        val prefs = getSharedPreferences("orbit", MODE_PRIVATE)
        val base = prefs.getString("apiBase", null)
        val token = prefs.getString("deviceToken", null)
        if (base.isNullOrBlank() || token.isNullOrBlank()) {
            message.text = "This phone is not connected."
            return
        }
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { OrbitApi(base).finishDial(token, dialId, status, reason) }
                prefs.edit().remove("pendingDialId").apply()
                after()
            } catch (error: Exception) {
                message.text = error.message ?: "The call request could not be updated"
            }
        }
    }
}
