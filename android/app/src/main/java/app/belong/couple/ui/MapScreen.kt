package app.belong.couple.ui

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.core.GeoPhoto
import app.belong.couple.core.MapCluster
import app.belong.couple.core.Mercator
import app.belong.couple.core.PhotoClusters
import app.belong.couple.core.Place
import app.belong.couple.data.PhotoScanner
import app.belong.couple.data.PlaceNames
import app.belong.couple.data.Thumbs
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors
import kotlin.math.hypot
import kotlin.math.min

/** Land outlines from the bundled Natural Earth data, as paths in Mercator unit coordinates. */
object WorldShape {
    class Ring(val path: Path, val bounds: RectF)

    private val cache = HashMap<String, List<Ring>>()

    fun load(context: Context, asset: String): List<Ring> = cache.getOrPut(asset) {
        DataInputStream(BufferedInputStream(context.assets.open(asset))).use { input ->
            val magic = ByteArray(4)
            input.readFully(magic)
            require(String(magic) == "BLW1") { "Unknown map format" }
            val count = input.readInt()
            List(count) {
                val points = input.readInt()
                val path = Path()
                for (i in 0 until points) {
                    val x = Mercator.x(input.readShort() / 100.0).toFloat()
                    val y = Mercator.y(input.readShort() / 100.0).toFloat()
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                path.close()
                val bounds = RectF()
                @Suppress("DEPRECATION")
                path.computeBounds(bounds, true)
                Ring(path, bounds)
            }
        }
    }
}

/** A pannable, zoomable world map that shows photos as round thumbnails, grouped when they overlap. */
class WorldMapView(context: Context) : View(context) {
    var onClusterTap: ((MapCluster) -> Unit)? = null
    var photos: List<GeoPhoto> = emptyList()
        set(value) {
            field = value
            clustersDirty = true
            invalidate()
        }

    private var zoom = 1f
    private var offX = 0f
    private var offY = 0f
    private var pendingFit: List<GeoPhoto>? = null
    private var clusters: List<MapCluster> = emptyList()
    private var clustersDirty = true

    private val coarse by lazy { WorldShape.load(context, "map/world-land-coarse.bin") }
    private val detailed by lazy { WorldShape.load(context, "map/world-land.bin") }

    private val ocean = context.col(R.color.him_tint)
    private val landPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = context.col(R.color.surface) }
    private val coastPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 0f
        color = context.col(R.color.line)
    }
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = context.col(R.color.white)
        setShadowLayer(context.dp(4).toFloat(), 0f, context.dp(1).toFloat(), 0x40000000)
    }
    private val photoPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val fallbackPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = context.col(R.color.us_start) }
    private val badgeText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = context.col(R.color.white)
        textAlign = Paint.Align.CENTER
        textSize = context.dp(11).toFloat()
        typeface = Fonts.get(context, 800)
    }
    private val markerR = context.dp(22).toFloat()
    private val shaderMatrix = Matrix()
    private val visible = RectF()

    init {
        // Software drawing has no texture size limit, so the coastline stays visible at any zoom.
        setLayerType(LAYER_TYPE_SOFTWARE, null)
        contentDescription = context.getString(R.string.map_canvas)
    }

    private val worldSize get() = width * zoom

    /** Shows all [points] (or most of the world when there are none) once the view has a size. */
    fun fit(points: List<GeoPhoto>) {
        if (width == 0 || height == 0) {
            pendingFit = points
            return
        }
        pendingFit = null
        if (points.isEmpty()) {
            zoom = 1.3f
            centerOn(Mercator.x(10.0), Mercator.y(35.0))
            return
        }
        val xs = points.map { Mercator.x(it.lon) }
        val ys = points.map { Mercator.y(it.lat) }
        val spanX = ((xs.max() - xs.min()) * 1.4).coerceAtLeast(0.02)
        val spanY = ((ys.max() - ys.min()) * 1.4).coerceAtLeast(0.02)
        zoom = min(1.0 / spanX, height / (width * spanY)).toFloat().coerceIn(1f, 40f)
        clustersDirty = true
        centerOn((xs.max() + xs.min()) / 2, (ys.max() + ys.min()) / 2)
    }

    private fun centerOn(mx: Double, my: Double) {
        offX = (width / 2f - mx * worldSize).toFloat()
        offY = (height / 2f - my * worldSize).toFloat()
        clamp()
        invalidate()
    }

    private fun clamp() {
        val s = worldSize
        offX = offX.coerceIn(width - s, 0f)
        offY = if (s >= height) offY.coerceIn(height - s, 0f) else (height - s) / 2f
    }

    fun zoomBy(factor: Float, fx: Float = width / 2f, fy: Float = height / 2f) {
        val next = (zoom * factor).coerceIn(1f, 60f)
        val real = next / zoom
        offX = fx - (fx - offX) * real
        offY = fy - (fy - offY) * real
        zoom = next
        clamp()
        clustersDirty = true
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val fit = pendingFit
        if (fit != null) fit(fit) else if (oldw == 0) fit(photos) else {
            clamp()
            clustersDirty = true
        }
    }

    private fun recluster() {
        val s = worldSize
        // Clustering ignores panning: positions are relative to the world's top-left corner.
        val positions = photos.map { (Mercator.x(it.lon) * s).toFloat() to (Mercator.y(it.lat) * s).toFloat() }
        clusters = PhotoClusters.cluster(photos, positions, markerR * 1.8f)
        clustersDirty = false
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawColor(ocean)
        val s = worldSize
        visible.set(-offX / s, -offY / s, (width - offX) / s, (height - offY) / s)
        canvas.save()
        canvas.translate(offX, offY)
        canvas.scale(s, s)
        for (ring in if (zoom > 3f) detailed else coarse) {
            if (!RectF.intersects(ring.bounds, visible)) continue
            canvas.drawPath(ring.path, landPaint)
            canvas.drawPath(ring.path, coastPaint)
        }
        canvas.restore()

        if (clustersDirty) recluster()
        for (c in clusters) drawMarker(canvas, c)
    }

    private fun drawMarker(canvas: Canvas, c: MapCluster) {
        val x = c.x + offX
        val y = c.y + offY
        if (x < -markerR * 2 || y < -markerR * 2 || x > width + markerR * 2 || y > height + markerR * 2) return
        val photo = c.photos.first()
        canvas.drawCircle(x, y, markerR + context.dp(3), ringPaint)
        val bitmap = Thumbs.cached(photo.uri)
        if (bitmap != null) {
            val side = min(bitmap.width, bitmap.height).toFloat()
            val scale = markerR * 2 / side
            shaderMatrix.reset()
            shaderMatrix.setScale(scale, scale)
            shaderMatrix.postTranslate(x - bitmap.width * scale / 2, y - bitmap.height * scale / 2)
            photoPaint.shader = BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply { setLocalMatrix(shaderMatrix) }
            canvas.drawCircle(x, y, markerR, photoPaint)
        } else {
            fallbackPaint.shader = LinearGradient(x - markerR, y - markerR, x + markerR, y + markerR,
                context.col(R.color.her), context.col(R.color.him), Shader.TileMode.CLAMP)
            canvas.drawCircle(x, y, markerR, fallbackPaint)
            Thumbs.load(context, photo.uri, 160) { if (it != null) invalidate() }
        }
        if (c.photos.size > 1) {
            val bx = x + markerR * 0.8f
            val by = y - markerR * 0.8f
            val label = if (c.photos.size > 99) "99+" else c.photos.size.toString()
            val r = maxOf(context.dp(11).toFloat(), badgeText.measureText(label) / 2 + context.dp(5))
            canvas.drawCircle(bx, by, r, badgePaint)
            canvas.drawText(label, bx, by + badgeText.textSize / 3, badgeText)
        }
    }

    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            zoomBy(detector.scaleFactor, detector.focusX, detector.focusY)
            return true
        }
    })

    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean = true

        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
            offX -= distanceX
            offY -= distanceY
            clamp()
            invalidate()
            return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
            zoomBy(2f, e.x, e.y)
            return true
        }

        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            val hit = clusters.minByOrNull { hypot(it.x + offX - e.x, it.y + offY - e.y) }
            if (hit != null && hypot(hit.x + offX - e.x, hit.y + offY - e.y) <= markerR * 1.4f) {
                onClusterTap?.invoke(hit)
                return true
            }
            return false
        }
    })

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) parent?.requestDisallowInterceptTouchEvent(true)
        scaleDetector.onTouchEvent(event)
        if (!scaleDetector.isInProgress) gestures.onTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            parent?.requestDisallowInterceptTouchEvent(false)
        }
        return true
    }
}

/** "Our places": photos with a location from the gallery on a world map. */
class MapScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()

    private val map = WorldMapView(ctx)
    private val status = ctx.text("", 14f, 600, ctx.col(R.color.on_tint))
    private val action = FrameLayout(ctx)
    private val places = ctx.column(10)
    private var photos: List<GeoPhoto> = emptyList()
    private var example = true
    private var scanning = false
    private var scanned = false
    private var exampleNames: List<Pair<GeoPhoto, String>> = emptyList()

    override val view: View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(ctx.column(14).apply {
            val side = ctx.dp(20)
            setPadding(side, ctx.dp(16), side, ctx.dp(28))
            addView(ctx.text(ctx.getString(R.string.map_title), 28f, 800).apply { letterSpacing = -0.02f })
            addView(ctx.text(ctx.getString(R.string.map_text), 15f, 400, ctx.col(R.color.ink2)))
            addView(status)
            addView(mapCard())
            addView(action)
            addView(places)
        })
    }

    init {
        map.onClusterTap = { cluster -> showPhotos(cluster.photos) }
    }

    private fun mapCard(): View = FrameLayout(ctx).apply {
        background = ctx.rounded(ctx.col(R.color.him_tint), 24f)
        clipToOutline = true
        addView(map, FrameLayout.LayoutParams(MATCH, MATCH))
        val zoom = ctx.column(8).apply { setPadding(0, 0, ctx.dp(10), ctx.dp(10)) }
        zoom.addView(zoomButton(R.drawable.ic_plus, R.string.map_zoom_in) { map.zoomBy(2f) })
        zoom.addView(zoomButton(R.drawable.ic_minus, R.string.map_zoom_out) { map.zoomBy(0.5f) })
        addView(zoom, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.END or Gravity.BOTTOM))
        layoutParams = LinearLayout.LayoutParams(MATCH, ctx.dp(420))
    }

    private fun zoomButton(iconRes: Int, label: Int, onClick: () -> Unit) = ImageView(ctx).apply {
        setImageDrawable(ctx.icon(iconRes, ctx.col(R.color.ink), 20))
        scaleType = ImageView.ScaleType.CENTER
        contentDescription = ctx.getString(label)
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 24f), 24f)
        elevation = ctx.dp(2).toFloat()
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48))
    }

    override fun refresh() {
        when {
            scanning -> Unit
            PhotoScanner.canRead(ctx) && !scanned -> scan()
            PhotoScanner.canRead(ctx) -> render()
            else -> showExample()
        }
    }

    fun onPermissionsResult() {
        if (PhotoScanner.canRead(ctx)) {
            scanned = false
            scan()
        } else {
            showExample()
            status.text = ctx.getString(R.string.map_denied)
            setAction(ctx.secondaryButton(ctx.getString(R.string.map_open_settings)) {
                ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
            })
        }
    }

    private fun setAction(button: View?) {
        action.removeAllViews()
        if (button != null) action.addView(button, FrameLayout.LayoutParams(MATCH, WRAP))
    }

    private fun scan() {
        scanning = true
        status.text = ctx.getString(R.string.map_scanning, 0, 0)
        setAction(null)
        val app = ctx.applicationContext
        worker.execute {
            val found = try {
                PhotoScanner.scan(app) { done, total -> main.post { status.text = ctx.getString(R.string.map_scanning, done, total) } }
            } catch (e: SecurityException) {
                emptyList()
            }
            main.post {
                scanning = false
                scanned = true
                example = false
                photos = found
                map.photos = found
                map.fit(found)
                render()
            }
        }
    }

    private fun showExample() {
        example = true
        val lines = ctx.resources.getStringArray(R.array.map_examples)
        val now = System.currentTimeMillis()
        val tints = listOf(R.color.her_tint to R.color.him_tint, R.color.him_tint to R.color.her_tint)
        val list = mutableListOf<Pair<GeoPhoto, String>>()
        lines.forEachIndexed { i, line ->
            val p = line.split('|')
            val uri = "example:$i"
            if (Thumbs.cached(uri) == null) {
                val (a, b) = tints[i % 2]
                Thumbs.put(uri, Thumbs.example(ctx, p[2], 160, ctx.col(a), ctx.col(b)))
            }
            repeat(p[4].toInt()) { j ->
                val photo = GeoPhoto(-(i * 1000L + j) - 1, uri, p[0].toDouble() + (j % 5) * 0.004, p[1].toDouble() + (j % 3) * 0.004, now - (i * 40L + j) * 86_400_000L)
                list += photo to p[3]
            }
        }
        exampleNames = list
        photos = list.map { it.first }
        map.photos = photos
        map.fit(photos)
        render()
    }

    private fun render() {
        val placeList = PhotoClusters.places(photos)
        status.text = when {
            example -> ctx.getString(R.string.map_example)
            photos.isEmpty() && !PhotoScanner.canReadLocation(ctx) -> ctx.getString(R.string.map_no_location)
            photos.isEmpty() -> ctx.getString(R.string.map_none)
            else -> "${ctx.resources.getQuantityString(R.plurals.photos, photos.size, photos.size)} · " +
                ctx.resources.getQuantityString(R.plurals.places, placeList.size, placeList.size)
        }
        setAction(
            if (example) ctx.primaryButton(ctx.getString(R.string.map_allow), R.drawable.ic_tab_map) {
                ctx.requestPermissions(PhotoScanner.permissions(), MainActivity.REQUEST_PHOTOS)
            } else ctx.secondaryButton(ctx.getString(R.string.map_rescan)) { scan() },
        )
        places.removeAllViews()
        if (placeList.isEmpty()) return
        places.addView(ctx.text(ctx.getString(R.string.map_places_title), 20f, 800).lp(top = 6))
        placeList.take(12).forEach { places.addView(placeRow(it)) }
    }

    private fun nameOf(place: Place): String =
        if (example) exampleNames.firstOrNull { it.first.id == place.photos.first().id }?.second ?: ""
        else PlaceNames.quick(place.lat, place.lon, ctx.language())

    private fun monthOf(at: Long): String =
        DateTimeFormatter.ofPattern("LLLL yyyy", ctx.locale()).format(Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()))

    private fun placeRow(place: Place): View = ctx.card(paddingDp = 12).apply {
        val row = ctx.row(12)
        val thumb = ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = ctx.rounded(ctx.col(R.color.sunk), 14f)
            clipToOutline = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val first = place.photos.first()
        Thumbs.cached(first.uri)?.let { thumb.setImageBitmap(it) } ?: Thumbs.load(ctx, first.uri, 160) { it?.let(thumb::setImageBitmap) }
        row.addView(thumb, LinearLayout.LayoutParams(ctx.dp(56), ctx.dp(56)))
        val texts = ctx.column(2)
        val name: TextView = ctx.text(nameOf(place), 16f, 700)
        texts.addView(name)
        texts.addView(ctx.text("${ctx.resources.getQuantityString(R.plurals.photos, place.photos.size, place.photos.size)} · ${monthOf(first.takenAt)}", 13f, 500, ctx.col(R.color.ink2)))
        row.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(row)
        if (!example) PlaceNames.resolve(ctx, place.lat, place.lon, ctx.locale()) { name.text = it }
        isClickable = true
        background = ctx.ripple(background, 24f)
        setOnClickListener { showPhotos(place.photos) }
    }

    private fun showPhotos(list: List<GeoPhoto>) {
        val first = list.first()
        val grid = GridLayout(ctx).apply {
            columnCount = 3
            val p = ctx.dp(12)
            setPadding(p, p, p, p)
        }
        val cell = (ctx.resources.displayMetrics.widthPixels - ctx.dp(96)) / 3
        list.take(60).forEach { photo ->
            val image = ImageView(ctx).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = ctx.rounded(ctx.col(R.color.sunk), 12f)
                clipToOutline = true
                contentDescription = monthOf(photo.takenAt)
                setOnClickListener { openPhoto(photo) }
            }
            Thumbs.cached(photo.uri)?.let { image.setImageBitmap(it) } ?: Thumbs.load(ctx, photo.uri, 240) { it?.let(image::setImageBitmap) }
            grid.addView(image, GridLayout.LayoutParams().apply {
                width = cell
                height = cell
                setMargins(ctx.dp(3), ctx.dp(3), ctx.dp(3), ctx.dp(3))
            })
        }
        val title = if (example) exampleNames.firstOrNull { it.first.id == first.id }?.second ?: ""
        else PlaceNames.quick(first.lat, first.lon, ctx.language())
        val dialog = AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(ctx.resources.getQuantityString(R.plurals.photos, list.size, list.size))
            .setView(ScrollView(ctx).apply { addView(grid) })
            .setPositiveButton(android.R.string.ok, null)
            .show()
        if (!example) PlaceNames.resolve(ctx, first.lat, first.lon, ctx.locale()) { dialog.setTitle(it) }
    }

    private fun openPhoto(photo: GeoPhoto) {
        if (photo.uri.startsWith("example:")) {
            ctx.toast(ctx.getString(R.string.map_example_photo))
            return
        }
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(photo.uri), "image/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (e: ActivityNotFoundException) {
            ctx.toast(photo.uri)
        }
    }
}
