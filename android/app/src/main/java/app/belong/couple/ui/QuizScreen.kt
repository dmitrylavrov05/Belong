package app.belong.couple.ui

import android.app.Dialog
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.QuizModel
import app.belong.couple.data.CoupleStore
import app.belong.couple.sync.Quiz
import java.time.LocalDate
import java.time.ZoneId

/** One quiz question in both forms: about you ("What would you order…?") and about your partner. */
data class QuizQuestion(val aboutMe: String, val aboutPartner: String, val options: List<String>)

/**
 * "How well do you know me?": ten questions a week. For each one you guess your partner's answer,
 * then give your own. When both have played, you see who knows whom better.
 */
object QuizScreen {
    private val LETTERS = listOf("A", "B", "C", "D")

    fun bank(ctx: android.content.Context): List<QuizQuestion> = ctx.resources.getStringArray(R.array.quiz_bank).map { line ->
        val p = line.split('|')
        QuizQuestion(p[0], p[1], p.drop(2).take(4))
    }

    fun show(a: MainActivity) {
        val dialog = Dialog(a, R.style.Theme_Belong)
        val stage = FrameLayout(a).apply { setBackgroundColor(a.col(R.color.bg)) }
        dialog.setContentView(stage)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        val round = QuizModel.round(LocalDate.now(ZoneId.systemDefault()).toEpochDay())
        val bank = bank(a)
        val questions = QuizModel.questions(round, bank.size).map { bank[it] }
        val mine = Quiz.mine(a, round)
        dialog.show() // before drawing: the demo partner's answers arrive at once and need a showing dialog
        if (mine.done) results(a, dialog, stage, round, questions) else step(a, dialog, stage, round, questions, mine)
    }

    /** The next unanswered question: first the guess about the partner, then your own answer. */
    private fun step(a: MainActivity, dialog: Dialog, stage: FrameLayout, round: Long, questions: List<QuizQuestion>, entry: Quiz.Entry) {
        val store = CoupleStore.get(a)
        val index = questions.indices.firstOrNull { it !in entry.guess || it !in entry.self }
        if (index == null) {
            Quiz.submit(a, round, entry) { ok ->
                if (!ok) Toaster.show(a, a.getString(R.string.pair_error_network))
                if (dialog.isShowing) results(a, dialog, stage, round, questions)
            }
            return
        }
        val guessing = index !in entry.guess
        val q = questions[index]
        stage.removeAllViews()
        val page = a.column(12).apply { setPadding(a.dp(20), a.dp(12), a.dp(20), a.dp(24)) }
        page.addView(topBar(a, dialog))
        page.addView(progress(a, index, questions.size))
        page.addView(a.text(a.getString(R.string.quiz_title), 13f, 700, a.col(R.color.ink2)).lp(top = 8))
        page.addView(a.text(if (guessing) q.aboutPartner.format(store.partnerDisplay) else q.aboutMe, 28f, 700).apply { letterSpacing = -0.01f })
        page.addView(a.text(
            if (guessing) a.getString(R.string.quiz_guess_hint, store.partnerDisplay) else a.getString(R.string.quiz_self_hint),
            15f, 500, a.col(R.color.ink2),
        ))
        var chosen = -1
        val options = a.column(10)
        val answer = a.primaryButton(a.getString(R.string.quiz_answer)) {
            if (chosen < 0) return@primaryButton
            val next = if (guessing) entry.copy(guess = entry.guess + (index to chosen)) else entry.copy(self = entry.self + (index to chosen))
            Quiz.save(a, round, next)
            step(a, dialog, stage, round, questions, next)
        }.apply {
            isEnabled = false
            alpha = 0.5f
        }
        fun drawOptions() {
            options.removeAllViews()
            q.options.forEachIndexed { i, option ->
                val selected = i == chosen
                options.addView(a.row(14).apply {
                    minimumHeight = a.dp(56)
                    setPadding(a.dp(14), 0, a.dp(14), 0)
                    background = a.ripple(
                        if (selected) a.rounded(a.col(R.color.her_tint), 16f, a.col(R.color.her), 2f) else a.rounded(a.col(R.color.surface), 16f),
                        16f,
                    )
                    if (!selected) softShadow(2f)
                    addView(a.text(LETTERS[i], 14f, 800).apply {
                        gravity = Gravity.CENTER
                        background = a.rounded(a.col(if (selected) R.color.surface else R.color.sunk), 10f)
                    }, LinearLayout.LayoutParams(a.dp(32), a.dp(32)))
                    addView(a.text(option, 16f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
                    isSelected = selected
                    setOnClickListener { v ->
                        haptic(v)
                        chosen = i
                        answer.isEnabled = true
                        answer.alpha = 1f
                        drawOptions()
                    }
                })
            }
        }
        drawOptions()
        page.addView(options.lp(top = 8))
        page.addView(View(a), LinearLayout.LayoutParams(1, 0, 1f))
        page.addView(answer.apply { minHeight = a.dp(56) })
        stage.addView(ScrollView(a).apply {
            isFillViewport = true
            addView(page)
        }, FrameLayout.LayoutParams(MATCH, MATCH))
    }

    private fun topBar(a: MainActivity, dialog: Dialog): View = a.row(8).apply {
        addView(ImageView(a).apply {
            setImageDrawable(a.icon(R.drawable.ic_close, a.col(R.color.ink), 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = a.getString(R.string.pair_close)
            background = a.ripple(a.rounded(a.col(R.color.bg), 22f), 22f)
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(a.dp(44), a.dp(44)))
    }

    /** Ten segments; done ones take the pair colours from pink to blue. */
    private fun progress(a: MainActivity, index: Int, total: Int): View = a.row(8).apply {
        val bar = a.row(4)
        for (i in 0 until total) {
            val t = i / (total - 1f).coerceAtLeast(1f)
            val color = if (i < index) blend(a.col(R.color.her), a.col(R.color.him), t) else a.col(R.color.sunk)
            bar.addView(View(a).apply { background = a.rounded(color, 3f) }, LinearLayout.LayoutParams(0, a.dp(5), 1f))
        }
        addView(bar, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(a.text(a.getString(R.string.matches_progress, index + 1, total), 12f, 700, a.col(R.color.ink2)))
    }

    private fun blend(from: Int, to: Int, t: Float): Int {
        fun ch(shift: Int) = (((from shr shift) and 0xFF) * (1 - t) + ((to shr shift) and 0xFF) * t).toInt()
        return (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    /** After my round: the score once the partner has played, or a note that we're waiting for them. */
    private fun results(a: MainActivity, dialog: Dialog, stage: FrameLayout, round: Long, questions: List<QuizQuestion>) {
        val store = CoupleStore.get(a)
        val mine = Quiz.mine(a, round)
        stage.removeAllViews()
        val page = a.column(12).apply { setPadding(a.dp(20), a.dp(12), a.dp(20), a.dp(24)) }
        page.addView(topBar(a, dialog))
        page.addView(a.text(a.getString(R.string.quiz_title), 28f, 700))
        val box = a.column(12)
        page.addView(box)
        box.addView(a.text(a.getString(R.string.quiz_waiting, store.partnerDisplay), 16f, 500, a.col(R.color.ink2)))
        stage.addView(ScrollView(a).apply { addView(page) }, FrameLayout.LayoutParams(MATCH, MATCH))

        Quiz.partner(a, round) { partner ->
            if (!dialog.isShowing || partner == null) return@partner
            box.removeAllViews()
            val myScore = QuizModel.score(mine.guess, partner.self)
            val theirScore = QuizModel.score(partner.guess, mine.self)
            box.addView(a.row(10).apply {
                gravity = Gravity.CENTER
                addView(scoreChip(a, "${store.myName} $myScore", R.color.her_tint))
                addView(a.text(":", 20f, 800))
                addView(scoreChip(a, "$theirScore ${store.partnerDisplay}", R.color.him_tint))
            }.lp(top = 8))
            box.addView(a.text(
                when {
                    myScore > theirScore -> a.getString(R.string.quiz_you_won, store.partnerDisplay)
                    myScore < theirScore -> a.getString(R.string.quiz_they_won, store.partnerDisplay)
                    else -> a.getString(R.string.quiz_tie)
                },
                17f, 700,
            ).apply { gravity = Gravity.CENTER })
            questions.forEachIndexed { i, q ->
                val guess = mine.guess[i]
                val actual = partner.self[i]
                val right = guess != null && guess == actual
                box.addView(a.card(paddingDp = 14, spacingDp = 4).apply {
                    addView(a.text(q.aboutPartner.format(store.partnerDisplay), 15f, 700))
                    addView(a.text(
                        a.getString(R.string.quiz_result_line, actual?.let { q.options[it] } ?: "—", guess?.let { q.options[it] } ?: "—"),
                        13f, 500, a.col(R.color.ink2),
                    ))
                    addView(a.text(if (right) "✓" else "✗", 15f, 800, a.col(if (right) R.color.ok_ink else R.color.her)))
                })
            }
            box.addView(a.text(a.getString(R.string.quiz_next_week), 13f, 500, a.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        }
    }

    private fun scoreChip(a: MainActivity, text: String, tint: Int): View = a.text(text, 16f, 800).apply {
        background = a.rounded(a.col(tint), 999f)
        setPadding(a.dp(14), a.dp(6), a.dp(14), a.dp(6))
    }
}
