package app.belong.couple.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Shows pictures from the web (Unsplash, Pinterest previews) in an ImageView: kept in memory and
 * in the app's cache folder, decoded no larger than the view needs.
 */
object RemoteImage {
    private val pool = Executors.newFixedThreadPool(3)
    private val main = Handler(Looper.getMainLooper())
    private val memory = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 8 / 1024).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }

    /** Loads [url] into [view]; a view reused for another url in the meantime is left alone. */
    fun load(view: ImageView, url: String, maxPx: Int) {
        val key = "$url@$maxPx"
        view.tag = key
        memory.get(key)?.let {
            view.setImageBitmap(it)
            return
        }
        view.setImageDrawable(null)
        val cacheDir = File(view.context.cacheDir, "pictures")
        pool.execute {
            val bitmap = try {
                val file = File(cacheDir.apply { mkdirs() }, sha1(url))
                if (!file.exists()) download(url, file)
                decode(file, maxPx)
            } catch (e: IOException) {
                null
            }
            if (bitmap != null) memory.put(key, bitmap)
            main.post {
                if (view.tag == key && bitmap != null) {
                    view.alpha = 0f
                    view.setImageBitmap(bitmap)
                    view.animate().alpha(1f).setDuration(180).start()
                }
            }
        }
    }

    private fun download(url: String, file: File) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            if (conn.responseCode !in 200..299) throw IOException("HTTP ${conn.responseCode}")
            val tmp = File(file.parentFile, file.name + ".tmp")
            var total = 0L
            conn.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > 8L * 1024 * 1024) throw IOException("Too large")
                        out.write(buf, 0, n)
                    }
                }
            }
            tmp.renameTo(file)
        } finally {
            conn.disconnect()
        }
    }

    private fun decode(file: File, maxPx: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0) {
            file.delete() // not an image: try again next time
            return null
        }
        var sample = 1
        while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun sha1(s: String): String =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
