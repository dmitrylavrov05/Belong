package app.belong.couple.data

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.location.Geocoder
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.LruCache
import android.util.Size
import app.belong.couple.core.GeoPhoto
import app.belong.couple.core.Geo
import app.belong.couple.core.PhotoClusters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.Executors

/** Finds photos in the gallery that carry a GPS location. Locations never leave the phone. */
object PhotoScanner {
    const val LIMIT = 3000

    fun permissions(): Array<String> = when {
        Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.ACCESS_MEDIA_LOCATION)
        Build.VERSION.SDK_INT >= 29 -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.ACCESS_MEDIA_LOCATION)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    private fun granted(context: Context, permission: String) =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    /** True when the app can read at least some photos (on Android 14 the person may share only a selection). */
    fun canRead(context: Context): Boolean = when {
        Build.VERSION.SDK_INT >= 34 -> granted(context, Manifest.permission.READ_MEDIA_IMAGES) ||
            granted(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= 33 -> granted(context, Manifest.permission.READ_MEDIA_IMAGES)
        else -> granted(context, Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    /** Without this permission Android 10+ hides the location inside photos. */
    fun canReadLocation(context: Context): Boolean =
        Build.VERSION.SDK_INT < 29 || granted(context, Manifest.permission.ACCESS_MEDIA_LOCATION)

    private fun cacheFile(context: Context) = File(context.filesDir, "photo-places.json")

    private data class Cached(val modified: Long, val lat: Double, val lon: Double)

    private fun loadCache(context: Context): MutableMap<Long, Cached> {
        val map = HashMap<Long, Cached>()
        val file = cacheFile(context)
        if (!file.exists()) return map
        try {
            val array = JSONArray(file.readText())
            for (i in 0 until array.length()) {
                val o = array.getJSONObject(i)
                map[o.getLong("id")] = Cached(o.getLong("m"), o.optDouble("lat"), o.optDouble("lon"))
            }
        } catch (e: org.json.JSONException) {
            file.delete()
        }
        return map
    }

    private fun saveCache(context: Context, cache: Map<Long, Cached>) {
        val array = JSONArray()
        cache.forEach { (id, c) ->
            array.put(JSONObject().put("id", id).put("m", c.modified).put("lat", c.lat.takeUnless { it.isNaN() } ?: JSONObject.NULL)
                .put("lon", c.lon.takeUnless { it.isNaN() } ?: JSONObject.NULL))
        }
        cacheFile(context).writeText(array.toString())
    }

    /**
     * Reads the newest [LIMIT] photos and returns the ones with a location.
     * Already-read photos come from a cache keyed by modification time, so a rescan is quick.
     * Runs on a background thread.
     */
    fun scan(context: Context, onProgress: (done: Int, total: Int) -> Unit): List<GeoPhoto> {
        val resolver = context.contentResolver
        val collection: Uri = if (Build.VERSION.SDK_INT >= 29) MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_MODIFIED)
        val cache = loadCache(context)
        val seen = HashSet<Long>()
        val found = mutableListOf<GeoPhoto>()
        val readLocation = canReadLocation(context)
        resolver.query(collection, projection, null, null, "${MediaStore.Images.Media.DATE_TAKEN} DESC")?.use { c ->
            val total = minOf(c.count, LIMIT)
            val idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val takenCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val modCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED)
            var done = 0
            while (c.moveToNext() && done < LIMIT) {
                val id = c.getLong(idCol)
                val modified = c.getLong(modCol)
                val uri = ContentUris.withAppendedId(collection, id)
                seen += id
                val cached = cache[id]?.takeIf { it.modified == modified }
                val (lat, lon) = if (cached != null) cached.lat to cached.lon else {
                    val ll = readLatLong(context, uri, readLocation)
                    cache[id] = Cached(modified, ll?.get(0) ?: Double.NaN, ll?.get(1) ?: Double.NaN)
                    (ll?.get(0) ?: Double.NaN) to (ll?.get(1) ?: Double.NaN)
                }
                if (PhotoClusters.isValid(lat, lon)) {
                    val taken = c.getLong(takenCol).takeIf { it > 0 } ?: modified * 1000
                    found += GeoPhoto(id, uri.toString(), lat, lon, taken)
                }
                done += 1
                if (done % 25 == 0 || done == total) onProgress(done, total)
            }
        }
        cache.keys.retainAll(seen)
        saveCache(context, cache)
        return found
    }

    private fun readLatLong(context: Context, uri: Uri, readLocation: Boolean): DoubleArray? = try {
        val source = if (Build.VERSION.SDK_INT >= 29 && readLocation) MediaStore.setRequireOriginal(uri) else uri
        context.contentResolver.openInputStream(source)?.use { stream ->
            val out = FloatArray(2)
            if (ExifInterface(stream).getLatLong(out)) doubleArrayOf(out[0].toDouble(), out[1].toDouble()) else null
        }
    } catch (e: Exception) {
        // Unreadable or unsupported file: treat it as a photo without a location.
        null
    }
}

/** Small square previews for map markers and the photo grid, cached in memory. */
object Thumbs {
    private val cache = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val pool = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private val loading = HashSet<String>()
    private val failed = HashSet<String>()

    fun cached(uri: String): Bitmap? = cache.get(uri)

    fun put(uri: String, bitmap: Bitmap) {
        cache.put(uri, bitmap)
    }

    /** Loads a thumbnail in the background and calls [done] on the main thread. */
    fun load(context: Context, uri: String, size: Int, done: (Bitmap?) -> Unit) {
        cache.get(uri)?.let { done(it); return }
        if (uri in failed || !loading.add(uri)) return
        val app = context.applicationContext
        pool.execute {
            val bitmap = try {
                val u = Uri.parse(uri)
                if (Build.VERSION.SDK_INT >= 29) app.contentResolver.loadThumbnail(u, Size(size, size), null)
                else app.contentResolver.openInputStream(u)?.use { s ->
                    BitmapFactory.decodeStream(s, null, BitmapFactory.Options().apply { inSampleSize = 8 })
                }
            } catch (e: Exception) {
                null
            }
            main.post {
                loading.remove(uri)
                if (bitmap != null) cache.put(uri, bitmap) else failed += uri
                done(bitmap)
            }
        }
    }

    /** A placeholder picture for the example places: a soft gradient with an emoji. */
    fun example(emoji: String, size: Int, start: Int, end: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = LinearGradient(0f, 0f, size.toFloat(), size.toFloat(), start, end, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, size.toFloat(), size.toFloat(), paint)
        paint.shader = null
        paint.textSize = size * 0.5f
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText(emoji, size / 2f, size * 0.68f, paint)
        return bitmap
    }
}

/** Turns coordinates into a short place name, using the phone's geocoder when it has one. */
object PlaceNames {
    private val names = HashMap<String, String>()
    private val pool = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private fun key(lat: Double, lon: Double) = String.format(Locale.ROOT, "%.2f,%.2f", lat, lon)

    fun quick(lat: Double, lon: Double, language: String): String =
        names[key(lat, lon)]
            ?: Geo.nearestCity(lat, lon)?.name(language)
            ?: String.format(Locale.ROOT, "%.2f°, %.2f°", lat, lon)

    @Suppress("DEPRECATION")
    fun resolve(context: Context, lat: Double, lon: Double, locale: Locale, done: (String) -> Unit) {
        val k = key(lat, lon)
        names[k]?.let { done(it); return }
        if (!Geocoder.isPresent()) return
        val app = context.applicationContext
        pool.execute {
            val name = try {
                Geocoder(app, locale).getFromLocation(lat, lon, 1)?.firstOrNull()?.let { a ->
                    listOfNotNull(a.locality ?: a.subAdminArea ?: a.adminArea, a.countryName).distinct().joinToString(", ")
                }?.takeIf { it.isNotBlank() }
            } catch (e: Exception) {
                null
            }
            if (name != null) main.post {
                names[k] = name
                done(name)
            }
        }
    }
}
