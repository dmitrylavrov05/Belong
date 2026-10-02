package app.belong.couple.data

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Db
import app.belong.couple.sync.Reason
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Voice messages: recorded as small AAC files (mono, 24 kbps, up to two minutes), kept in the app's
 * files and sent to pairs/{code}/voice_data/{key} as base64, which the free database plan handles fine.
 */
object VoiceNotes {
    const val MAX_SECONDS = 120

    private val pool = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private var recorder: MediaRecorder? = null
    private var recordingKey: String? = null
    private var startedAt = 0L

    private var player: MediaPlayer? = null
    var playingKey: String? = null
        private set

    private fun dir(context: Context) = File(context.applicationContext.filesDir, "voices").apply { mkdirs() }
    fun file(context: Context, key: String) = File(dir(context), "$key.m4a")

    val recording: Boolean get() = recorder != null

    /** Seconds since recording started. */
    fun elapsed(): Int = if (recorder == null) 0 else ((System.currentTimeMillis() - startedAt) / 1000).toInt()

    /** Starts recording; [onLimit] is called if it reaches [MAX_SECONDS]. False if the microphone can't be used. */
    fun start(context: Context, onLimit: () -> Unit): Boolean {
        cancel(context)
        stopPlaying()
        val key = System.currentTimeMillis().toString(36) + (1000..9999).random().toString(36)
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        return try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(22_050)
            r.setAudioEncodingBitRate(24_000)
            r.setMaxDuration(MAX_SECONDS * 1000)
            r.setOutputFile(file(context, key).path)
            r.setOnInfoListener { _, what, _ -> if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) main.post(onLimit) }
            r.prepare()
            r.start()
            recorder = r
            recordingKey = key
            startedAt = System.currentTimeMillis()
            true
        } catch (e: Exception) {
            r.release()
            file(context, key).delete()
            false
        }
    }

    /** Finishes recording: the key and length in seconds, or null if it was too short or failed. */
    fun finish(context: Context): Pair<String, Int>? {
        val r = recorder ?: return null
        val key = recordingKey ?: return null
        val seconds = ((System.currentTimeMillis() - startedAt + 500) / 1000).toInt().coerceAtMost(MAX_SECONDS)
        recorder = null
        recordingKey = null
        val ok = try {
            r.stop()
            true
        } catch (e: RuntimeException) {
            false // stopped right after starting: nothing was recorded
        } finally {
            r.release()
        }
        if (!ok || seconds < 1) {
            file(context, key).delete()
            return null
        }
        return key to seconds
    }

    fun cancel(context: Context) {
        val key = recordingKey
        recorder?.let {
            try {
                it.stop()
            } catch (e: RuntimeException) {
                // nothing recorded yet
            }
            it.release()
        }
        recorder = null
        recordingKey = null
        key?.let { file(context, it).delete() }
    }

    /** Puts voice message [key] in the pair's database. True when it's there; throws when offline. */
    fun upload(app: Context, db: Db, code: String, me: String, key: String, seconds: Int, token: () -> String): Boolean {
        val f = file(app, key)
        if (!f.exists()) return false
        try {
            db.put("pairs/$code/voice_data/$key", JSONObject().put("by", me).put("dur", seconds)
                .put("data", Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)), token())
        } catch (e: CloudException) {
            if (e.reason != Reason.DENIED && e.reason != Reason.OTHER) throw e
            return db.get("pairs/$code/voice_data/$key/by", token()) == me
        }
        return true
    }

    /**
     * Plays [key] (fetching it from the pair's database the first time), or stops it if it's playing.
     * [onProgress] gets 0..1 while it plays and is called with -1 when it stops.
     */
    fun toggle(context: Context, key: String, onProgress: (Float) -> Unit) {
        if (playingKey == key) {
            stopPlaying()
            onProgress(-1f)
            return
        }
        stopPlaying()
        playingKey = key
        val app = context.applicationContext
        pool.execute {
            val f = file(app, key)
            if (!f.exists()) fetch(app, key, f)
            main.post {
                if (playingKey != key) return@post
                if (!f.exists()) {
                    playingKey = null
                    onProgress(-1f)
                    return@post
                }
                val p = MediaPlayer()
                try {
                    p.setDataSource(f.path)
                    p.prepare()
                } catch (e: Exception) {
                    p.release()
                    playingKey = null
                    onProgress(-1f)
                    return@post
                }
                player = p
                p.setOnCompletionListener {
                    stopPlaying()
                    onProgress(-1f)
                }
                p.start()
                val tick = object : Runnable {
                    override fun run() {
                        val current = player ?: return
                        if (playingKey != key) return
                        onProgress(current.currentPosition.toFloat() / current.duration.coerceAtLeast(1))
                        main.postDelayed(this, 100)
                    }
                }
                main.post(tick)
            }
        }
    }

    fun stopPlaying() {
        player?.let {
            try {
                it.stop()
            } catch (e: IllegalStateException) {
                // already stopped
            }
            it.release()
        }
        player = null
        playingKey = null
    }

    private fun fetch(app: Context, key: String, target: File) {
        val account = Account.get(app)
        val seat = account.seat ?: return
        if (!account.paired) return
        val data = try {
            Db(account.config).get("pairs/${seat.code}/voice_data/$key/data", account.token()) as? String
        } catch (e: CloudException) {
            null
        } ?: return
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeBytes(Base64.decode(data, Base64.DEFAULT))
        tmp.renameTo(target)
    }

    /** "0:07", "1:30". */
    fun format(seconds: Int): String = "%d:%02d".format(seconds / 60, seconds % 60)
}
