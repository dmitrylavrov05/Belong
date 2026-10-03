package app.belong.couple.ui

import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Shader
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.ScratchDone
import app.belong.couple.core.ScratchModel
import app.belong.couple.core.seatKey
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import java.time.Instant
import java.time.ZoneId

/**
 * "100 dates": a scratch-off poster. Each square hides a little picture under silver foil; once
 * you've been on that date, scratch it off with your finger. Both phones share the poster, and it
 * makes a story card of your progress.
 */
class ScratchScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val repo = SharedRepo(ctx)
    private val body = ctx.column(12).apply {
        val side = ctx.dp(16)
        setPadding(side, ctx.dp(8), side, ctx.dp(28))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = scroll
    private var photoFor = -1

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val ideas = ideas(ctx)
        val done = ScratchModel.done(repo.root(), repo.me)
        body.addView(ctx.text(ctx.getString(R.string.scratch_title), 28f, 700))
        body.addView(ctx.text(ctx.getString(R.string.scratch_intro), 15f, 500, ctx.col(R.color.ink2)))
        body.addView(ctx.card(paddingDp = 16, spacingDp = 8).apply {
            addView(ctx.text(ctx.getString(R.string.scratch_progress, done.size, ScratchModel.SIZE), 17f, 700))
            addView(ctx.meter((done.size + 19) / 20, ctx.col(R.color.her), 8))
            addView(ctx.primaryButton(ctx.getString(R.string.month_share), R.drawable.ic_share) {
                StoryViewer.show(activity, listOf(poster(activity, done)), autoAdvance = false)
            })
        }.lp(top = 4))
        val grid = ctx.column(6)
        (0 until ScratchModel.SIZE).chunked(5).forEach { chunk ->
            val row = ctx.row(6)
            chunk.forEach { i -> row.addView(tile(i, ideas[i], done[i]), LinearLayout.LayoutParams(0, ctx.dp(68), 1f)) }
            grid.addView(row)
        }
        body.addView(grid.lp(top = 6))
        scroll.post { scroll.scrollTo(0, y) }
    }

    /** A square: silver with its number and a faint hint while closed, the full picture once scratched. */
    private fun tile(i: Int, idea: Pair<String, String>, done: ScratchDone?): View = FrameLayout(ctx).apply {
        background = if (done != null) ctx.gradient(16f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint)) else foilDrawable()
        if (done?.photo != null) {
            addView(roundedImage(ctx, 16f).also { DayPhotos.load(it, done.photo, thumb = true) }, FrameLayout.LayoutParams(MATCH, MATCH))
        }
        addView(ctx.text(idea.first, if (done != null) 26f else 22f).apply {
            gravity = Gravity.CENTER
            alpha = if (done != null) 1f else 0.28f
        }, FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.text((i + 1).toString(), 10f, 800, ctx.col(if (done != null) R.color.on_tint else R.color.ink2)).apply {
            setPadding(ctx.dp(6), ctx.dp(3), 0, 0)
        }, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.TOP or Gravity.START))
        contentDescription = "${i + 1}. ${idea.second}" + if (done != null) ", " + ctx.getString(R.string.scratch_done) else ""
        isClickable = true
        foreground = ctx.ripple(android.graphics.drawable.ColorDrawable(0), 16f)
        setOnClickListener { open(i, idea, done) }
    }

    private fun foilDrawable() = android.graphics.drawable.GradientDrawable(
        android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFFE4E1E8.toInt(), 0xFFF7F5FA.toInt(), 0xFFCFCBD6.toInt()),
    ).apply { cornerRadius = ctx.dp(16).toFloat() }

    /** The idea, big: scratch it if you've done it, or see when you did and add a photo. */
    private fun open(i: Int, idea: Pair<String, String>, done: ScratchDone?) {
        val dialog = Dialog(activity, R.style.Theme_Belong)
        val col = ctx.column(14).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(ctx.dp(24), ctx.dp(12), ctx.dp(24), ctx.dp(28))
        }
        col.addView(ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_close, ctx.col(R.color.ink), 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = ctx.getString(R.string.pair_close)
            background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 22f), 22f)
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)).apply { gravity = Gravity.START })
        col.addView(ctx.text("№ ${i + 1}", 14f, 800, ctx.col(R.color.ink2)))
        col.addView(ctx.text(idea.second, 26f, 800).apply { gravity = Gravity.CENTER })

        val card = FrameLayout(ctx).apply { background = ctx.gradient(28f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint)) }
        val photoBox = FrameLayout(ctx)
        card.addView(photoBox, FrameLayout.LayoutParams(MATCH, MATCH))
        card.addView(ctx.text(idea.first, 96f).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(MATCH, MATCH))
        if (done?.photo != null) photoBox.addView(roundedImage(ctx, 28f).also { DayPhotos.load(it, done.photo, thumb = false) }, FrameLayout.LayoutParams(MATCH, MATCH))
        col.addView(card, LinearLayout.LayoutParams(ctx.dp(260), ctx.dp(260)))

        val status = ctx.text("", 15f, 600, ctx.col(R.color.ink2)).apply { gravity = Gravity.CENTER }
        col.addView(status)
        val actions = ctx.column(8)
        col.addView(actions, LinearLayout.LayoutParams(MATCH, WRAP))
        fun showDone(at: Long) {
            val date = ctx.formatLongDate(Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalDate())
            status.text = ctx.getString(R.string.scratch_done_on, date)
            actions.removeAllViews()
            actions.addView(ctx.secondaryButton(ctx.getString(R.string.scratch_add_photo), R.drawable.ic_image) {
                photoFor = i
                dialog.dismiss()
                pickPhoto()
            })
        }
        if (done != null) {
            showDone(done.at)
        } else {
            status.text = ctx.getString(R.string.scratch_hint)
            card.addView(ScratchView(ctx) {
                val now = System.currentTimeMillis()
                repo.put("scratch/$i", org.json.JSONObject().put("at", now).put("by", seatKey(repo.me, mine = true)))
                haptic(card)
                card.addView(Confetti(ctx, now), FrameLayout.LayoutParams(MATCH, MATCH))
                showDone(now)
            }, FrameLayout.LayoutParams(MATCH, MATCH))
        }
        dialog.setContentView(ScrollView(ctx).apply {
            setBackgroundColor(ctx.col(R.color.bg))
            isFillViewport = true
            addView(col)
        })
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.show()
    }

    private fun pickPhoto() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        try {
            @Suppress("DEPRECATION")
            activity.startActivityForResult(Intent.createChooser(intent, ctx.getString(R.string.scratch_add_photo)), MainActivity.REQUEST_SCRATCH_PHOTO)
        } catch (e: android.content.ActivityNotFoundException) {
            Toaster.show(activity, ctx.getString(R.string.photos_no_gallery))
        }
    }

    /** Called by MainActivity with the picked photo. */
    fun onPhotoPicked(data: Intent?) {
        val uri = data?.data ?: return
        val i = photoFor.takeIf { it >= 0 } ?: return
        DayPhotos.setPhoto(ctx, uri, "scratch/$i/photo") { ok -> if (!ok) Toaster.show(activity, ctx.getString(R.string.photos_failed)) }
    }

    companion object {
        fun ideas(context: Context): List<Pair<String, String>> =
            context.resources.getStringArray(R.array.scratch_ideas).map { it.substringBefore('|') to it.substringAfter('|') }

        /** The story card: the poster with scratched squares in colour and the rest still silver. */
        fun poster(a: MainActivity, done: Map<Int, ScratchDone>): Bitmap {
            val (bmp, c) = StoryKit.canvas(StoryKit.BACKGROUNDS[0])
            var y = StoryKit.text(c, a, a.getString(R.string.scratch_title), 84f, 800, StoryKit.INK, 150f)
            y = StoryKit.text(c, a, a.getString(R.string.scratch_poster_line, done.size, ScratchModel.SIZE), 46f, 700, StoryKit.INK2, y + 16f)
            val ideas = ideas(a)
            val cell = 88f
            val gap = 8f
            val left = (StoryKit.W - (10 * cell + 9 * gap)) / 2f
            val top = y + 60f
            val foil = Paint(Paint.ANTI_ALIAS_FLAG)
            val tint = Paint(Paint.ANTI_ALIAS_FLAG)
            val number = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = Fonts.get(a, 800)
                textSize = 22f
                color = StoryKit.INK2
                textAlign = Paint.Align.CENTER
            }
            for (i in 0 until ScratchModel.SIZE) {
                val x = left + (i % 10) * (cell + gap)
                val yy = top + (i / 10) * (cell + gap)
                val r = RectF(x, yy, x + cell, yy + cell)
                if (done.containsKey(i)) {
                    tint.shader = LinearGradient(r.left, r.top, r.right, r.bottom, 0xFFFFD6E3.toInt(), 0xFFD6E6FF.toInt(), Shader.TileMode.CLAMP)
                    c.drawRoundRect(r, 18f, 18f, tint)
                    Emoji.draw(c, a, ideas[i].first, r.centerX(), r.centerY(), 56f, Paint())
                } else {
                    foil.shader = LinearGradient(r.left, r.top, r.right, r.bottom, intArrayOf(0xFFE4E1E8.toInt(), 0xFFF7F5FA.toInt(), 0xFFCFCBD6.toInt()), null, Shader.TileMode.CLAMP)
                    c.drawRoundRect(r, 18f, 18f, foil)
                    c.drawText((i + 1).toString(), r.centerX(), r.centerY() + 8f, number)
                }
            }
            StoryKit.text(c, a, a.getString(R.string.scratch_poster_cta), 40f, 600, StoryKit.INK2, top + 10 * (cell + gap) + 40f)
            StoryKit.footer(c, a)
            return bmp
        }
    }
}

/** Silver foil you rub off with a finger; [onRevealed] runs once most of it is gone. */
class ScratchView(context: Context, private val onRevealed: () -> Unit) : View(context) {
    private var foil: Bitmap? = null
    private var foilCanvas: Canvas? = null
    private val eraser = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = context.dp(36).toFloat()
    }
    private val path = android.graphics.Path()
    private var revealed = false

    init {
        contentDescription = context.getString(R.string.scratch_hint)
        isClickable = true
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        if (w <= 0 || h <= 0) return
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val r = RectF(0f, 0f, w.toFloat(), h.toFloat())
        c.drawRoundRect(r, context.dp(28).toFloat(), context.dp(28).toFloat(), Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), intArrayOf(0xFFD9D5DF.toInt(), 0xFFF4F2F7.toInt(), 0xFFC4BFCC.toInt(), 0xFFEDEAF1.toInt()), null, Shader.TileMode.CLAMP)
        })
        val sparkle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x66FFFFFF }
        val random = java.util.Random(7)
        repeat(40) { c.drawCircle(random.nextFloat() * w, random.nextFloat() * h, 2f + random.nextFloat() * 4f, sparkle) }
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(context, 800)
            textSize = context.dp(18).toFloat()
            color = 0xFF8A8494.toInt()
            textAlign = Paint.Align.CENTER
        }
        c.drawText(context.getString(R.string.scratch_rub), w / 2f, h / 2f + label.textSize / 3, label)
        foil = bmp
        foilCanvas = c
    }

    override fun onDraw(canvas: Canvas) {
        foil?.let { canvas.drawBitmap(it, 0f, 0f, null) }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (revealed) return false
        parent?.requestDisallowInterceptTouchEvent(true)
        when (e.action) {
            MotionEvent.ACTION_DOWN -> path.moveTo(e.x, e.y)
            MotionEvent.ACTION_MOVE -> {
                path.lineTo(e.x, e.y)
                foilCanvas?.drawPath(path, eraser)
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                path.reset()
                if (cleared() > 0.55f) reveal()
            }
        }
        return true
    }

    /** The share of the foil already rubbed off, sampled on a grid. */
    private fun cleared(): Float {
        val bmp = foil ?: return 0f
        var gone = 0
        var all = 0
        val step = maxOf(4, bmp.width / 30)
        var y = step / 2
        while (y < bmp.height) {
            var x = step / 2
            while (x < bmp.width) {
                all++
                if (bmp.getPixel(x, y) ushr 24 < 40) gone++
                x += step
            }
            y += step
        }
        return if (all == 0) 0f else gone.toFloat() / all
    }

    private fun reveal() {
        revealed = true
        animate().alpha(0f).setDuration(350).withEndAction { visibility = GONE }.start()
        onRevealed()
    }
}
