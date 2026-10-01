package app.belong.couple.ui

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.core.DateMatch
import app.belong.couple.core.Wheel
import app.belong.couple.core.WheelIdea
import app.belong.couple.data.CoupleStore
import kotlin.math.abs
import kotlin.math.min
import kotlin.random.Random

/** The date wheel: sectors drawn on a canvas, spun with a decelerating animation. */
class WheelView(context: Context) : View(context) {
    var ideas: List<WheelIdea> = emptyList()
        set(value) {
            field = value
            invalidate()
        }
    var spinning = false
        private set
    private var rotationDeg = 0f
    private val fills = intArrayOf(context.col(R.color.her_tint), context.col(R.color.him_tint), context.col(R.color.sunk))
    private val sectorPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = context.col(R.color.ink)
        typeface = Fonts.get(context, 700)
        textSize = context.dp(13).toFloat()
    }
    private val hubPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = context.col(R.color.surface) }
    private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = context.col(R.color.surface)
        strokeWidth = context.dp(6).toFloat()
    }
    private val pointerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = context.col(R.color.ink) }
    private val oval = RectF()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = min(MeasureSpec.getSize(widthMeasureSpec), context.dp(320))
        setMeasuredDimension(size, size)
    }

    override fun onDraw(canvas: Canvas) {
        val n = ideas.size
        if (n == 0) return
        val cx = width / 2f
        val cy = height / 2f
        val r = min(cx, cy) - context.dp(10)
        oval.set(cx - r, cy - r, cx + r, cy + r)
        val sweep = 360f / n

        canvas.save()
        canvas.rotate(rotationDeg, cx, cy)
        for (i in 0 until n) {
            val start = -90f + i * sweep
            sectorPaint.color = fills[i % fills.size]
            canvas.drawArc(oval, start, sweep, true, sectorPaint)
        }
        for (i in 0 until n) {
            val angle = -90f + (i + 0.5f) * sweep
            val screenAngle = (((angle + rotationDeg) % 360f) + 360f) % 360f
            val flipped = screenAngle > 90f && screenAngle < 270f
            val label = ellipsize(ideas[i].short, r * 0.55f)
            canvas.save()
            canvas.rotate(angle, cx, cy)
            val x = cx + r * 0.88f
            val y = cy + labelPaint.textSize / 3f
            if (flipped) {
                // Turn the label upside up: rotate around a point inside the sector and mirror its start.
                val pivot = cx + r * 0.6f
                canvas.rotate(180f, pivot, cy)
                labelPaint.textAlign = Paint.Align.LEFT
                canvas.drawText(label, 2 * pivot - x, y, labelPaint)
            } else {
                labelPaint.textAlign = Paint.Align.RIGHT
                canvas.drawText(label, x, y, labelPaint)
            }
            canvas.restore()
        }
        canvas.restore()

        canvas.drawCircle(cx, cy, r, rimPaint)
        canvas.drawCircle(cx, cy, r * 0.2f, hubPaint)
        val p = context.dp(12).toFloat()
        val pointer = Path().apply {
            moveTo(cx - p, cy - r - p * 0.6f)
            lineTo(cx + p, cy - r - p * 0.6f)
            lineTo(cx, cy - r + p * 1.2f)
            close()
        }
        canvas.drawPath(pointer, pointerPaint)
    }

    private fun ellipsize(text: String, maxWidth: Float): String {
        if (labelPaint.measureText(text) <= maxWidth) return text
        var t = text
        while (t.length > 1 && labelPaint.measureText("$t…") > maxWidth) t = t.dropLast(1)
        return "$t…"
    }

    /** Spins to a random sector and reports its index when the wheel stops. */
    fun spin(onDone: (Int) -> Unit) {
        val n = ideas.size
        if (n == 0 || spinning) return
        val index = Random.nextInt(n)
        val sweep = 360f / n
        val target = Wheel.targetRotation(rotationDeg, index, n, jitter = (Random.nextFloat() - 0.5f) * sweep * 0.5f)
        spinning = true
        ValueAnimator.ofFloat(rotationDeg, target).apply {
            duration = if (ValueAnimator.areAnimatorsEnabled()) 3_000 else 0
            interpolator = DecelerateInterpolator(2.2f)
            addUpdateListener {
                rotationDeg = it.animatedValue as Float
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    rotationDeg %= 360f
                    spinning = false
                    onDone(index)
                }
            })
            start()
        }
    }
}

class GamesScreen(private val activity: MainActivity) : Screen {
    private enum class Phase { INTRO, SWIPE_A, PASS, SWIPE_B, RESULT }

    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val cards: List<Pair<String, String>> = ctx.resources.getStringArray(R.array.match_cards).map {
        val parts = it.split('|', limit = 2)
        parts[0] to parts[1]
    }
    private val ideas: List<WheelIdea> = ctx.resources.getStringArray(R.array.wheel_ideas).mapNotNull { WheelIdea.parse(it) }
    private val budgets: Array<String> = ctx.resources.getStringArray(R.array.wheel_budgets)

    private var phase = Phase.INTRO
    private val answersA = mutableListOf<Boolean>()
    private val answersB = mutableListOf<Boolean>()
    private var budget = 1
    private var place = "home"

    private val matchCard = ctx.card(spacingDp = 14)
    private val wheelCard = ctx.card(spacingDp = 14)
    private val wheel = WheelView(ctx)
    private val wheelResult = ctx.text("", 18f, 700)

    private val body = ctx.column(18).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(28))
        addView(ctx.text(ctx.getString(R.string.games_title), 28f, 800).apply { letterSpacing = -0.02f })
        addView(matchCard)
        addView(wheelCard)
    }
    override val view: View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }

    init {
        buildWheelCard()
    }

    override fun refresh() = renderMatch()

    // ---------- Date Match ----------

    private fun renderMatch() {
        matchCard.removeAllViews()
        when (phase) {
            Phase.INTRO -> {
                matchCard.addView(ctx.text(ctx.getString(R.string.match_title), 22f, 800))
                matchCard.addView(ctx.text(ctx.getString(R.string.match_text), 15f, 400, ctx.col(R.color.ink2)))
                matchCard.addView(ctx.primaryButton(ctx.getString(R.string.match_start)) {
                    answersA.clear()
                    answersB.clear()
                    phase = Phase.SWIPE_A
                    renderMatch()
                })
            }
            Phase.SWIPE_A -> swipeView(store.myName, answersA, R.color.her)
            Phase.SWIPE_B -> swipeView(store.partnerName, answersB, R.color.him)
            Phase.PASS -> {
                matchCard.addView(ctx.text(ctx.getString(R.string.match_pass, store.partnerName), 22f, 800))
                matchCard.addView(ctx.primaryButton(ctx.getString(R.string.match_continue)) {
                    phase = Phase.SWIPE_B
                    renderMatch()
                })
            }
            Phase.RESULT -> resultView()
        }
    }

    private fun swipeView(name: String, answers: MutableList<Boolean>, dotColor: Int) {
        val index = answers.size
        val (emoji, title) = cards[index]
        val top = ctx.row(8)
        top.addView(ctx.text("●", 14f, 700, ctx.col(dotColor)))
        top.addView(ctx.text(ctx.getString(R.string.match_turn, name), 15f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        top.addView(ctx.text(ctx.getString(R.string.match_progress, index + 1, cards.size), 14f, 600, ctx.col(R.color.ink2)))
        matchCard.addView(top)

        val progress = ctx.row(3)
        for (i in cards.indices) {
            progress.addView(View(ctx).apply {
                background = ctx.rounded(ctx.col(if (i < index) R.color.us_end else R.color.sunk), 3f)
            }, LinearLayout.LayoutParams(0, ctx.dp(5), 1f))
        }
        matchCard.addView(progress)

        val card = ctx.column(0).apply {
            background = ctx.rounded(ctx.col(R.color.surface), 24f, ctx.col(R.color.line))
            elevation = ctx.dp(4).toFloat()
            contentDescription = title
        }
        card.addView(ctx.text(emoji, 64f).apply {
            gravity = Gravity.CENTER
            background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(MATCH, ctx.dp(170)))
        card.addView(ctx.text(title, 20f, 700).apply {
            val p = ctx.dp(16)
            setPadding(p, p, p, p)
            minLines = 2
        })
        attachSwipe(card) { yes -> answer(answers, yes) }
        matchCard.addView(card)

        val buttons = ctx.row(12)
        buttons.addView(ctx.secondaryButton(ctx.getString(R.string.match_no)) { answer(answers, false) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        buttons.addView(ctx.primaryButton(ctx.getString(R.string.match_yes), R.drawable.ic_heart) { answer(answers, true) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        matchCard.addView(buttons)
    }

    private fun attachSwipe(card: View, onDecide: (Boolean) -> Unit) {
        var startX = 0f
        card.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = e.rawX
                    v.parent?.requestDisallowInterceptTouchEvent(true)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - startX
                    v.translationX = dx
                    v.rotation = dx / 40f
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    val dx = e.rawX - startX
                    v.parent?.requestDisallowInterceptTouchEvent(false)
                    if (abs(dx) > v.width * 0.3f) {
                        v.animate().translationX(if (dx > 0) v.width * 1.5f else -v.width * 1.5f).setDuration(180)
                            .withEndAction { onDecide(dx > 0) }.start()
                    } else {
                        v.animate().translationX(0f).rotation(0f).setDuration(150).start()
                        if (abs(dx) < 8 && e.actionMasked == MotionEvent.ACTION_UP) v.performClick()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun answer(answers: MutableList<Boolean>, yes: Boolean) {
        if (answers.size >= cards.size) return
        answers += yes
        if (answers.size == cards.size) {
            phase = if (phase == Phase.SWIPE_A) Phase.PASS else Phase.RESULT
        }
        renderMatch()
    }

    private fun resultView() {
        val matched = DateMatch.matches(answersA, answersB)
        matchCard.addView(ctx.text(ctx.getString(R.string.couple_line, store.myName, store.partnerName), 14f, 600, ctx.col(R.color.ink2)))
        matchCard.addView(ctx.text(ctx.getString(R.string.match_result, matched.size, cards.size), 24f, 800))
        if (matched.isEmpty()) {
            matchCard.addView(ctx.text(ctx.getString(R.string.match_none), 15f, 400, ctx.col(R.color.ink2)))
        } else {
            for (i in matched) {
                val (emoji, title) = cards[i]
                matchCard.addView(ctx.text("$emoji  $title", 15f, 700).apply {
                    background = ctx.gradient(16f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
                    val p = ctx.dp(12)
                    setPadding(p, p, p, p)
                })
            }
        }
        val buttons = ctx.row(12)
        buttons.addView(ctx.secondaryButton(ctx.getString(R.string.match_again)) {
            phase = Phase.INTRO
            renderMatch()
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        buttons.addView(ctx.primaryButton(ctx.getString(R.string.share), R.drawable.ic_share) {
            val lines = matched.joinToString("\n") { "${cards[it].first} ${cards[it].second}" }
            val text = ctx.getString(R.string.match_share_text, matched.size, cards.size) + if (lines.isEmpty()) "" else "\n$lines"
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            ctx.startActivity(Intent.createChooser(send, ctx.getString(R.string.share)))
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        matchCard.addView(buttons)
    }

    // ---------- Date wheel ----------

    private fun buildWheelCard() {
        wheelCard.removeAllViews()
        wheelCard.addView(ctx.text(ctx.getString(R.string.wheel_title), 22f, 800))
        wheelCard.addView(ctx.text(ctx.getString(R.string.wheel_text), 15f, 400, ctx.col(R.color.ink2)))

        val budgetRow = ctx.row(8)
        budgets.forEachIndexed { i, label ->
            budgetRow.addView(ctx.chip(label, i == budget) {
                if (wheel.spinning) return@chip
                budget = i
                buildWheelCard()
            })
        }
        wheelCard.addView(budgetRow)
        val placeRow = ctx.row(8)
        listOf("home" to R.string.wheel_home, "out" to R.string.wheel_out).forEach { (value, label) ->
            placeRow.addView(ctx.chip(ctx.getString(label), value == place) {
                if (wheel.spinning) return@chip
                place = value
                buildWheelCard()
            })
        }
        wheelCard.addView(placeRow)

        wheel.ideas = Wheel.sectors(ideas, budget, place)
        (wheel.parent as? FrameLayout)?.removeView(wheel)
        val holder = FrameLayout(ctx)
        holder.addView(wheel, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER))
        wheelCard.addView(holder)
        wheelResult.text = ""
        (wheelResult.parent as? LinearLayout)?.removeView(wheelResult)
        wheelCard.addView(wheelResult)
        wheelCard.addView(ctx.primaryButton(ctx.getString(R.string.wheel_spin)) { v ->
            haptic(v)
            wheelResult.text = ""
            wheel.spin { index ->
                val idea = wheel.ideas[index]
                wheelResult.text = "${ctx.getString(R.string.wheel_result)}: ${idea.full}"
                wheelResult.announceForAccessibility(wheelResult.text)
            }
        })
    }
}
