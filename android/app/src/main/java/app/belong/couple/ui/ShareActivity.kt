package app.belong.couple.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Receives "Share" from Pinterest, a browser or any app that shares text or a link, and opens
 * Belong's "New dream" with it. Shows nothing itself.
 */
class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = listOfNotNull(
            intent?.getStringExtra(Intent.EXTRA_SUBJECT),
            intent?.getStringExtra(Intent.EXTRA_TEXT),
        ).joinToString(" ").trim()
        if (intent?.action == Intent.ACTION_SEND && text.isNotEmpty()) {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_SHARED_TEXT, text.take(2000))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        }
        finish()
    }
}
