package app.belong.couple.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ReplacementSpan
import android.util.LruCache
import android.widget.TextView

/**
 * Microsoft's Fluent 3D emoji (MIT, assets/emoji/<code points>.webp, 128 px) in place of the
 * phone's own, so the app looks the same on every Android phone. Skin tones fall back to the
 * default yellow; anything without a picture stays as the phone draws it.
 */
object Emoji {
    private const val SKIN_FROM = 0x1F3FB
    private const val SKIN_TO = 0x1F3FF
    private const val VS16 = 0xFE0F
    private const val KEYCAP = 0x20E3

    /** Normalised sequence (hex code points without FE0F, joined by "-") → file name. */
    @Volatile private var files: Map<String, String>? = null
    /** Sequences shown as text unless written with FE0F (©, ™, ↔, ❤ …), so plain symbols stay plain. */
    @Volatile private var needsVs16: Set<String> = emptySet()
    private var longest = 1

    private val cache = object : LruCache<String, Bitmap>(4 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    private fun load(context: Context): Map<String, String> {
        files?.let { return it }
        synchronized(this) {
            files?.let { return it }
            val names = try {
                context.applicationContext.assets.list("emoji")?.toList().orEmpty()
            } catch (e: java.io.IOException) {
                emptyList()
            }
            val map = HashMap<String, String>(names.size * 2)
            val vs = HashSet<String>()
            for (name in names) {
                val parts = name.removeSuffix(".webp").split('-').mapNotNull { it.toIntOrNull(16) }
                val key = key(parts)
                if (key.isEmpty()) continue
                map[key] = name
                if (VS16 in parts && KEYCAP !in parts && parts.size <= 2) vs += key
                longest = maxOf(longest, parts.count { it != VS16 })
            }
            needsVs16 = vs
            files = map
            return map
        }
    }

    private fun key(codePoints: List<Int>): String =
        codePoints.filter { it != VS16 && it !in SKIN_FROM..SKIN_TO }.joinToString("-") { Integer.toHexString(it) }

    /** Could this code point start an emoji? Plain letters, digits and punctuation are skipped quickly. */
    private fun mayStart(cp: Int): Boolean = cp >= 0x2000 || cp == 0x23 || cp == 0x2A || cp in 0x30..0x39 || cp == 0xA9 || cp == 0xAE

    /** [text] with every emoji we have a picture for drawn as that picture. */
    fun apply(context: Context, text: CharSequence?): CharSequence? {
        if (text.isNullOrEmpty()) return text
        if (text.none { it.code >= 0x2000 || it == '#' || it == '*' || it in '0'..'9' || it == '©' || it == '®' }) return text
        val map = load(context)
        if (map.isEmpty()) return text
        var out: SpannableStringBuilder? = null
        var i = 0
        while (i < text.length) {
            val cp = Character.codePointAt(text, i)
            if (!mayStart(cp)) {
                i += Character.charCount(cp)
                continue
            }
            // Read ahead: the code points of a possible sequence, with where each one ends.
            val cps = ArrayList<Int>()
            val ends = ArrayList<Int>()
            var j = i
            while (j < text.length && cps.size < longest * 3 + 2) {
                val c = Character.codePointAt(text, j)
                j += Character.charCount(c)
                cps += c
                ends += j
            }
            var matched = -1
            var file: String? = null
            for (n in cps.size downTo 1) {
                val seq = cps.subList(0, n)
                val k = key(seq)
                val f = map[k] ?: continue
                if (k in needsVs16 && VS16 !in seq) continue
                matched = n
                file = f
                break
            }
            if (file == null) {
                i += Character.charCount(cp)
                continue
            }
            // Take a trailing FE0F or skin tone along so it doesn't show on its own.
            var end = ends[matched - 1]
            var n = matched
            while (n < cps.size && (cps[n] == VS16 || cps[n] in SKIN_FROM..SKIN_TO)) {
                end = ends[n]
                n++
            }
            val builder = out ?: SpannableStringBuilder(text).also { out = it }
            builder.setSpan(Span(context.applicationContext, file), i, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            i = end
        }
        return out ?: text
    }

    /** The picture for a single emoji string such as "💗", for things drawn on a canvas. */
    fun bitmap(context: Context, emoji: String): Bitmap? {
        val map = load(context)
        val k = key(emoji.codePoints().toArray().toList())
        return map[k]?.let { decode(context, it) }
    }

    /** Draws [emoji] centred at ([cx], [cy]) at [size] px, or as text if there's no picture. */
    fun draw(canvas: Canvas, context: Context, emoji: String, cx: Float, cy: Float, size: Float, paint: Paint) {
        val bmp = bitmap(context, emoji)
        if (bmp == null) {
            val p = Paint(paint).apply { textSize = size; textAlign = Paint.Align.CENTER }
            canvas.drawText(emoji, cx, cy - (p.ascent() + p.descent()) / 2, p)
            return
        }
        canvas.drawBitmap(bmp, null, RectF(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2), Paint(Paint.FILTER_BITMAP_FLAG).apply { alpha = paint.alpha })
    }

    private fun decode(context: Context, file: String): Bitmap? {
        cache.get(file)?.let { return it }
        return try {
            context.applicationContext.assets.open("emoji/$file").use { BitmapFactory.decodeStream(it) }?.also { cache.put(file, it) }
        } catch (e: java.io.IOException) {
            null
        }
    }

    /** An emoji picture sized to the text around it. */
    private class Span(private val context: Context, private val file: String) : ReplacementSpan() {
        override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
            if (fm != null) {
                val m = paint.fontMetricsInt
                fm.ascent = m.ascent
                fm.descent = m.descent
                fm.top = m.top
                fm.bottom = m.bottom
            }
            return (paint.textSize * 1.2f).toInt()
        }

        override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
            val bmp = decode(context, file) ?: return
            val size = paint.textSize * 1.15f
            val cy = y + (paint.ascent() + paint.descent()) / 2
            val left = x + paint.textSize * 0.025f
            canvas.drawBitmap(bmp, Rect(0, 0, bmp.width, bmp.height), RectF(left, cy - size / 2, left + size, cy + size / 2), Paint(Paint.FILTER_BITMAP_FLAG).apply { alpha = paint.alpha })
        }
    }
}

/** A TextView that shows Fluent emoji: every text set on it goes through [Emoji.apply]. */
open class EmojiTextView(context: Context) : TextView(context) {
    override fun setText(text: CharSequence?, type: BufferType?) {
        super.setText(Emoji.apply(context, text), type)
    }
}
