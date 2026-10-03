package app.belong.couple.ui

import android.graphics.BlurMaskFilter
import android.graphics.Paint
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.core.DailyQuestions
import app.belong.couple.core.Owner
import app.belong.couple.core.TogetherModel
import app.belong.couple.core.seatKey
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.SharedRepo
import app.belong.couple.sync.DayQuestion
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** The everyday cards on Today: the question of the day and the evening "thank you". */
class EverydayCards(private val activity: MainActivity, private val refresh: () -> Unit) {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private val today: Long get() = LocalDate.now(ZoneId.systemDefault()).toEpochDay()

    private var questionOpen = false

    // ---------- Question of the day ----------

    /** The full card until you've both answered; then one line to open your answers again. */
    fun questionCompact(): View {
        val day = today
        val bothAnswered = DayQuestion.mine(ctx, day) != null && DayQuestion.cachedPartner(ctx, day) != null
        if (!bothAnswered || questionOpen) return questionCard()
        return ctx.card(paddingDp = 16, spacingDp = 0).apply {
            val r = ctx.row(12)
            r.addView(ctx.text("💬", 22f))
            val t = ctx.column(2)
            t.addView(ctx.text(ctx.getString(R.string.question_title), 16f, 700))
            t.addView(ctx.text(ctx.getString(R.string.home_question_done), 13f, 500, ctx.col(R.color.ok_ink)))
            r.addView(t, LinearLayout.LayoutParams(0, WRAP, 1f))
            r.addView(ctx.text(ctx.getString(R.string.home_show), 14f, 700, ctx.col(R.color.him)))
            addView(r)
            isClickable = true
            background = ctx.ripple(background, 24f)
            setOnClickListener {
                questionOpen = true
                refresh()
            }
        }
    }

    fun questionCard(): View = ctx.card(paddingDp = 16, spacingDp = 12).apply {
        val day = today
        val questions = ctx.resources.getStringArray(R.array.daily_questions)
        val question = questions[DailyQuestions.index(day, questions.size)]
        val label = ctx.row(8)
        label.addView(ctx.ownerDot(null))
        label.addView(ctx.text(ctx.getString(R.string.question_title), 13f, 700, ctx.col(R.color.ink2)))
        addView(label)
        addView(ctx.text(question, 20f, 700))

        val mine = DayQuestion.mine(ctx, day)
        if (mine == null) {
            // Answered in a sheet: Today redraws when the partner's data arrives, which would lose typing here.
            addView(ctx.primaryButton(ctx.getString(R.string.question_answer)) { answerSheet(day, question) })
        } else {
            addView(bubble(store.myName, mine, R.color.her_tint))
        }

        val partnerAnswered = TogetherModel.flag(repo.root(), "question", day, seatKey(repo.me, mine = false))
        val partnerBox = FrameLayout(ctx)
        addView(partnerBox)
        when {
            mine == null && partnerAnswered -> partnerBox.addView(lockedBubble())
            mine == null -> partnerBox.addView(bubble(store.partnerDisplay, ctx.getString(R.string.question_partner_not_yet, store.partnerDisplay), R.color.him_tint, muted = true))
            else -> {
                val cached = DayQuestion.cachedPartner(ctx, day)
                partnerBox.addView(bubble(store.partnerDisplay, cached ?: ctx.getString(R.string.question_partner_not_yet, store.partnerDisplay), R.color.him_tint, muted = cached == null))
                if (cached == null) DayQuestion.partner(ctx, day) { text ->
                    if (text != null) {
                        partnerBox.removeAllViews()
                        partnerBox.addView(bubble(store.partnerDisplay, text, R.color.him_tint))
                    }
                }
            }
        }
    }

    private fun answerSheet(day: Long, question: String) = activity.bottomSheet { sheet, dialog ->
        sheet.addView(ctx.text(ctx.getString(R.string.question_title), 13f, 700, ctx.col(R.color.ink2)))
        sheet.addView(ctx.text(question, 22f, 700))
        val input = input(ctx.getString(R.string.question_hint), 500).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minHeight = ctx.dp(112)
            gravity = Gravity.TOP
        }
        sheet.addView(input)
        sheet.addView(ctx.primaryButton(ctx.getString(R.string.question_answer)) { button ->
            val text = input.text.toString().trim()
            if (text.isEmpty()) return@primaryButton
            button.isEnabled = false
            DayQuestion.answer(ctx, day, text) { ok ->
                if (!ok) Toaster.show(activity, ctx.getString(R.string.pair_error_network))
                dialog.dismiss()
                refresh()
            }
        }.lp(top = 4))
        input.requestFocus()
    }

    private fun bubble(name: String, text: String, tint: Int, muted: Boolean = false): View = ctx.column(4).apply {
        background = ctx.rounded(ctx.col(tint), 16f)
        setPadding(ctx.dp(14), ctx.dp(10), ctx.dp(14), ctx.dp(12))
        addView(ctx.text(name, 12f, 700, ctx.col(R.color.on_tint)))
        addView(ctx.text(text, 15f, if (muted) 500 else 400, ctx.col(if (muted) R.color.on_tint else R.color.ink)))
    }

    /** The partner's answer hidden behind a blur and a lock until you answer. The text under the blur is not theirs. */
    private fun lockedBubble(): View = FrameLayout(ctx).apply {
        background = ctx.rounded(ctx.col(R.color.him_tint), 16f)
        val fake = ctx.text(ctx.getString(R.string.question_blur_filler), 15f, 400, ctx.col(R.color.on_tint)).apply {
            setLayerType(View.LAYER_TYPE_SOFTWARE, null)
            paint.maskFilter = BlurMaskFilter(ctx.dp(5).toFloat(), BlurMaskFilter.Blur.NORMAL)
            alpha = 0.7f
            setPadding(ctx.dp(14), ctx.dp(28), ctx.dp(14), ctx.dp(14))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        addView(fake, FrameLayout.LayoutParams(MATCH, WRAP))
        addView(ctx.text(store.partnerDisplay, 12f, 700, ctx.col(R.color.on_tint)).apply { setPadding(ctx.dp(14), ctx.dp(10), 0, 0) })
        addView(ctx.text(ctx.getString(R.string.question_locked, store.partnerDisplay), 14f, 700).apply {
            gravity = Gravity.CENTER
            setCompoundDrawablesRelative(ctx.icon(R.drawable.ic_lock, ctx.col(R.color.ink), 16), null, null, null)
            compoundDrawablePadding = ctx.dp(6)
        }, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER))
    }

    // ---------- Evening "thank you" ----------

    /** In the evening: a prompt to thank the partner. During the day: the note they left last night. */
    fun eveningCard(): View? {
        val root = repo.root()
        val day = today
        val fromPartner = TogetherModel.thanks(root, day - 1, seatKey(repo.me, mine = false))
        val mineToday = TogetherModel.thanks(root, day, seatKey(repo.me, mine = true))
        val hour = LocalTime.now().hour
        val evening = hour >= 18 || hour < 4
        return when {
            evening && mineToday == null -> ctx.card(paddingDp = 16, spacingDp = 10, background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))).apply {
                elevation = 0f
                addView(ctx.text("🌙 " + ctx.getString(R.string.evening_title), 13f, 700, ctx.col(R.color.on_tint)))
                addView(ctx.text(ctx.getString(R.string.evening_question, store.partnerDisplay), 18f, 700))
                addView(ctx.primaryButton(ctx.getString(R.string.evening_write)) { eveningSheet() })
            }
            evening && mineToday != null -> ctx.card(paddingDp = 16, spacingDp = 6).apply {
                addView(ctx.text("🌙 " + ctx.getString(R.string.evening_sent, store.partnerDisplay), 14f, 700, ctx.col(R.color.ok_ink)))
                addView(ctx.text("«$mineToday»", 15f, 400, ctx.col(R.color.ink2)))
            }
            fromPartner != null -> ctx.card(paddingDp = 16, spacingDp = 8, background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))).apply {
                elevation = 0f
                addView(ctx.text("💌 " + ctx.getString(R.string.evening_from, store.partnerDisplay), 13f, 700, ctx.col(R.color.on_tint)))
                addView(ctx.text(fromPartner, 17f, 600))
            }
            else -> null
        }
    }

    private fun eveningSheet() = activity.bottomSheet { sheet, dialog ->
        sheet.addView(ctx.text("🌙 " + ctx.getString(R.string.evening_title), 13f, 700, ctx.col(R.color.ink2)))
        sheet.addView(ctx.text(ctx.getString(R.string.evening_question, store.partnerDisplay), 24f, 700))
        val input = input("", 300).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minHeight = ctx.dp(112)
            gravity = Gravity.TOP
        }
        sheet.addView(input)
        // Hint chips add their phrase to the note; tapping again takes it out.
        val chips = ctx.row(8)
        ctx.resources.getStringArray(R.array.evening_chips).forEach { phrase ->
            var on = false
            lateinit var chip: TextView
            chip = ctx.chip(phrase, false) {
                on = !on
                val text = input.text.toString()
                input.setText(if (on) listOf(text.trim(), phrase).filter { it.isNotEmpty() }.joinToString(", ") else text.replace(phrase, "").replace(", ,", ",").trim(' ', ','))
                input.setSelection(input.text.length)
                chip.background = ctx.ripple(if (on) ctx.rounded(ctx.col(R.color.her_tint), 999f, ctx.col(R.color.her), 2f) else ctx.rounded(ctx.col(R.color.surface), 999f, ctx.col(R.color.line)), 999f)
                chip.setTextColor(ctx.col(if (on) R.color.ink else R.color.ink2))
            }.apply { textSize = 13f }
            chips.addView(chip)
        }
        sheet.addView(android.widget.HorizontalScrollView(ctx).apply {
            isHorizontalScrollBarEnabled = false
            addView(chips)
        })
        sheet.addView(ctx.primaryButton(ctx.getString(R.string.evening_send)) {
            val text = input.text.toString().trim()
            if (text.isEmpty()) return@primaryButton
            repo.put("thanks/$today/${seatKey(repo.me, mine = true)}", org.json.JSONObject().put("text", text).put("at", System.currentTimeMillis()))
            dialog.dismiss()
            Toaster.show(activity, ctx.getString(R.string.evening_sent, store.partnerDisplay))
        }.lp(top = 4))
        sheet.addView(ctx.text(ctx.getString(R.string.evening_note, store.partnerDisplay), 13f, 500, ctx.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        input.requestFocus()
    }

    private fun input(hint: String, max: Int): EditText = EditText(ctx).apply {
        this.hint = hint
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        filters = arrayOf(InputFilter.LengthFilter(max))
        typeface = Fonts.get(ctx, 500)
        setTextColor(ctx.col(R.color.ink))
        setHintTextColor(ctx.col(R.color.ink2))
        background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
        setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
        minHeight = ctx.dp(52)
    }
}
