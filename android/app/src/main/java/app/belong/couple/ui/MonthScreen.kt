package app.belong.couple.ui

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.DayPhoto
import app.belong.couple.core.Highlights
import app.belong.couple.core.MonthStats
import app.belong.couple.core.PhotosModel
import app.belong.couple.core.Recap
import app.belong.couple.core.ReportModel
import app.belong.couple.core.TimeMath
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import app.belong.couple.share.StoryProvider
import java.io.File
import java.io.FileOutputStream
import java.text.NumberFormat
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter

/** Draws the 1080×1920 "our month" card for stories. Colours are fixed so it looks the same in dark mode. */
object StoryRenderer {
    const val WIDTH = 1080
    const val HEIGHT = 1920

    private const val INK = 0xFF2B2233.toInt()
    private const val INK2 = 0xFF6A5F70.toInt()
    private const val ON_TINT = 0xFF5E5466.toInt()

    data class Row(val emoji: String, val label: String, val value: String)

    fun monthName(context: Context, month: YearMonth): String =
        DateTimeFormatter.ofPattern("LLLL", context.locale()).format(month)

    /** At most five rows: distance and time zones for a couple apart, what you did together for everyone. */
    fun rows(context: Context, s: MonthStats, h: Highlights?, apart: Boolean, withKm: Boolean): List<Row> {
        val nf = NumberFormat.getIntegerInstance(context.locale())
        val rows = mutableListOf<Row>()
        if (apart) {
            if (withKm) rows += Row("📍", context.getString(R.string.stat_km), nf.format(s.km))
            s.daysToMeeting?.let { days -> rows += Row("⏳", context.resources.getQuantityString(R.plurals.days_until_label, days.toInt()), nf.format(days)) }
        }
        if (h != null && h.photos > 0 && withKm) rows += Row("📸", context.getString(R.string.stat_photos), nf.format(h.photos))
        rows += Row("💗", context.getString(R.string.stat_taps), nf.format(s.tapsSent + s.tapsReceived))
        if (h != null && h.dreams.size + h.goals.size > 0) rows += Row("✨", context.getString(R.string.stat_dreams), nf.format(h.dreams.size + h.goals.size))
        if (h != null && h.questions > 0) rows += Row("💬", context.getString(R.string.stat_questions), nf.format(h.questions))
        rows += Row("✏️", context.getString(R.string.stat_doodles), nf.format(s.doodles))
        if (apart) rows += Row("🕒", context.getString(R.string.stat_hours), context.getString(R.string.hours_short, TimeMath.formatHours(s.hoursApart)))
        rows += Row(Recap.emojiForAverage(s.averageMood), context.getString(R.string.stat_mood), "")
        return rows.take(5)
    }

    fun render(context: Context, s: MonthStats, me: String, partner: String, apart: Boolean = true, h: Highlights? = null, photos: List<Bitmap> = emptyList()): Bitmap {
        val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val bg = Paint().apply {
            shader = LinearGradient(0f, 0f, 0f, HEIGHT.toFloat(), intArrayOf(0xFFFDE2EB.toInt(), 0xFFFFF8F3.toInt(), 0xFFE1EDFD.toInt()), null, Shader.TileMode.CLAMP)
        }
        canvas.drawRect(0f, 0f, WIDTH.toFloat(), HEIGHT.toFloat(), bg)

        // Two people, one arc between them.
        val mark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 10f
            strokeCap = Paint.Cap.ROUND
            color = INK
        }
        canvas.drawArc(RectF(420f, 150f, 660f, 330f), 200f, 140f, false, mark)
        mark.style = Paint.Style.FILL
        mark.color = 0xFFF07DA1.toInt()
        canvas.drawCircle(432f, 262f, 30f, mark)
        mark.color = 0xFF5C9DF2.toInt()
        canvas.drawCircle(648f, 262f, 30f, mark)

        val title = context.getString(if (apart) R.string.story_title else R.string.story_title_together, monthName(context, s.month))
        var y = drawCentered(canvas, context, title, 76f, 800, INK, 380f, 920)
        y = drawCentered(canvas, context, context.getString(R.string.couple_line, me, partner), 44f, 600, INK2, y + 20f, 920)

        if (photos.isNotEmpty()) {
            y = drawPolaroids(canvas, photos.take(3), y + 60f)
        } else {
            val nf = NumberFormat.getIntegerInstance(context.locale())
            val (number, label) = when {
                apart -> nf.format(s.km) to context.getString(R.string.stat_km)
                else -> nf.format(s.tapsSent + s.tapsReceived) to context.getString(R.string.stat_taps)
            }
            val big = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = Fonts.get(context, 800)
                textSize = 210f
                textAlign = Paint.Align.CENTER
                shader = LinearGradient(200f, 0f, 880f, 0f, 0xFFC93F76.toInt(), 0xFF2F6BC8.toInt(), Shader.TileMode.CLAMP)
            }
            while (big.measureText(number) > 960f && big.textSize > 120f) big.textSize -= 10f
            val bigBaseline = y + 70f + big.textSize * 0.8f
            canvas.drawText(number, WIDTH / 2f, bigBaseline, big)
            y = drawCentered(canvas, context, label, 48f, 700, ON_TINT, bigBaseline + 30f, 920)
        }

        val card = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFFFFFFFF.toInt()
            setShadowLayer(24f, 0f, 8f, 0x14000000)
        }
        val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(context, 600)
            textSize = 40f
            color = INK
        }
        val valuePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(context, 800)
            textSize = 48f
            color = INK
            textAlign = Paint.Align.RIGHT
        }
        val emojiPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 52f }
        var top = y + 56f
        for (row in rows(context, s, h, apart, withKm = photos.isNotEmpty())) {
            if (top + 118f > HEIGHT - 170f) break
            canvas.drawRoundRect(RectF(90f, top, 990f, top + 118f), 40f, 40f, card)
            val baseline = top + 76f
            canvas.drawText(row.emoji, 130f, baseline, emojiPaint)
            val valueWidth = valuePaint.measureText(row.value)
            val label = ellipsize(row.label, labelPaint, 950f - 220f - valueWidth - 30f)
            canvas.drawText(label, 220f, baseline - 4f, labelPaint)
            canvas.drawText(row.value, 950f, baseline, valuePaint)
            top += 136f
        }

        drawCentered(canvas, context, context.getString(R.string.story_footer), 40f, 700, INK2, HEIGHT - 120f, 920)
        return bitmap
    }

    /** Up to three photos as slightly tilted polaroids; returns the bottom edge. */
    private fun drawPolaroids(canvas: Canvas, photos: List<Bitmap>, top: Float): Float {
        val w = 290f
        val h = 350f
        val gap = 24f
        val total = photos.size * w + (photos.size - 1) * gap
        val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFFFFFFFF.toInt()
            setShadowLayer(28f, 0f, 10f, 0x22000000)
        }
        val tilts = if (photos.size == 1) listOf(-3f) else listOf(-5f, 2f, 6f)
        photos.forEachIndexed { i, photo ->
            val left = (WIDTH - total) / 2f + i * (w + gap)
            canvas.save()
            canvas.rotate(tilts[i % tilts.size], left + w / 2, top + h / 2)
            canvas.drawRoundRect(RectF(left, top, left + w, top + h), 12f, 12f, frame)
            val inner = RectF(left + 16f, top + 16f, left + w - 16f, top + h - 60f)
            val scale = maxOf(inner.width() / photo.width, inner.height() / photo.height)
            val sw = inner.width() / scale
            val sh = inner.height() / scale
            val src = android.graphics.Rect(((photo.width - sw) / 2).toInt(), ((photo.height - sh) / 2).toInt(), ((photo.width + sw) / 2).toInt(), ((photo.height + sh) / 2).toInt())
            canvas.drawBitmap(photo, src, inner, Paint(Paint.FILTER_BITMAP_FLAG))
            canvas.restore()
        }
        return top + h + 20f
    }

    private fun ellipsize(text: String, paint: Paint, maxWidth: Float): String {
        if (paint.measureText(text) <= maxWidth) return text
        var t = text
        while (t.length > 1 && paint.measureText("$t…") > maxWidth) t = t.dropLast(1)
        return "$t…"
    }

    /** Draws wrapped, centred text with its top at [top]; returns the bottom edge. */
    private fun drawCentered(canvas: Canvas, context: Context, text: String, size: Float, weight: Int, color: Int, top: Float, width: Int): Float {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(context, weight)
            textSize = size
            this.color = color
        }
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setLineSpacing(0f, 1.05f)
            .build()
        canvas.save()
        canvas.translate((WIDTH - width) / 2f, top)
        layout.draw(canvas)
        canvas.restore()
        return top + layout.height
    }
}


/**
 * Month and year reports: your photos of the day as a collage, what you did together, moods and
 * taps, and a story card to share. Distance, time zones and the meeting only for a couple apart.
 */
class MonthScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private var month = TimeMath.recapMonth(LocalDate.now())
    private var yearMode = false
    private val body = ctx.column(14).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(28))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = scroll
    private var story: Bitmap? = null
    private var renderToken = 0

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    /** Opens the report on [m], e.g. from the "results are ready" card. */
    fun show(m: YearMonth) {
        month = m
        yearMode = false
        refresh()
    }

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val apart = store.apart == true
        body.addView(ctx.text(ctx.getString(when { yearMode -> R.string.report_year_title; apart -> R.string.month_title_apart; else -> R.string.month_title }), 28f, 800).apply { letterSpacing = -0.02f })
        body.addView(ctx.text(ctx.getString(R.string.couple_line, store.myName, store.partnerDisplay), 15f, 500, ctx.col(R.color.ink2)))
        body.addView(ctx.segmented(listOf(ctx.getString(R.string.report_month), ctx.getString(R.string.report_year)), if (yearMode) 1 else 0) {
            yearMode = it == 1
            refresh()
        })
        body.addView(switcher())
        if (yearMode) year(apart) else month(apart)
        scroll.post { scroll.scrollTo(0, y) }
    }

    private fun switcher(): View = ctx.row(4).apply {
        val now = YearMonth.now()
        val canNext = if (yearMode) month.year < now.year else month < now
        addView(arrow(R.drawable.ic_back, ctx.getString(R.string.calendar_prev), true) {
            month = if (yearMode) month.minusYears(1) else month.minusMonths(1)
            refresh()
        })
        val label = if (yearMode) month.year.toString() else DateTimeFormatter.ofPattern("LLLL yyyy", ctx.locale()).format(month).replaceFirstChar { it.titlecase(ctx.locale()) }
        addView(ctx.text(label, 18f, 700).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(arrow(R.drawable.ic_chevron, ctx.getString(R.string.calendar_next), canNext) {
            month = if (yearMode) minOf(month.plusYears(1), now) else month.plusMonths(1)
            refresh()
        })
    }

    private fun arrow(iconRes: Int, label: String, enabled: Boolean, onClick: () -> Unit): View = ImageView(ctx).apply {
        setImageDrawable(ctx.icon(iconRes, ctx.col(R.color.ink), 20))
        scaleType = ImageView.ScaleType.CENTER
        contentDescription = label
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 22f), 22f)
        isEnabled = enabled
        alpha = if (enabled) 1f else 0.3f
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44))
    }

    private fun month(apart: Boolean) {
        val root = repo.root()
        val s = store.stats(month = month)
        val h = ReportModel.month(root, repo.me, month)
        val photos = PhotosModel.inMonth(PhotosModel.photos(root, repo.me), month)
        if (s.inProgress) {
            body.addView(ctx.text(ctx.getString(R.string.month_in_progress), 13f, 700, ctx.col(R.color.on_tint)).apply {
                background = ctx.rounded(ctx.col(R.color.her_tint), 999f)
                setPadding(ctx.dp(12), ctx.dp(6), ctx.dp(12), ctx.dp(6))
            }.lp(width = WRAP))
        }
        if (store.isExample) body.addView(ctx.text(ctx.getString(R.string.month_example), 13f, 500, ctx.col(R.color.ink2)))

        body.addView(photoBlock(photos, h))

        val nf = NumberFormat.getIntegerInstance(ctx.locale())
        val tiles = mutableListOf<View>()
        if (apart) {
            tiles += stat(nf.format(s.km), ctx.getString(R.string.stat_km))
            tiles += stat(ctx.getString(R.string.hours_short, TimeMath.formatHours(s.hoursApart)), ctx.getString(R.string.stat_hours))
        }
        tiles += stat(nf.format(s.tapsSent + s.tapsReceived), ctx.getString(R.string.stat_taps), ctx.getString(R.string.stat_taps_value, s.tapsSent, s.tapsReceived))
        tiles += stat(nf.format(s.doodles), ctx.getString(R.string.stat_doodles))
        tiles += stat(Recap.emojiForAverage(s.averageMood), ctx.getString(R.string.stat_mood))
        tiles += stat(nf.format(h.questions), ctx.getString(R.string.stat_questions))
        if (h.thanks > 0) tiles += stat(nf.format(h.thanks), ctx.getString(R.string.stat_thanks))
        if (h.talks > 0) tiles += stat(nf.format(h.talks), ctx.getString(R.string.stat_talks))
        if (apart) {
            tiles += stat(nf.format(s.safeCheckins), ctx.getString(R.string.stat_safe))
            if (s.inProgress) s.daysToMeeting?.let { days -> tiles += stat(nf.format(days), ctx.resources.getQuantityString(R.plurals.days_until_label, days.toInt())) }
        }
        grid(tiles)

        listCard(R.string.report_came_true, h.dreams + h.goals)
        listCard(R.string.report_moments, h.moments.map { "📸 $it" })

        storyPreview(s, h, photos, apart)
    }

    private fun year(apart: Boolean) {
        val root = repo.root()
        val y = month.year
        val h = ReportModel.year(root, repo.me, y)
        val all = PhotosModel.inYear(PhotosModel.photos(root, repo.me), y)
        val now = YearMonth.now()
        val months = (1..12).map { YearMonth.of(y, it) }.filter { it <= now }
        val stats = months.map { store.stats(month = it) }

        body.addView(photoBlock(all, h))
        // Twelve months, each with its cover photo.
        val cells = months.map { m ->
            val cover = ReportModel.collage(PhotosModel.inMonth(all, m), 1).firstOrNull()
            FrameLayout(ctx).apply {
                val image = roundedImage(ctx, 16f)
                if (cover != null) DayPhotos.load(image, cover.key, thumb = true)
                addView(image, FrameLayout.LayoutParams(MATCH, ctx.dp(84)))
                addView(ctx.text(DateTimeFormatter.ofPattern("LLL", ctx.locale()).format(m).replaceFirstChar { it.titlecase(ctx.locale()) }, 13f, 800,
                    ctx.col(if (cover != null) R.color.white else R.color.ink2)).apply {
                    setShadowLayer(if (cover != null) 6f else 0f, 0f, 1f, 0x66000000)
                    setPadding(ctx.dp(8), 0, ctx.dp(8), ctx.dp(6))
                }, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.BOTTOM or Gravity.START))
                contentDescription = StoryRenderer.monthName(ctx, m)
                isClickable = true
                foreground = ctx.ripple(android.graphics.drawable.ColorDrawable(0), 16f)
                setOnClickListener { show(m) }
            }
        }
        val gridBox = ctx.column(8)
        cells.chunked(4).forEach { chunk ->
            val row = ctx.row(8)
            chunk.forEach { row.addView(it, LinearLayout.LayoutParams(0, WRAP, 1f)) }
            repeat(4 - chunk.size) { row.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)) }
            gridBox.addView(row)
        }
        body.addView(gridBox)

        val nf = NumberFormat.getIntegerInstance(ctx.locale())
        val moods = months.flatMap { store.moodsIn(it) }
        val tiles = mutableListOf(
            stat(nf.format(stats.sumOf { it.tapsSent + it.tapsReceived }), ctx.getString(R.string.stat_taps)),
            stat(nf.format(stats.sumOf { it.doodles }), ctx.getString(R.string.stat_doodles)),
            stat(nf.format(h.dreams.size), ctx.getString(R.string.stat_dreams)),
            stat(nf.format(h.goals.size), ctx.getString(R.string.stat_goals)),
            stat(nf.format(h.questions), ctx.getString(R.string.stat_questions)),
            stat(Recap.emojiForAverage(Recap.average(moods)), ctx.getString(R.string.stat_mood)),
        )
        if (h.thanks > 0) tiles += stat(nf.format(h.thanks), ctx.getString(R.string.stat_thanks))
        if (h.talks > 0) tiles += stat(nf.format(h.talks), ctx.getString(R.string.stat_talks))
        if (apart) tiles += stat(nf.format(stats.sumOf { it.safeCheckins }), ctx.getString(R.string.stat_safe))
        grid(tiles)
        listCard(R.string.report_came_true, h.dreams + h.goals)
        listCard(R.string.report_moments, h.moments.map { "📸 $it" })
    }

    /** "24 photos · 15 days" and a collage, or a hint to start adding photos. */
    private fun photoBlock(photos: List<DayPhoto>, h: Highlights): View = ctx.card(paddingDp = 14, spacingDp = 10).apply {
        val head = ctx.row(8)
        head.addView(ctx.text(ctx.getString(R.string.photos_title), 17f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        if (photos.isNotEmpty()) head.addView(ctx.text(
            ctx.resources.getQuantityString(R.plurals.report_photos, h.photos, h.photos) + " · " + ctx.resources.getQuantityString(R.plurals.report_days, h.photoDays, h.photoDays),
            13f, 600, ctx.col(R.color.ink2)))
        addView(head)
        if (photos.isEmpty()) {
            addView(ctx.text(ctx.getString(R.string.report_no_photos), 14f, 500, ctx.col(R.color.ink2)))
            addView(ctx.secondaryButton(ctx.getString(R.string.photos_add), R.drawable.ic_plus) { PhotosScreen.pick(activity) })
        } else {
            val picked = ReportModel.collage(photos, 9)
            if (picked.isNotEmpty()) {
                // The first photo large, the rest in a grid below it.
                val hero = picked.first()
                addView(roundedImage(ctx, 18f).also { image ->
                    DayPhotos.load(image, hero.key, thumb = false)
                    image.isClickable = true
                    image.setOnClickListener { PhotosScreen.viewer(activity, picked, 0) }
                }, LinearLayout.LayoutParams(MATCH, ctx.dp(200)))
                if (picked.size > 1) addView(PhotosScreen.grid(activity, picked.drop(1), 4))
            }
        }
    }

    private fun grid(tiles: List<View>) {
        tiles.chunked(2).forEach { pair ->
            val row = ctx.row(12)
            pair.forEach { row.addView(it, LinearLayout.LayoutParams(0, MATCH, 1f)) }
            if (pair.size == 1) row.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
            body.addView(row)
        }
    }

    private fun listCard(title: Int, items: List<String>) {
        if (items.isEmpty()) return
        body.addView(ctx.card(paddingDp = 16, spacingDp = 8).apply {
            addView(ctx.text(ctx.getString(title), 17f, 700))
            items.forEach { addView(ctx.text(it, 15f, 500)) }
        })
    }

    private fun storyPreview(s: MonthStats, h: Highlights, photos: List<DayPhoto>, apart: Boolean) {
        val preview = ImageView(ctx).apply {
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = ctx.getString(if (apart) R.string.story_title else R.string.story_title_together, StoryRenderer.monthName(ctx, s.month))
            clipToOutline = true
            background = ctx.rounded(ctx.col(R.color.surface), 24f)
            elevation = ctx.dp(6).toFloat()
            minimumHeight = ctx.dp(426)
        }
        val holder = FrameLayout(ctx).apply { setPadding(0, ctx.dp(8), 0, ctx.dp(8)) }
        holder.addView(preview, FrameLayout.LayoutParams(ctx.dp(240), WRAP, Gravity.CENTER_HORIZONTAL))
        body.addView(holder)
        body.addView(ctx.primaryButton(ctx.getString(R.string.month_share), R.drawable.ic_share) { share() })
        if (Build.VERSION.SDK_INT >= 29) {
            body.addView(ctx.secondaryButton(ctx.getString(R.string.month_save), R.drawable.ic_download) { saveToGallery() })
        }
        // Photos may need fetching, so the card is drawn off the main thread.
        val token = ++renderToken
        story = null
        val me = store.myName
        val partner = store.partnerDisplay
        val app = ctx.applicationContext
        val keys = ReportModel.collage(photos, 3)
        storyWorker.execute {
            val bitmaps = keys.mapNotNull { DayPhotos.bitmap(app, it.key, thumb = false) }
            val bitmap = StoryRenderer.render(ctx, s, me, partner, apart, h, bitmaps)
            preview.post {
                if (token != renderToken) return@post
                story = bitmap
                preview.minimumHeight = 0
                preview.setImageBitmap(bitmap)
            }
        }
    }

    private fun stat(value: String, label: String, detail: String? = null): View = ctx.card(paddingDp = 16, spacingDp = 2).apply {
        addView(ctx.text(value, 26f, 800).apply { letterSpacing = -0.02f })
        addView(ctx.text(label, 13f, 600, ctx.col(R.color.ink2)))
        if (detail != null) addView(ctx.text(detail, 12f, 500, ctx.col(R.color.ink2)))
    }

    private fun share() {
        val bitmap = story ?: return
        val name = "story.png"
        FileOutputStream(File(StoryProvider.dir(ctx), name)).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val uri = StoryProvider.uriFor(ctx, name)
        val send = Intent(Intent.ACTION_SEND)
            .setType("image/png")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(null, uri)
        ctx.startActivity(Intent.createChooser(send, ctx.getString(R.string.share)))
    }

    private fun saveToGallery() {
        val bitmap = story ?: return
        if (Build.VERSION.SDK_INT < 29) return
        val resolver = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "belong-${System.currentTimeMillis()}.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Belong")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return
        resolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        values.clear()
        values.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        ctx.toast(ctx.getString(R.string.month_saved))
    }

    companion object {
        private val storyWorker = java.util.concurrent.Executors.newSingleThreadExecutor()
    }
}
