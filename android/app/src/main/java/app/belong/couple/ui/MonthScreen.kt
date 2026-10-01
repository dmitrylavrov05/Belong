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
import app.belong.couple.core.MonthStats
import app.belong.couple.core.Recap
import app.belong.couple.core.TimeMath
import app.belong.couple.data.CoupleStore
import app.belong.couple.share.StoryProvider
import java.io.File
import java.io.FileOutputStream
import java.text.NumberFormat
import java.time.YearMonth
import java.time.format.DateTimeFormatter

/** Draws the 1080×1920 "our month apart" card for stories. Colours are fixed so it looks the same in dark mode. */
object StoryRenderer {
    const val WIDTH = 1080
    const val HEIGHT = 1920

    private const val INK = 0xFF2B2233.toInt()
    private const val INK2 = 0xFF6A5F70.toInt()
    private const val ON_TINT = 0xFF5E5466.toInt()

    data class Row(val emoji: String, val label: String, val value: String)

    fun monthName(context: Context, month: YearMonth): String =
        DateTimeFormatter.ofPattern("LLLL", context.locale()).format(month)

    fun rows(context: Context, s: MonthStats): List<Row> {
        val nf = NumberFormat.getIntegerInstance(context.locale())
        val rows = mutableListOf(
            Row("💗", context.getString(R.string.stat_taps), nf.format(s.tapsSent + s.tapsReceived)),
            Row("✏️", context.getString(R.string.stat_doodles), nf.format(s.doodles)),
            Row("🛡", context.getString(R.string.stat_safe), nf.format(s.safeCheckins)),
            Row("🕒", context.getString(R.string.stat_hours), context.getString(R.string.hours_short, TimeMath.formatHours(s.hoursApart))),
            Row(Recap.emojiForAverage(s.averageMood), context.getString(R.string.stat_mood), ""),
        )
        s.daysToMeeting?.let { days ->
            rows.add(3, Row("⏳", context.resources.getQuantityString(R.plurals.days_until_label, days.toInt()), nf.format(days)))
        }
        return rows
    }

    fun render(context: Context, s: MonthStats, me: String, partner: String): Bitmap {
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

        val title = context.getString(R.string.story_title, monthName(context, s.month))
        var y = drawCentered(canvas, context, title, 76f, 800, INK, 380f, 920)
        y = drawCentered(canvas, context, context.getString(R.string.couple_line, me, partner), 44f, 600, INK2, y + 20f, 920)

        val number = NumberFormat.getIntegerInstance(context.locale()).format(s.km)
        val big = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(context, 800)
            textSize = 210f
            textAlign = Paint.Align.CENTER
            shader = LinearGradient(200f, 0f, 880f, 0f, 0xFFC93F76.toInt(), 0xFF2F6BC8.toInt(), Shader.TileMode.CLAMP)
        }
        while (big.measureText(number) > 960f && big.textSize > 120f) big.textSize -= 10f
        val bigBaseline = y + 70f + big.textSize * 0.8f
        canvas.drawText(number, WIDTH / 2f, bigBaseline, big)
        y = drawCentered(canvas, context, context.getString(R.string.stat_km), 48f, 700, ON_TINT, bigBaseline + 30f, 920)

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
        for (row in rows(context, s)) {
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

class MonthScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val body = ctx.column(14).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(28))
    }
    override val view: View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    private var story: Bitmap? = null

    override fun refresh() {
        val s = store.stats()
        body.removeAllViews()
        body.addView(ctx.text(ctx.getString(R.string.month_title), 28f, 800).apply { letterSpacing = -0.02f })
        val monthTitle = DateTimeFormatter.ofPattern("LLLL yyyy", ctx.locale()).format(s.month).replaceFirstChar { it.titlecase(ctx.locale()) }
        body.addView(ctx.text("$monthTitle · ${ctx.getString(R.string.couple_line, store.myName, store.partnerDisplay)}", 15f, 500, ctx.col(R.color.ink2)))
        if (s.inProgress) {
            body.addView(ctx.text(ctx.getString(R.string.month_in_progress), 13f, 700, ctx.col(R.color.on_tint)).apply {
                background = ctx.rounded(ctx.col(R.color.her_tint), 999f)
                setPadding(ctx.dp(12), ctx.dp(6), ctx.dp(12), ctx.dp(6))
            }.lp(width = WRAP))
        }
        if (store.isExample) body.addView(ctx.text(ctx.getString(R.string.month_example), 13f, 500, ctx.col(R.color.ink2)))

        val nf = NumberFormat.getIntegerInstance(ctx.locale())
        val tiles = mutableListOf(
            stat(nf.format(s.km), ctx.getString(R.string.stat_km)),
            stat(ctx.getString(R.string.hours_short, TimeMath.formatHours(s.hoursApart)), ctx.getString(R.string.stat_hours)),
            stat(nf.format(s.tapsSent + s.tapsReceived), ctx.getString(R.string.stat_taps), ctx.getString(R.string.stat_taps_value, s.tapsSent, s.tapsReceived)),
            stat(nf.format(s.doodles), ctx.getString(R.string.stat_doodles)),
            stat(nf.format(s.safeCheckins), ctx.getString(R.string.stat_safe)),
            stat(Recap.emojiForAverage(s.averageMood), ctx.getString(R.string.stat_mood)),
        )
        s.daysToMeeting?.let { days ->
            tiles.add(stat(nf.format(days), ctx.resources.getQuantityString(R.plurals.days_until_label, days.toInt())))
        }
        tiles.chunked(2).forEach { pair ->
            val row = ctx.row(12)
            pair.forEach { row.addView(it, LinearLayout.LayoutParams(0, MATCH, 1f)) }
            if (pair.size == 1) row.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
            body.addView(row)
        }

        val bitmap = StoryRenderer.render(ctx, s, store.myName, store.partnerDisplay)
        story = bitmap
        val preview = ImageView(ctx).apply {
            setImageBitmap(bitmap)
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = ctx.getString(R.string.story_title, StoryRenderer.monthName(ctx, s.month))
            clipToOutline = true
            background = ctx.rounded(ctx.col(R.color.surface), 24f)
            elevation = ctx.dp(6).toFloat()
        }
        val holder = FrameLayout(ctx).apply { setPadding(0, ctx.dp(8), 0, ctx.dp(8)) }
        holder.addView(preview, FrameLayout.LayoutParams(ctx.dp(240), WRAP, Gravity.CENTER_HORIZONTAL))
        body.addView(holder)

        body.addView(ctx.primaryButton(ctx.getString(R.string.month_share), R.drawable.ic_share) { share() })
        if (Build.VERSION.SDK_INT >= 29) {
            body.addView(ctx.secondaryButton(ctx.getString(R.string.month_save), R.drawable.ic_download) { saveToGallery() })
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
}
