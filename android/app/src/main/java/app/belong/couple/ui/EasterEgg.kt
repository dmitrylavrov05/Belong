package app.belong.couple.ui

import android.animation.ValueAnimator
import android.app.Dialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.data.CoupleStore

/**
 * A secret for Yulia: tap the two dots at the top of "Us" seven times. Only opens when the name in
 * the settings is hers. The words live in res/values/easter.xml.
 */
object EasterEgg {
    const val TAPS = 7
    private val NAME = Regex("^(юл|yul|jul|iul)", RegexOption.IGNORE_CASE)

    fun isFor(name: String): Boolean = NAME.containsMatchIn(name.trim())

    fun show(a: MainActivity) {
        val store = CoupleStore.get(a)
        val dialog = Dialog(a, R.style.Theme_Belong)
        val stage = FrameLayout(a).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xFFFDE2EB.toInt(), 0xFFFFF8F3.toInt(), 0xFFE1EDFD.toInt()))
        }
        stage.addView(FloatingHearts(a), FrameLayout.LayoutParams(MATCH, MATCH))

        val page = a.column(14).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(a.dp(24), a.dp(12), a.dp(24), a.dp(32))
        }
        page.addView(ImageView(a).apply {
            setImageDrawable(a.icon(R.drawable.ic_close, INK, 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = a.getString(R.string.pair_close)
            background = a.ripple(a.rounded(0x66FFFFFF, 22f), 22f)
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(a.dp(44), a.dp(44)).apply { gravity = Gravity.START })

        val heart = FrameLayout(a)
        heart.addView(PulseRings(a), FrameLayout.LayoutParams(a.dp(140), a.dp(140), Gravity.CENTER))
        heart.addView(a.text("💗", 64f).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(a.dp(140), a.dp(140), Gravity.CENTER))
        page.addView(heart, LinearLayout.LayoutParams(a.dp(140), a.dp(140)))
        page.addView(a.text(a.getString(R.string.easter_found), 14f, 700, ON_TINT).apply { gravity = Gravity.CENTER })
        page.addView(a.text(a.getString(R.string.easter_title), 30f, 800, INK).apply {
            gravity = Gravity.CENTER
            letterSpacing = -0.01f
        })

        page.addView(a.card(paddingDp = 20, spacingDp = 12, background = a.rounded(0xF2FFFFFF.toInt(), 28f)).apply {
            addView(a.text(a.getString(R.string.easter_letter), 17f, 500, INK).apply { setLineSpacing(0f, 1.25f) })
            addView(a.text(a.getString(R.string.easter_signature, store.partnerDisplay), 17f, 700, ON_TINT).apply { gravity = Gravity.END })
        }.lp(top = 8))

        val reasons = a.resources.getStringArray(R.array.easter_reasons).toMutableList().apply { shuffle() }
        var index = 0
        val reasonNumber = a.text("", 13f, 800, ON_TINT)
        val reasonText = a.text("", 20f, 700, INK).apply { minHeight = a.dp(56) }
        fun showReason() {
            reasonNumber.text = a.getString(R.string.easter_reason_number, index + 1, reasons.size)
            reasonText.alpha = 0f
            reasonText.text = reasons[index]
            reasonText.animate().alpha(1f).setDuration(250).start()
        }
        page.addView(a.card(paddingDp = 20, spacingDp = 8, background = a.gradient(28f, 0xFFFFD6E3.toInt(), 0xFFD6E6FF.toInt())).apply {
            addView(a.text(a.getString(R.string.easter_reasons_title), 17f, 800, INK))
            addView(reasonNumber)
            addView(reasonText)
            addView(a.primaryButton(a.getString(R.string.easter_more)) { v ->
                haptic(v)
                index = (index + 1) % reasons.size
                showReason()
                stage.addView(Confetti(a, System.nanoTime()), FrameLayout.LayoutParams(MATCH, MATCH))
                if (stage.childCount > 6) stage.removeViewAt(2)
            })
        }.lp(top = 8))
        showReason()

        stage.addView(ScrollView(a).apply {
            isFillViewport = true
            addView(page)
        }, FrameLayout.LayoutParams(MATCH, MATCH))
        stage.addView(Confetti(a), FrameLayout.LayoutParams(MATCH, MATCH))
        dialog.setContentView(stage)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.show()
    }

    private const val INK = 0xFF2B2233.toInt()
    private const val ON_TINT = 0xFFB0406E.toInt()

    /** Hearts drifting up the screen, slowly and forever. */
    private class FloatingHearts(context: Context) : View(context) {
        private val random = java.util.Random(14)
        private val hearts = List(18) { floatArrayOf(random.nextFloat(), random.nextFloat(), 0.6f + random.nextFloat() * 0.8f, random.nextFloat()) }
        private val glyphs = listOf("💗", "💕", "❤️", "💞", "🤍")
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
        private var t = 0f
        private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 14_000
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener {
                t = it.animatedValue as Float
                invalidate()
            }
        }

        init {
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            animator.start()
        }

        override fun onDetachedFromWindow() {
            animator.cancel()
            super.onDetachedFromWindow()
        }

        override fun onDraw(canvas: Canvas) {
            hearts.forEachIndexed { i, h ->
                val progress = (h[1] + t * h[2]) % 1f
                val y = height * (1.1f - progress * 1.2f)
                val x = width * h[0] + Math.sin((progress * 6 + h[3] * 6).toDouble()).toFloat() * context.dp(14)
                paint.textSize = context.dp(16 + (h[3] * 18).toInt()).toFloat()
                paint.alpha = (110 * (1f - progress)).toInt().coerceIn(0, 255)
                Emoji.draw(canvas, context, glyphs[i % glyphs.size], x, y, paint.textSize * 1.2f, paint)
            }
        }
    }
}
