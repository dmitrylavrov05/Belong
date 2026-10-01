package app.belong.couple.ui

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.data.DoodleArt
import app.belong.couple.demo.DemoPartner
import app.belong.couple.widget.Widgets

/** A square drawing surface; strokes are kept as paths so the doodle can be exported at any size. */
class DoodleView(context: Context) : View(context) {
    private class Stroke(val path: Path, val color: Int, val width: Float)

    private val strokes = mutableListOf<Stroke>()
    private var current: Stroke? = null
    private var lastX = 0f
    private var lastY = 0f
    private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val paper = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = DoodleArt.PAPER }
    private val corner = context.dp(20).toFloat()

    var color: Int = 0xFFF07DA1.toInt()
    var onChange: (() -> Unit)? = null
    val isEmpty: Boolean get() = strokes.isEmpty()

    init {
        contentDescription = context.getString(R.string.doodle_canvas)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(size, size)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), corner, corner, paper)
        drawStrokes(canvas)
    }

    private fun drawStrokes(canvas: Canvas) {
        for (stroke in strokes) {
            pen.color = stroke.color
            pen.strokeWidth = stroke.width
            canvas.drawPath(stroke.path, pen)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x.coerceIn(0f, width.toFloat())
        val y = event.y.coerceIn(0f, height.toFloat())
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                val stroke = Stroke(Path().apply { moveTo(x, y); lineTo(x + 0.1f, y) }, color, width * 0.025f)
                strokes += stroke
                current = stroke
                lastX = x
                lastY = y
            }
            MotionEvent.ACTION_MOVE -> {
                current?.path?.quadTo(lastX, lastY, (x + lastX) / 2, (y + lastY) / 2)
                lastX = x
                lastY = y
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                current?.path?.lineTo(x, y)
                current = null
                parent?.requestDisallowInterceptTouchEvent(false)
                onChange?.invoke()
            }
            else -> return false
        }
        invalidate()
        return true
    }

    fun undo() {
        if (strokes.isNotEmpty()) strokes.removeAt(strokes.size - 1)
        invalidate()
        onChange?.invoke()
    }

    fun clear() {
        strokes.clear()
        invalidate()
        onChange?.invoke()
    }

    /** Renders the doodle on paper at [size]×[size] pixels. */
    fun export(size: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(DoodleArt.PAPER)
        if (width > 0) canvas.scale(size / width.toFloat(), size / height.toFloat())
        drawStrokes(canvas)
        return bitmap
    }
}

class DoodleScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val doodle = DoodleView(ctx)
    private val swatches = mutableListOf<Pair<View, Int>>()
    private val hint = ctx.text("", 15f, 400, ctx.col(R.color.ink2))
    private val partnerTitle = ctx.text("", 17f, 700)
    private val partnerImage = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.FIT_CENTER
        adjustViewBounds = true
        contentDescription = ctx.getString(R.string.widget_doodle_desc)
    }
    private val partnerCaption = ctx.text("", 13f, 500, ctx.col(R.color.ink2))

    private val body = ctx.column(16).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(28))
    }
    override val view: View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }

    private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == "partner_doodle_at") showPartnerDoodle()
    }

    init {
        body.addView(ctx.text(ctx.getString(R.string.doodle_title), 28f, 800).apply { letterSpacing = -0.02f })
        body.addView(hint)
        body.addView(ctx.card(paddingDp = 10).apply { addView(doodle) })
        body.addView(tools())
        body.addView(ctx.primaryButton(ctx.getString(R.string.doodle_send), R.drawable.ic_heart) { v -> send(v) })
        body.addView(partnerTitle.lp(top = 12))
        body.addView(ctx.card(paddingDp = 10, spacingDp = 8).apply {
            addView(partnerImage)
            addView(partnerCaption.apply { gravity = Gravity.CENTER })
        })

        view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) = store.prefs.registerOnSharedPreferenceChangeListener(prefsListener)
            override fun onViewDetachedFromWindow(v: View) = store.prefs.unregisterOnSharedPreferenceChangeListener(prefsListener)
        })
    }

    private fun tools(): View = ctx.row(4).apply {
        val colors = listOf(
            R.color.her to R.string.color_pink,
            R.color.him to R.string.color_blue,
            R.color.ink to R.string.color_ink,
            R.color.honey to R.string.color_honey,
        )
        for ((colorRes, nameRes) in colors) {
            val value = ctx.col(colorRes)
            val dot = View(ctx)
            val cell = FrameLayout(ctx).apply {
                contentDescription = ctx.getString(nameRes)
                background = ctx.ripple(ctx.rounded(0, 24f), 24f)
                setOnClickListener {
                    doodle.color = value
                    styleSwatches()
                }
            }
            cell.addView(dot, FrameLayout.LayoutParams(ctx.dp(32), ctx.dp(32), Gravity.CENTER))
            swatches += dot to value
            addView(cell, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
        }
        addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        addView(toolButton(R.drawable.ic_undo, R.string.doodle_undo) { doodle.undo() })
        addView(toolButton(R.drawable.ic_trash, R.string.doodle_clear) { doodle.clear() })
        styleSwatches()
    }

    private fun toolButton(iconRes: Int, labelRes: Int, onClick: () -> Unit): View = ImageView(ctx).apply {
        setImageDrawable(ctx.icon(iconRes, ctx.col(R.color.ink), 22))
        scaleType = ImageView.ScaleType.CENTER
        contentDescription = ctx.getString(labelRes)
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 24f, ctx.col(R.color.line)), 24f)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48))
    }

    private fun styleSwatches() {
        for ((dot, value) in swatches) {
            val selected = value == doodle.color
            dot.background = ctx.rounded(value, 16f, if (selected) ctx.col(R.color.ink) else null, 3f)
            (dot.parent as View).isSelected = selected
        }
    }

    private fun send(button: View) {
        if (doodle.isEmpty) {
            ctx.toast(ctx.getString(R.string.doodle_empty_warn))
            return
        }
        haptic(button)
        store.saveMyDoodle(doodle.export(600))
        store.increment(Counter.DOODLES)
        doodle.clear()
        ctx.toast(ctx.getString(R.string.doodle_sent, store.partnerDisplay))
        Widgets.updateAll(ctx)
        DemoPartner.onDoodleSent(ctx)
    }

    private fun showPartnerDoodle() {
        partnerTitle.text = ctx.getString(R.string.doodle_latest, store.partnerDisplay)
        val bitmap = store.loadPartnerDoodle(900)
        if (bitmap == null) {
            partnerImage.setImageDrawable(null)
            partnerCaption.text = ctx.getString(R.string.doodle_none)
        } else {
            partnerImage.setImageBitmap(bitmap)
            partnerCaption.text = ctx.getString(R.string.widget_from, store.partnerDisplay, Widgets.whenText(ctx, store.partnerDoodleAt))
        }
    }

    override fun refresh() {
        hint.text = ctx.getString(R.string.doodle_hint, store.partnerDisplay)
        showPartnerDoodle()
    }
}
