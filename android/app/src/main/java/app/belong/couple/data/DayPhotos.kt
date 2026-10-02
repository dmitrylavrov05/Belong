package app.belong.couple.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.media.ExifInterface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.LruCache
import android.widget.ImageView
import app.belong.couple.core.PhotosModel
import app.belong.couple.core.seatKey
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Db
import app.belong.couple.sync.LiveSync
import app.belong.couple.sync.Reason
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.Executors

/**
 * Photos of the day. Each photo is compressed on the phone (a 1280 px picture and a 360 px thumbnail)
 * and kept in the app's files. For a pair the JPEGs go to pairs/{code}/photo_data/{key} and a small
 * description to live/photos/{day}/{key}, so everything fits the free database plan.
 */
object DayPhotos {
    private const val FULL_PX = 1280
    private const val THUMB_PX = 360
    private const val MAX_FULL = 1_000_000
    private const val MAX_THUMB = 80_000

    private val pool = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private val memory = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 10 / 1024).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }

    private fun dir(context: Context) = File(context.applicationContext.filesDir, "day-photos").apply { mkdirs() }
    private fun file(context: Context, key: String, thumb: Boolean) = File(dir(context), if (thumb) "${key}_t.jpg" else "$key.jpg")
    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("day_photos", Context.MODE_PRIVATE)

    fun today(): Long = LocalDate.now(ZoneId.systemDefault()).toEpochDay()

    /** How many photos I've added on [day]. */
    fun mineOn(context: Context, day: Long): Int {
        val repo = SharedRepo(context)
        return PhotosModel.photos(repo.root(), repo.me).count { it.day == day && it.by == app.belong.couple.core.Owner.ME }
    }

    /**
     * Adds the pictures at [uris] as today's photos. [done] gets how many were added: fewer than asked
     * when a picture can't be read or today's limit is reached.
     */
    fun add(context: Context, uris: List<Uri>, caption: String, done: (Int) -> Unit) {
        val app = context.applicationContext
        pool.execute {
            val day = today()
            val room = (PhotosModel.PER_DAY - mineOn(app, day)).coerceAtLeast(0)
            var added = 0
            for (uri in uris.take(room)) {
                val bitmap = try {
                    decode(app, uri)
                } catch (e: Exception) {
                    null
                } ?: continue
                val key = newKey()
                save(app, key, bitmap)
                bitmap.recycle()
                val repo = SharedRepo(app)
                repo.put("photos/$day/$key", JSONObject()
                    .put("by", seatKey(repo.me, mine = true))
                    .put("at", System.currentTimeMillis() + added)
                    .put("caption", caption.take(200)))
                if (repo.me != null) mark(app, "upload", key, true)
                added++
            }
            if (added > 0) LiveSync.flushSoon(app)
            main.post {
                DataEvents.changed()
                done(added)
            }
        }
    }

    fun delete(context: Context, key: String, day: Long) {
        val app = context.applicationContext
        val repo = SharedRepo(app)
        repo.delete("photos/$day/$key")
        file(app, key, true).delete()
        file(app, key, false).delete()
        memory.evictAll()
        if (repo.me != null) {
            mark(app, "upload", key, false)
            mark(app, "remove", key, true)
            LiveSync.flushSoon(app)
        }
    }

    private fun mark(app: Context, set: String, key: String, on: Boolean) = synchronized(this) {
        val p = prefs(app)
        val keys = p.getStringSet(set, emptySet())!!.toMutableSet()
        if (on) keys += key else keys -= key
        p.edit().putStringSet(set, keys).apply()
    }

    /** Sends photos added offline and removes deleted ones. Called by LiveSync; throws when offline. */
    fun flush(app: Context, db: Db, code: String, me: String, token: () -> String) {
        for (key in prefs(app).getStringSet("upload", emptySet())!!.toList()) {
            val full = file(app, key, false)
            val thumb = file(app, key, true)
            if (full.exists() && thumb.exists()) {
                try {
                    db.put("pairs/$code/photo_data/$key", JSONObject()
                        .put("by", me)
                        .put("thumb", Base64.encodeToString(thumb.readBytes(), Base64.NO_WRAP))
                        .put("full", Base64.encodeToString(full.readBytes(), Base64.NO_WRAP)), token())
                } catch (e: CloudException) {
                    // Already uploaded (photos can't be overwritten) or refused: nothing more to do.
                    if (e.reason != Reason.DENIED && e.reason != Reason.OTHER) throw e
                }
            }
            mark(app, "upload", key, false)
        }
        for (key in prefs(app).getStringSet("remove", emptySet())!!.toList()) {
            try {
                db.delete("pairs/$code/photo_data/$key", token())
            } catch (e: CloudException) {
                if (e.reason != Reason.DENIED && e.reason != Reason.OTHER) throw e
            }
            mark(app, "remove", key, false)
        }
    }

    /** Shows photo [key] in [view]: from the phone when it's there, otherwise fetched once from the pair's database. */
    fun load(view: ImageView, key: String, thumb: Boolean) {
        val id = "$key/$thumb"
        view.tag = id
        memory.get(id)?.let {
            view.setImageBitmap(it)
            return
        }
        view.setImageDrawable(null)
        val app = view.context.applicationContext
        pool.execute {
            val bitmap = try {
                val f = file(app, key, thumb)
                if (!f.exists()) fetch(app, key, thumb, f)
                if (f.exists()) BitmapFactory.decodeFile(f.path) else null
            } catch (e: Exception) {
                null
            }
            if (bitmap != null) memory.put(id, bitmap)
            main.post {
                if (view.tag == id && bitmap != null) {
                    view.alpha = 0f
                    view.setImageBitmap(bitmap)
                    view.animate().alpha(1f).setDuration(160).start()
                }
            }
        }
    }

    /** The picture as a bitmap, for the month story card; null when it isn't on this phone yet. */
    fun bitmap(context: Context, key: String, thumb: Boolean): Bitmap? {
        val app = context.applicationContext
        val f = file(app, key, thumb)
        return try {
            if (!f.exists()) fetch(app, key, thumb, f)
            if (f.exists()) BitmapFactory.decodeFile(f.path) else null
        } catch (e: Exception) {
            null
        }
    }

    private fun fetch(app: Context, key: String, thumb: Boolean, target: File) {
        val account = Account.get(app)
        val seat = account.seat ?: return
        if (!account.paired) return
        val data = Db(account.config).get("pairs/${seat.code}/photo_data/$key/${if (thumb) "thumb" else "full"}", account.token()) as? String ?: return
        val bytes = Base64.decode(data, Base64.DEFAULT)
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeBytes(bytes)
        tmp.renameTo(target)
    }

    /** Reads the picture no larger than needed and turns it upright. */
    private fun decode(app: Context, uri: Uri): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        app.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= FULL_PX) sample *= 2
        val raw = app.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val rotation = try {
            app.contentResolver.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        } catch (e: Exception) {
            0f
        }
        val scale = minOf(1f, FULL_PX.toFloat() / maxOf(raw.width, raw.height))
        if (rotation == 0f && scale == 1f) return raw
        val m = Matrix().apply {
            postScale(scale, scale)
            postRotate(rotation)
        }
        return Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true).also { if (it !== raw) raw.recycle() }
    }

    private fun save(app: Context, key: String, bitmap: Bitmap) {
        file(app, key, false).writeBytes(jpeg(bitmap, MAX_FULL))
        val s = THUMB_PX.toFloat() / minOf(bitmap.width, bitmap.height)
        val thumb = if (s < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * s).toInt().coerceAtLeast(1), (bitmap.height * s).toInt().coerceAtLeast(1), true) else bitmap
        file(app, key, true).writeBytes(jpeg(thumb, MAX_THUMB))
        if (thumb !== bitmap) thumb.recycle()
    }

    /** JPEG bytes whose base64 text fits [maxBase64] characters, lowering the quality as needed. */
    private fun jpeg(bitmap: Bitmap, maxBase64: Int): ByteArray {
        var quality = 82
        while (true) {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            val bytes = out.toByteArray()
            if ((bytes.size + 2) / 3 * 4 <= maxBase64 || quality <= 30) return bytes
            quality -= 12
        }
    }

    private fun newKey(): String = System.currentTimeMillis().toString(36) + (1000..9999).random().toString(36)

    /** The example couple's photos: soft gradients with an emoji, drawn on the phone. */
    fun seedDemo(context: Context, seeds: List<String>) {
        val app = context.applicationContext
        val repo = SharedRepo(app)
        val today = today()
        seeds.forEachIndexed { i, line ->
            val (emoji, daysAgo, owner, caption) = line.split('|', limit = 4)
            val key = "demo-p$i"
            val day = today - daysAgo.toLong()
            val bmp = drawDemo(emoji, i)
            save(app, key, bmp)
            bmp.recycle()
            repo.put("photos/$day/$key", JSONObject().put("by", owner).put("at", System.currentTimeMillis() - daysAgo.toLong() * 86_400_000L + i).put("caption", caption))
        }
    }

    private val DEMO_COLORS = listOf(
        0xFFFFB4C6.toInt() to 0xFFFFD9A0.toInt(),
        0xFFA8C8FF.toInt() to 0xFFC9B6FF.toInt(),
        0xFFB8E8C8.toInt() to 0xFFA8D8FF.toInt(),
        0xFFFFD2A8.toInt() to 0xFFFF9FB8.toInt(),
        0xFFD7C2FF.toInt() to 0xFFFFC2E2.toInt(),
    )

    private fun drawDemo(emoji: String, i: Int): Bitmap {
        val w = 720
        val h = 880
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val (a, b) = DEMO_COLORS[i % DEMO_COLORS.size]
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), Paint().apply { shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), a, b, Shader.TileMode.CLAMP) })
        c.drawText(emoji, w / 2f, h / 2f + 90f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 260f
            textAlign = Paint.Align.CENTER
        })
        return bmp
    }
}
