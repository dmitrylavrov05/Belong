package app.belong.couple.ui

import android.animation.ValueAnimator
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import app.belong.couple.R

// Components from the Belong design system: "two colours that become one".

/**
 * The pair mark: her circle and his circle, with the overlap filled by the shared gradient.
 * [soft] draws the glossy brand version (logo, welcome); otherwise it is the flat double avatar with initials.
 */
class PairMark(context: Context, private val soft: Boolean = false) : View(context) {
    var initials: Pair<String, String>? = null
        set(value) {
            field = value
            invalidate()
        }

    /** 0 = circles apart, 1 = together; animated on the welcome screen. */
    var join = 1f
        set(value) {
            field = value
            invalidate()
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val clip = Path()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val h = MeasureSpec.getSize(heightMeasureSpec)
        setMeasuredDimension((h * 1.6f).toInt(), h)
    }

    override fun onDraw(canvas: Canvas) {
        val her = context.col(R.color.her)
        val him = context.col(R.color.him)
        val h = height.toFloat()
        val r = h * 0.45f
        val cy = h / 2
        val spread = h * 0.5f * (2f - join) // centres 0.5·h apart when joined
        val cx = width / 2f
        val ax = cx - spread / 2
        val bx = cx + spread / 2

        if (soft) {
            paint.shader = RadialGradient(ax - r * 0.2f, cy - r * 0.3f, r * 1.3f, lighten(her), her, Shader.TileMode.CLAMP)
            canvas.drawCircle(ax, cy, r, paint)
            paint.shader = RadialGradient(bx + r * 0.2f, cy - r * 0.3f, r * 1.3f, lighten(him), him, Shader.TileMode.CLAMP)
            paint.alpha = 235
            canvas.drawCircle(bx, cy, r, paint)
            paint.alpha = 255
        } else {
            paint.shader = null
            paint.color = her
            canvas.drawCircle(ax, cy, r, paint)
            paint.color = him
            canvas.drawCircle(bx, cy, r, paint)
        }
        // The overlap: "ours".
        canvas.save()
        clip.reset()
        clip.addCircle(ax, cy, r, Path.Direction.CW)
        canvas.clipPath(clip)
        paint.shader = LinearGradient(bx - r, cy - r, bx + r, cy + r, her, him, Shader.TileMode.CLAMP)
        paint.alpha = if (soft) (200 * join).toInt() else 255
        canvas.drawCircle(bx, cy, r, paint)
        paint.alpha = 255
        canvas.restore()
        paint.shader = null

        if (!soft) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = h * 0.04f
            paint.color = context.col(R.color.surface)
            canvas.drawCircle(ax, cy, r, paint)
            canvas.drawCircle(bx, cy, r, paint)
            paint.style = Paint.Style.FILL
        }
        initials?.let { (a, b) ->
            paint.color = context.col(R.color.ink_on_partner)
            paint.textAlign = Paint.Align.CENTER
            paint.textSize = h * 0.36f
            paint.typeface = Fonts.get(context, 700)
            val base = cy - (paint.descent() + paint.ascent()) / 2
            canvas.drawText(a, ax - r * 0.42f, base, paint)
            canvas.drawText(b, bx + r * 0.42f, base, paint)
        }
    }

    private fun lighten(color: Int): Int = Color.rgb(
        Color.red(color) + (255 - Color.red(color)) * 6 / 10,
        Color.green(color) + (255 - Color.green(color)) * 6 / 10,
        Color.blue(color) + (255 - Color.blue(color)) * 6 / 10,
    )
}

/** A soft round glow in the pair colours, placed behind the mark. */
fun Context.glow(): Drawable = GradientDrawable().apply {
    gradientType = GradientDrawable.RADIAL_GRADIENT
    // Fade to a transparent blue rather than transparent black, which would turn the edge grey.
    colors = intArrayOf(col(R.color.her) and 0x2EFFFFFF, col(R.color.him) and 0x1AFFFFFF, col(R.color.him) and 0x00FFFFFF)
    gradientRadius = dp(150).toFloat()
}

/** The design's card shadow: a soft, plum-tinted drop rather than Material's grey. */
fun View.softShadow(elevationDp: Float = 6f) {
    elevation = context.dp(elevationDp).toFloat()
    if (Build.VERSION.SDK_INT >= 28) {
        outlineAmbientShadowColor = context.col(R.color.shadow)
        outlineSpotShadowColor = context.col(R.color.shadow)
    }
}

/** Buttons shrink a little while pressed (scale 0.97, 120 ms). */
fun View.pressable(): View {
    setOnTouchListener { v, e ->
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> v.animate().scaleX(0.97f).scaleY(0.97f).setDuration(120).start()
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
        }
        false
    }
    return this
}

/** A segmented switch: a sand-coloured pill with the chosen segment raised in white. */
fun Context.segmented(labels: List<String>, selected: Int, onSelect: (Int) -> Unit): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    background = rounded(col(R.color.sunk), 999f)
    val p = dp(4)
    setPadding(p, p, p, p)
    labels.forEachIndexed { i, label ->
        val active = i == selected
        addView(text(label, 14f, if (active) 700 else 600, col(if (active) R.color.ink else R.color.ink2)).apply {
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            minHeight = dp(40)
            setPadding(dp(8), 0, dp(8), 0)
            if (active) {
                background = rounded(col(R.color.surface), 999f)
                softShadow(2f)
            }
            isSelected = active
            setOnClickListener { if (!active) onSelect(i) }
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
    }
}

/** The task ring: an outline in the owner's colour (gradient for shared), or a green disc with a tick when done. */
class TaskRing(context: Context, private val shared: Boolean, private val color: Int, private val done: Boolean) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tick = Path()

    override fun onDraw(canvas: Canvas) {
        val s = width.coerceAtMost(height).toFloat()
        val cx = width / 2f
        val cy = height / 2f
        val stroke = context.dp(2).toFloat()
        val r = s / 2 - stroke
        if (done) {
            paint.style = Paint.Style.FILL
            paint.shader = null
            paint.color = context.col(R.color.ok)
            canvas.drawCircle(cx, cy, s / 2, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = stroke
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            paint.color = Color.WHITE
            tick.reset()
            tick.moveTo(cx - s * 0.2f, cy)
            tick.lineTo(cx - s * 0.05f, cy + s * 0.15f)
            tick.lineTo(cx + s * 0.22f, cy - s * 0.13f)
            canvas.drawPath(tick, paint)
            return
        }
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = stroke
        paint.shader = if (shared) LinearGradient(0f, 0f, s, s, context.col(R.color.her), context.col(R.color.him), Shader.TileMode.CLAMP) else null
        paint.color = color
        canvas.drawCircle(cx, cy, r, paint)
    }
}

/** A small round dot in the owner's colour; shared things get the gradient. */
fun Context.ownerDot(color: Int?, sizeDp: Int = 8): View = View(this).apply {
    background = if (color == null) {
        GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(col(R.color.her), col(R.color.him))).apply { shape = GradientDrawable.OVAL }
    } else {
        GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
    }
    layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
}

/** An icon painted with the pair gradient, for the selected tab. */
fun Context.gradientIcon(res: Int, sizeDp: Int = 24): Drawable {
    val size = dp(sizeDp)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    getDrawable(res)!!.mutate().apply {
        setTint(Color.BLACK)
        setBounds(0, 0, size, size)
        draw(canvas)
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        shader = LinearGradient(0f, 0f, size.toFloat(), size.toFloat(), col(R.color.her), col(R.color.him), Shader.TileMode.CLAMP)
        xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    }
    canvas.drawRect(0f, 0f, size.toFloat(), size.toFloat(), paint)
    return BitmapDrawable(resources, bitmap).apply { setBounds(0, 0, size, size) }
}

/** The round "+" button floating over Today. */
fun Context.fab(description: String, onClick: () -> Unit): View = TextView(this).apply {
    text = "+"
    textSize = 30f
    typeface = Fonts.get(context, 500)
    setTextColor(Color.WHITE)
    gravity = Gravity.CENTER
    includeFontPadding = false
    background = ripple(GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(col(R.color.us_start), col(R.color.us_end))).apply {
        shape = GradientDrawable.OVAL
    }, 28f)
    contentDescription = description
    elevation = dp(8).toFloat()
    if (Build.VERSION.SDK_INT >= 28) {
        outlineSpotShadowColor = col(R.color.him)
        outlineAmbientShadowColor = col(R.color.him)
    }
    setOnClickListener { onClick() }
    pressable()
}

/** A bottom sheet: rounded top corners, a grabber and a dimmed screen behind it. */
fun Activity.bottomSheet(build: (LinearLayout, Dialog) -> Unit): Dialog {
    val dialog = Dialog(this)
    dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
    val sheet = column(12).apply {
        val side = dp(20)
        setPadding(side, dp(10), side, dp(24))
        background = GradientDrawable().apply {
            setColor(col(R.color.surface))
            val r = dp(28).toFloat()
            cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
        }
    }
    sheet.addView(View(this).apply { background = rounded(col(R.color.grabber), 3f) }, LinearLayout.LayoutParams(dp(36), dp(5)).apply {
        gravity = Gravity.CENTER_HORIZONTAL
        bottomMargin = dp(6)
    })
    build(sheet, dialog)
    dialog.setContentView(sheet)
    dialog.window?.apply {
        setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        setGravity(Gravity.BOTTOM)
        setDimAmount(0.4f)
        addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        @Suppress("DEPRECATION")
        setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        setWindowAnimations(android.R.style.Animation_InputMethod)
    }
    dialog.show()
    return dialog
}

/**
 * The design's toast: a dark pill with a gradient circle on the left, shown over the current screen
 * for a couple of seconds. Falls back to a system toast outside an activity.
 */
object Toaster {
    fun show(context: Context, message: CharSequence, iconRes: Int = R.drawable.ic_heart) {
        val activity = context as? Activity
        val root = activity?.window?.decorView?.findViewById<FrameLayout>(android.R.id.content)
        if (activity == null || root == null || activity.isFinishing) {
            android.widget.Toast.makeText(context.applicationContext, message, android.widget.Toast.LENGTH_SHORT).show()
            return
        }
        root.findViewWithTag<View>(TAG)?.let { root.removeView(it) }
        val pill = activity.row(12).apply {
            tag = TAG
            background = activity.rounded(activity.col(R.color.toast_bg), 999f)
            setPadding(activity.dp(8), activity.dp(8), activity.dp(20), activity.dp(8))
            elevation = activity.dp(12).toFloat()
            addView(TextView(activity).apply {
                setCompoundDrawablesRelative(activity.icon(iconRes, Color.WHITE, 18), null, null, null)
                gravity = Gravity.CENTER
                setPadding(activity.dp(11), 0, 0, 0)
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(activity.col(R.color.her), activity.col(R.color.him))).apply {
                    shape = GradientDrawable.OVAL
                }
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(activity.dp(40), activity.dp(40)))
            addView(activity.text(message, 15f, 600, Color.WHITE).apply { maxLines = 3 }, LinearLayout.LayoutParams(0, WRAP, 1f))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        val lp = FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM).apply {
            val side = activity.dp(16)
            setMargins(side, 0, side, activity.dp(96))
        }
        root.addView(pill, lp)
        pill.alpha = 0f
        pill.translationY = activity.dp(24).toFloat()
        pill.animate().alpha(1f).translationY(0f).setDuration(250).setInterpolator(DecelerateInterpolator()).start()
        pill.postDelayed({
            pill.animate().alpha(0f).setDuration(250).withEndAction { root.removeView(pill) }.start()
        }, 2_600)
    }

    private const val TAG = "belong-toast"
}

/** Two rings that grow and fade around a view, repeating: the "thinking of you" pulse. */
class PulseRings(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private var phase = 0f
    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1600
        repeatCount = ValueAnimator.INFINITE
        addUpdateListener {
            phase = it.animatedValue as Float
            invalidate()
        }
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
        val base = minOf(width, height) / 2f / 1.4f
        paint.strokeWidth = context.dp(2).toFloat()
        for (offset in listOf(0f, 0.5f)) {
            val t = (phase + offset) % 1f
            paint.color = context.col(R.color.him)
            paint.alpha = ((1f - t) * 140).toInt()
            canvas.drawCircle(width / 2f, height / 2f, base * (1f + 0.4f * t), paint)
        }
    }
}
