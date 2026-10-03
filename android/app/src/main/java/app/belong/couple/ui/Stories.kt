package app.belong.couple.ui

import android.app.Dialog
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import app.belong.couple.R
import app.belong.couple.share.StoryProvider
import java.io.File
import java.io.FileOutputStream

/** Drawing 1080×1920 story cards in the app's style; colours are fixed so they look the same in dark mode. */
object StoryKit {
    const val W = 1080
    const val H = 1920
    const val INK = 0xFF2B2233.toInt()
    const val INK2 = 0xFF6A5F70.toInt()
    const val PINK = 0xFFC93F76.toInt()
    const val BLUE = 0xFF2F6BC8.toInt()

    /** Soft backgrounds, one per slide. */
    val BACKGROUNDS = listOf(
        intArrayOf(0xFFFDE2EB.toInt(), 0xFFFFF8F3.toInt(), 0xFFE1EDFD.toInt()),
        intArrayOf(0xFFFFE3C7.toInt(), 0xFFFFF4EC.toInt(), 0xFFFFD6E3.toInt()),
        intArrayOf(0xFFE1EDFD.toInt(), 0xFFF3EEFF.toInt(), 0xFFFDE2EB.toInt()),
        intArrayOf(0xFFDFF5E8.toInt(), 0xFFF6FFF9.toInt(), 0xFFE1EDFD.toInt()),
        intArrayOf(0xFFF1E4FF.toInt(), 0xFFFFF4FB.toInt(), 0xFFFFE3C7.toInt()),
        intArrayOf(0xFFFFF1C9.toInt(), 0xFFFFFBF0.toInt(), 0xFFFDE2EB.toInt()),
    )

    fun canvas(background: IntArray): Pair<Bitmap, Canvas> {
        val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawRect(0f, 0f, W.toFloat(), H.toFloat(), Paint().apply {
            shader = LinearGradient(0f, 0f, 0f, H.toFloat(), background, null, Shader.TileMode.CLAMP)
        })
        return bmp to c
    }

    /** The two-dot mark at the top. */
    fun mark(c: Canvas, cy: Float = 210f) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 9f
            strokeCap = Paint.Cap.ROUND
            color = INK
        }
        c.drawArc(RectF(440f, cy - 80f, 640f, cy + 70f), 200f, 140f, false, p)
        p.style = Paint.Style.FILL
        p.color = 0xFFF07DA1.toInt()
        c.drawCircle(450f, cy + 12f, 26f, p)
        p.color = 0xFF5C9DF2.toInt()
        c.drawCircle(630f, cy + 12f, 26f, p)
    }

    /** Wrapped, centred text (emoji drawn as Fluent pictures); returns the bottom edge. */
    fun text(c: Canvas, ctx: Context, text: CharSequence, size: Float, weight: Int, color: Int, top: Float, width: Int = 920): Float {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(ctx, weight)
            textSize = size
            this.color = color
        }
        val shown = Emoji.apply(ctx, text) ?: text
        val layout = StaticLayout.Builder.obtain(shown, 0, shown.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setLineSpacing(0f, 1.05f)
            .build()
        c.save()
        c.translate((W - width) / 2f, top)
        layout.draw(c)
        c.restore()
        return top + layout.height
    }

    /** A big number in the pair gradient; returns the bottom edge. */
    fun big(c: Canvas, ctx: Context, value: String, top: Float, size: Float = 230f): Float {
        val p = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(ctx, 800)
            textSize = size
            textAlign = Paint.Align.CENTER
            shader = LinearGradient(160f, 0f, 920f, 0f, PINK, BLUE, Shader.TileMode.CLAMP)
        }
        while (p.measureText(value) > 980f && p.textSize > 90f) p.textSize -= 10f
        val baseline = top + p.textSize * 0.82f
        c.drawText(value, W / 2f, baseline, p)
        return baseline + p.textSize * 0.12f
    }

    fun footer(c: Canvas, ctx: Context) {
        text(c, ctx, ctx.getString(R.string.story_footer), 38f, 700, INK2, H - 130f)
    }

    /** [bmp] cropped to fill [r] with rounded corners, on a white polaroid frame tilted by [tilt]. */
    fun polaroid(c: Canvas, bmp: Bitmap, r: RectF, tilt: Float) {
        c.save()
        c.rotate(tilt, r.centerX(), r.centerY())
        c.drawRoundRect(r, 14f, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            setShadowLayer(26f, 0f, 10f, 0x24000000)
        })
        photo(c, bmp, RectF(r.left + 16f, r.top + 16f, r.right - 16f, r.bottom - 64f), 6f)
        c.restore()
    }

    fun photo(c: Canvas, bmp: Bitmap, r: RectF, radius: Float) {
        val scale = maxOf(r.width() / bmp.width, r.height() / bmp.height)
        val sw = r.width() / scale
        val sh = r.height() / scale
        val src = Rect(((bmp.width - sw) / 2).toInt(), ((bmp.height - sh) / 2).toInt(), ((bmp.width + sw) / 2).toInt(), ((bmp.height + sh) / 2).toInt())
        c.save()
        c.clipPath(Path().apply { addRoundRect(r, radius, radius, Path.Direction.CW) })
        c.drawBitmap(bmp, src, r, Paint(Paint.FILTER_BITMAP_FLAG))
        c.restore()
    }

    /** A white rounded row: emoji, label and value, like the month card. */
    fun statRow(c: Canvas, ctx: Context, top: Float, emoji: String, label: String, value: String) {
        c.drawRoundRect(RectF(90f, top, 990f, top + 128f), 44f, 44f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            setShadowLayer(24f, 0f, 8f, 0x14000000)
        })
        Emoji.draw(c, ctx, emoji, 165f, top + 64f, 60f, Paint())
        val label2 = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Fonts.get(ctx, 600); textSize = 40f; color = INK }
        val valuePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Fonts.get(ctx, 800); textSize = 50f; color = INK; textAlign = Paint.Align.RIGHT }
        var l = label
        val room = 950f - 230f - valuePaint.measureText(value) - 30f
        while (l.length > 1 && label2.measureText(l) > room) l = l.dropLast(2) + "…"
        c.drawText(l, 230f, top + 78f, label2)
        c.drawText(value, 950f, top + 82f, valuePaint)
    }
}

/** Sends story cards to Instagram, Threads and the rest, or saves them to the gallery. */
object StoryShare {
    private fun write(context: Context, bitmaps: List<Bitmap>): List<Uri> = bitmaps.mapIndexed { i, bmp ->
        val name = "story-$i.png"
        FileOutputStream(File(StoryProvider.dir(context), name)).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        StoryProvider.uriFor(context, name)
    }

    fun share(activity: MainActivity, bitmaps: List<Bitmap>) {
        if (bitmaps.isEmpty()) return
        val uris = write(activity, bitmaps)
        val send = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
        }
        send.type = "image/png"
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(null, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
        activity.startActivity(Intent.createChooser(send, activity.getString(R.string.share)))
    }

    fun save(activity: MainActivity, bitmaps: List<Bitmap>) {
        if (Build.VERSION.SDK_INT < 29) return
        val resolver = activity.contentResolver
        bitmaps.forEachIndexed { i, bmp ->
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "belong-${System.currentTimeMillis()}-$i.png")
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Belong")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@forEachIndexed
            resolver.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        }
        Toaster.show(activity, activity.getString(R.string.month_saved))
    }
}

/**
 * Full-screen stories: tap the right side for the next card, the left for the previous one; they
 * also move on by themselves. Share this card or all of them, or save them to the gallery.
 */
object StoryViewer {
    fun show(activity: MainActivity, slides: List<Bitmap>, autoAdvance: Boolean = true) {
        if (slides.isEmpty()) return
        val a = activity
        val dialog = Dialog(a, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val stage = FrameLayout(a).apply { setBackgroundColor(Color.BLACK) }
        val image = ImageView(a).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
        stage.addView(image, FrameLayout.LayoutParams(MATCH, MATCH))
        val bars = a.row(6).apply { setPadding(a.dp(12), a.dp(10), a.dp(12), 0) }
        stage.addView(bars, FrameLayout.LayoutParams(MATCH, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        var index = 0
        val next = object : Runnable {
            override fun run() {
                if (index < slides.lastIndex) {
                    index++
                    draw(a, image, bars, slides, index)
                    stage.postDelayed(this, 5_000)
                }
            }
        }
        draw(a, image, bars, slides, index)
        if (autoAdvance && slides.size > 1) stage.postDelayed(next, 5_000)
        image.setOnTouchListener { v, e ->
            if (e.action == MotionEvent.ACTION_UP) {
                stage.removeCallbacks(next)
                index = (if (e.x > v.width / 3f) index + 1 else index - 1).coerceIn(0, slides.lastIndex)
                draw(a, image, bars, slides, index)
            }
            true
        }
        val top = a.row(8).apply { setPadding(a.dp(12), a.dp(24), a.dp(12), 0) }
        top.addView(View(a), LinearLayout.LayoutParams(0, 1, 1f))
        top.addView(ImageView(a).apply {
            setImageDrawable(a.icon(R.drawable.ic_close, Color.WHITE, 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = a.getString(R.string.pair_close)
            background = a.ripple(a.rounded(0x33FFFFFF, 22f), 22f)
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(a.dp(44), a.dp(44)))
        stage.addView(top, FrameLayout.LayoutParams(MATCH, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        val bottom = a.column(8).apply { setPadding(a.dp(20), a.dp(12), a.dp(20), a.dp(24)) }
        bottom.addView(a.primaryButton(a.getString(if (slides.size > 1) R.string.stories_share_all else R.string.month_share), R.drawable.ic_share) {
            stage.removeCallbacks(next)
            StoryShare.share(a, slides)
        })
        val row = a.row(8)
        if (slides.size > 1) row.addView(a.tintButton(a.getString(R.string.stories_share_this), null, 0x33FFFFFF, Color.WHITE) {
            stage.removeCallbacks(next)
            StoryShare.share(a, listOf(slides[index]))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (Build.VERSION.SDK_INT >= 29) row.addView(a.tintButton(a.getString(R.string.month_save), R.drawable.ic_download, 0x33FFFFFF, Color.WHITE) {
            stage.removeCallbacks(next)
            StoryShare.save(a, slides)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bottom.addView(row)
        stage.addView(bottom, FrameLayout.LayoutParams(MATCH, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        dialog.setContentView(stage)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.setOnDismissListener { stage.removeCallbacks(next) }
        dialog.show()
    }

    private fun draw(a: MainActivity, image: ImageView, bars: LinearLayout, slides: List<Bitmap>, index: Int) {
        image.setImageBitmap(slides[index])
        image.contentDescription = a.getString(R.string.stories_card, index + 1, slides.size)
        bars.removeAllViews()
        if (slides.size < 2) return
        slides.indices.forEach { i ->
            bars.addView(View(a).apply { background = a.rounded(if (i <= index) Color.WHITE else 0x55FFFFFF, 2f) }, LinearLayout.LayoutParams(0, a.dp(3), 1f))
        }
    }
}
