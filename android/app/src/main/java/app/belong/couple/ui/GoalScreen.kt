package app.belong.couple.ui

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.DreamsModel
import app.belong.couple.core.Goal
import app.belong.couple.core.GoalStep
import app.belong.couple.core.Owner
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DreamsRepo
import app.belong.couple.data.TaskRepo
import java.time.LocalDate
import java.time.ZoneId

/** One goal of the pair: progress ring, the savings jar with each partner's share, and the steps. */
object GoalScreen {

    fun show(activity: MainActivity, goalKey: String) {
        val dialog = Dialog(activity, R.style.Theme_Belong)
        val body = activity.column()
        val scroll = ScrollView(activity).apply {
            isFillViewport = true
            setBackgroundColor(activity.col(R.color.bg))
            addView(body)
        }
        fun render() {
            val repo = DreamsRepo(activity)
            val goal = DreamsModel.goal(repo.root(), goalKey, repo.me) ?: return dialog.dismiss()
            val y = scroll.scrollY
            body.removeAllViews()
            body.addView(cover(activity, dialog, goal))
            val content = activity.column().apply {
                val side = activity.dp(20)
                setPadding(side, activity.dp(16), side, activity.dp(40))
            }
            content.addView(savingsCard(activity, goal))
            content.addView(stepsHeader(activity, goal).lp(top = 28))
            content.addView(stepsCard(activity, goal).lp(top = 12))
            content.addView(activity.secondaryButton(activity.getString(R.string.goal_add_step), R.drawable.ic_plus) { addStep(activity, goal) }.lp(top = 12))
            content.addView(doneButton(activity, goal).lp(top = 20))
            body.addView(content)
            scroll.post { scroll.scrollTo(0, y) }
        }
        DataEvents.follow(scroll) { if (dialog.isShowing) render() }
        render()
        dialog.setContentView(scroll)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.show()
    }

    /** The cover: a soft pair gradient with the goal's emoji, its title in white and the ring. */
    private fun cover(a: MainActivity, dialog: Dialog, goal: Goal): View = FrameLayout(a).apply {
        background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(a.col(R.color.her_tint), a.col(R.color.her), a.col(R.color.us_end)))
        minimumHeight = a.dp(320)
        val repo = DreamsRepo(a)
        val photo = goal.dreamKey?.let { key -> DreamsModel.dreams(repo.root(), repo.me).firstOrNull { it.key == key }?.photo }
        if (photo != null) {
            // The dream's photo under a veil that turns from clear to pink to blue, as in the design.
            addView(ImageView(a).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                RemoteImage.load(this, photo.url, a.dp(400))
            }, FrameLayout.LayoutParams(MATCH, MATCH))
            addView(View(a).apply {
                background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00F07DA1, 0x8CF07DA1.toInt(), 0xEB5C9DF2.toInt()))
            }, FrameLayout.LayoutParams(MATCH, MATCH))
            if (photo.by.isNotBlank()) addView(a.text(a.getString(if (photo.source == "unsplash") R.string.photo_credit_unsplash else R.string.photo_credit_web, photo.by), 11f, 600, Color.WHITE).apply {
                setPadding(a.dp(20), a.dp(72), a.dp(20), 0)
                setOnClickListener { if (photo.link.startsWith("https://")) a.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(photo.link))) }
            }, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.TOP or Gravity.START))
        } else {
            addView(a.text(goal.emoji, 96f).apply {
                gravity = Gravity.CENTER
                alpha = 0.9f
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, FrameLayout.LayoutParams(MATCH, a.dp(200), Gravity.TOP))
        }
        val bar = a.row().apply { setPadding(a.dp(16), a.dp(16), a.dp(16), 0) }
        bar.addView(circleButton(a, R.drawable.ic_back, a.getString(R.string.back)) { dialog.dismiss() })
        bar.addView(View(a), LinearLayout.LayoutParams(0, 1, 1f))
        bar.addView(circleButton(a, R.drawable.ic_more, a.getString(R.string.goal_menu)) { menu(a, dialog, goal) })
        addView(bar, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.TOP))
        val bottom = a.row(12).apply {
            gravity = Gravity.BOTTOM
            setPadding(a.dp(20), 0, a.dp(20), a.dp(20))
        }
        val texts = a.column(4)
        texts.addView(a.text(a.getString(R.string.goal_label), 13f, 700, Color.WHITE))
        texts.addView(a.text(goal.title, 30f, 800, Color.WHITE).apply { letterSpacing = -0.01f })
        bottom.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        bottom.addView(ProgressRing(a, goal.progress, 0x55FFFFFF, Color.WHITE), LinearLayout.LayoutParams(a.dp(92), a.dp(92)))
        addView(bottom, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM))
    }

    private fun circleButton(a: MainActivity, iconRes: Int, label: String, onClick: () -> Unit): View = ImageView(a).apply {
        setImageDrawable(a.icon(iconRes, a.col(R.color.ink), 20))
        scaleType = ImageView.ScaleType.CENTER
        contentDescription = label
        background = a.ripple(a.rounded(a.col(R.color.surface), 22f), 22f)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(a.dp(44), a.dp(44))
    }

    // ---------- Savings ----------

    private fun savingsCard(a: MainActivity, goal: Goal): View = a.card(paddingDp = 16, spacingDp = 12).apply {
        val store = CoupleStore.get(a)
        val head = a.row(8)
        head.addView(a.text(a.getString(R.string.goal_savings), 13f, 700, a.col(R.color.ink2)), LinearLayout.LayoutParams(0, WRAP, 1f))
        if (goal.hasSavings) {
            head.addView(a.text(a.getString(R.string.goal_add_money), 14f, 700).apply {
                gravity = Gravity.CENTER
                minHeight = a.dp(36)
                setPadding(a.dp(14), 0, a.dp(14), 0)
                background = a.ripple(a.rounded(a.col(R.color.sunk), 999f), 999f)
                setOnClickListener { addMoney(a, goal) }
            })
        }
        addView(head)
        if (!goal.hasSavings) {
            addView(a.text(a.getString(R.string.goal_no_target), 15f, 500, a.col(R.color.ink2)))
            addView(a.secondaryButton(a.getString(R.string.goal_set_target)) { setTarget(a, goal) })
            return@apply
        }
        val amount = a.row(6).apply { gravity = Gravity.BOTTOM }
        amount.addView(a.text(formatMoney(a, goal.saved, goal.unit), 26f, 800))
        amount.addView(a.text(a.getString(R.string.goal_saved_of, formatMoney(a, goal.target, goal.unit)), 14f, 500, a.col(R.color.ink2)).apply {
            setPadding(0, 0, 0, a.dp(4))
        })
        addView(amount)
        // Two-colour bar: her share, then his, on the sand track.
        val bar = LinearLayout(a).apply {
            background = a.rounded(a.col(R.color.sunk), 6f)
            clipToOutline = true
        }
        val total = goal.target.toFloat()
        fun part(value: Long, color: Int) = View(a).apply { setBackgroundColor(color) }.also {
            bar.addView(it, LinearLayout.LayoutParams(0, MATCH, (value.coerceAtLeast(0) / total).coerceAtMost(1f)))
        }
        part(goal.savedMine, a.col(R.color.her))
        if (goal.savedMine > 0 && goal.savedPartner > 0) bar.addView(View(a), LinearLayout.LayoutParams(a.dp(2), MATCH))
        part(goal.savedPartner, a.col(R.color.him))
        bar.addView(View(a), LinearLayout.LayoutParams(0, MATCH, (1f - goal.saved / total).coerceAtLeast(0f)))
        addView(bar, LinearLayout.LayoutParams(MATCH, a.dp(12)))
        val legend = a.row(16)
        listOf(store.myName to goal.savedMine to R.color.her, store.partnerDisplay to goal.savedPartner to R.color.him).forEach { (who, color) ->
            val item = a.row(6)
            item.addView(a.ownerDot(a.col(color)))
            item.addView(a.text("${who.first} ${formatMoney(a, who.second, goal.unit)}", 13f, 600))
            legend.addView(item)
        }
        addView(legend)
        DreamsModel.daysToTarget(goal, System.currentTimeMillis())?.let { days ->
            val date = LocalDate.now(ZoneId.systemDefault()).plusDays(days)
            addView(a.row(10).apply {
                background = a.rounded(a.col(R.color.ok_tint), 16f)
                setPadding(a.dp(14), a.dp(12), a.dp(14), a.dp(12))
                addView(ImageView(a).apply { setImageDrawable(a.icon(R.drawable.ic_trend, a.col(R.color.ok_ink), 20)) })
                val texts = a.column(2)
                texts.addView(a.text(a.getString(R.string.goal_forecast, a.formatLongDate(date)), 15f, 700, a.col(R.color.ok_ink)))
                texts.addView(a.text(a.getString(R.string.goal_forecast_text), 13f, 500, a.col(R.color.ok_ink)))
                addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
            })
        }
        if (goal.saved >= goal.target) addView(a.text(a.getString(R.string.goal_target_reached), 15f, 700, a.col(R.color.ok_ink)))
    }

    private fun addMoney(a: MainActivity, goal: Goal) = a.bottomSheet { sheet, dialog ->
        sheet.addView(a.text(a.getString(R.string.goal_money_title), 22f, 700))
        val input = numberInput(a, a.getString(R.string.goal_money_hint, goal.unit))
        sheet.addView(input)
        sheet.addView(a.primaryButton(a.getString(R.string.task_add)) {
            val amount = input.text.toString().filter { it.isDigit() }.toLongOrNull()
            if (amount == null || amount <= 0) {
                input.error = a.getString(R.string.goal_money_hint, goal.unit)
                return@primaryButton
            }
            val repo = DreamsRepo(a)
            repo.add("goals/${goal.key}/saved/${repo.me?.key ?: "me"}", amount)
            dialog.dismiss()
            Toaster.show(a, a.getString(R.string.goal_money_added, formatMoney(a, amount, goal.unit)))
        }.lp(top = 8))
        input.requestFocus()
    }

    private fun setTarget(a: MainActivity, goal: Goal) = a.bottomSheet { sheet, dialog ->
        sheet.addView(a.text(a.getString(R.string.goal_set_target), 22f, 700))
        val amount = numberInput(a, a.getString(R.string.goal_target_hint))
        if (goal.target > 0) amount.setText(goal.target.toString())
        sheet.addView(amount)
        sheet.addView(a.text(a.getString(R.string.goal_unit), 13f, 700, a.col(R.color.ink2)).lp(top = 4))
        val unit = EditText(a).apply {
            setText(goal.unit.ifEmpty { a.getString(R.string.goal_default_unit) })
            filters = arrayOf(InputFilter.LengthFilter(4))
            inputType = InputType.TYPE_CLASS_TEXT
            typeface = Fonts.get(a, 500)
            background = a.rounded(a.col(R.color.bg), 16f, a.col(R.color.line))
            setPadding(a.dp(16), a.dp(12), a.dp(16), a.dp(12))
        }
        sheet.addView(unit)
        sheet.addView(a.primaryButton(a.getString(R.string.settings_save)) {
            val target = amount.text.toString().filter { it.isDigit() }.toLongOrNull()
            if (target == null || target <= 0) {
                amount.error = a.getString(R.string.goal_target_hint)
                return@primaryButton
            }
            val repo = DreamsRepo(a)
            repo.put("goals/${goal.key}/target", target)
            repo.put("goals/${goal.key}/unit", unit.text.toString().trim().take(4))
            dialog.dismiss()
        }.lp(top = 8))
        amount.requestFocus()
    }

    private fun numberInput(a: MainActivity, hint: String): EditText = EditText(a).apply {
        this.hint = hint
        inputType = InputType.TYPE_CLASS_NUMBER
        filters = arrayOf(InputFilter.LengthFilter(12))
        typeface = Fonts.get(a, 600)
        textSize = 20f
        setTextColor(a.col(R.color.ink))
        setHintTextColor(a.col(R.color.ink2))
        background = a.rounded(a.col(R.color.bg), 16f, a.col(R.color.line))
        setPadding(a.dp(16), a.dp(12), a.dp(16), a.dp(12))
        minHeight = a.dp(52)
    }

    // ---------- Steps ----------

    private fun stepsHeader(a: MainActivity, goal: Goal): View = a.row(8).apply {
        addView(a.text(a.getString(R.string.goal_steps), 22f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        if (goal.steps.isNotEmpty()) addView(a.text(a.getString(R.string.goal_steps_count, goal.stepsDone, goal.steps.size), 13f, 700, a.col(R.color.ink2)))
    }

    private fun stepsCard(a: MainActivity, goal: Goal): View = a.card(paddingDp = 16, spacingDp = 0).apply {
        if (goal.steps.isEmpty()) addView(a.text(a.getString(R.string.goal_steps_empty), 15f, 500, a.col(R.color.ink2)))
        goal.steps.forEachIndexed { i, step ->
            if (i > 0) addView(View(a).apply { setBackgroundColor(a.col(R.color.sunk)) }, LinearLayout.LayoutParams(MATCH, a.dp(1)).apply { marginStart = a.dp(40) })
            addView(stepRow(a, goal, step))
        }
    }

    private fun stepRow(a: MainActivity, goal: Goal, step: GoalStep): View = a.row(14).apply {
        val store = CoupleStore.get(a)
        minimumHeight = a.dp(56)
        setPadding(0, a.dp(8), 0, a.dp(8))
        val color = when (step.who) {
            Owner.ME -> a.col(R.color.her)
            Owner.PARTNER -> a.col(R.color.him)
            Owner.OURS -> null
        }
        addView(TaskRing(a, color == null, color ?: 0, step.done), LinearLayout.LayoutParams(a.dp(26), a.dp(26)))
        val texts = a.column(4)
        texts.addView(a.text(step.title, 16f, if (step.done) 400 else 600, a.col(if (step.done) R.color.ink2 else R.color.ink)))
        step.due?.takeIf { !step.done }?.let { due ->
            texts.addView(a.text(a.getString(R.string.goal_step_due, a.formatLongDate(LocalDate.ofEpochDay(due))), 12f, 700, a.col(R.color.honey_ink)).apply {
                background = a.rounded(a.col(R.color.honey_tint), 999f)
                setPadding(a.dp(8), a.dp(2), a.dp(8), a.dp(2))
            }.lp(width = WRAP))
        }
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        val who = when (step.who) {
            Owner.ME -> store.myName
            Owner.PARTNER -> store.partnerDisplay
            Owner.OURS -> a.getString(R.string.goal_together)
        }
        addView(a.text(who, 12f, 600, a.col(R.color.ink2)))
        addView(a.ownerDot(color, 14))
        contentDescription = a.getString(if (step.done) R.string.task_done_cd else R.string.task_open_cd, step.title)
        background = a.ripple(a.rounded(a.col(R.color.surface), 12f), 12f)
        setOnClickListener { v ->
            haptic(v)
            DreamsRepo(a).put("goals/${goal.key}/steps/${step.key}/done", !step.done)
        }
        setOnLongClickListener {
            stepMenu(a, goal, step)
            true
        }
    }

    private fun stepMenu(a: MainActivity, goal: Goal, step: GoalStep) {
        val repo = DreamsRepo(a)
        val actions = listOf<Pair<String, () -> Unit>>(
            a.getString(R.string.goal_to_today) to {
                TaskRepo(a).add(step.title, step.who)
                Toaster.show(a, a.getString(R.string.goal_added_today))
            },
            a.getString(R.string.goal_set_due) to {
                val today = LocalDate.now()
                DatePickerDialog(a, { _, y, m, d ->
                    repo.put("goals/${goal.key}/steps/${step.key}/due", LocalDate.of(y, m + 1, d).toEpochDay())
                }, today.year, today.monthValue - 1, today.dayOfMonth).show()
            },
            a.getString(R.string.delete) to { repo.delete("goals/${goal.key}/steps/${step.key}") },
        )
        AlertDialog.Builder(a)
            .setTitle(step.title)
            .setItems(actions.map { it.first }.toTypedArray()) { _, which -> actions[which].second() }
            .show()
    }

    private fun addStep(a: MainActivity, goal: Goal) {
        val store = CoupleStore.get(a)
        var who = Owner.OURS
        a.bottomSheet { sheet, dialog ->
            sheet.addView(a.text(a.getString(R.string.goal_new_step), 22f, 700))
            val input = EditText(a).apply {
                hint = a.getString(R.string.goal_new_step)
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                filters = arrayOf(InputFilter.LengthFilter(80))
                typeface = Fonts.get(a, 500)
                setTextColor(a.col(R.color.ink))
                setHintTextColor(a.col(R.color.ink2))
                background = a.rounded(a.col(R.color.bg), 16f, a.col(R.color.line))
                setPadding(a.dp(16), a.dp(12), a.dp(16), a.dp(12))
                minHeight = a.dp(52)
            }
            sheet.addView(input)
            sheet.addView(a.text(a.getString(R.string.goal_step_who), 13f, 700, a.col(R.color.ink2)).lp(top = 4))
            val owners = FrameLayout(a)
            fun draw() {
                owners.removeAllViews()
                owners.addView(a.segmented(listOf(a.getString(R.string.owner_me), a.getString(R.string.goal_together), store.partnerDisplay), Owner.entries.indexOf(who)) {
                    who = Owner.entries[it]
                    draw()
                })
            }
            draw()
            sheet.addView(owners)
            sheet.addView(a.primaryButton(a.getString(R.string.task_add)) {
                val title = input.text.toString().trim()
                if (title.isEmpty()) return@primaryButton
                val repo = DreamsRepo(a)
                repo.put("goals/${goal.key}/steps/${DreamsScreen.newKey()}", DreamsModel.stepJson(title, who, System.currentTimeMillis(), repo.me))
                dialog.dismiss()
            }.lp(top = 8))
            input.requestFocus()
        }
    }

    // ---------- Done and menu ----------

    /** "We did it": an outline button in the pair gradient, as in the design. */
    private fun doneButton(a: MainActivity, goal: Goal): View = a.text(
        a.getString(if (goal.done) R.string.goal_reopen else R.string.goal_complete), 16f, 700,
    ).apply {
        gravity = Gravity.CENTER
        minHeight = a.dp(52)
        val outline = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(a.col(R.color.her), a.col(R.color.him))).apply {
            cornerRadius = a.dp(16).toFloat()
        }
        val inner = a.rounded(a.col(R.color.bg), 14f)
        background = a.ripple(android.graphics.drawable.LayerDrawable(arrayOf(outline, inner)).apply {
            val inset = a.dp(2)
            setLayerInset(1, inset, inset, inset, inset)
        }, 16f)
        setOnClickListener {
            val repo = DreamsRepo(a)
            val done = !goal.done
            repo.put("goals/${goal.key}/done", done)
            goal.dreamKey?.let { repo.put("dreams/$it/done", done) }
            if (done) {
                celebrate(a)
                Toaster.show(a, a.getString(R.string.goal_completed))
            }
        }
        pressable()
    }

    private fun celebrate(a: MainActivity) {
        val root = a.window.decorView as? ViewGroup ?: return
        val confetti = Confetti(a, System.currentTimeMillis())
        root.addView(confetti, ViewGroup.LayoutParams(MATCH, MATCH))
        confetti.postDelayed({ root.removeView(confetti) }, 1_800)
    }

    private fun menu(a: MainActivity, dialog: Dialog, goal: Goal) {
        val repo = DreamsRepo(a)
        val actions = listOf<Pair<String, () -> Unit>>(
            a.getString(R.string.goal_set_target) to { setTarget(a, goal) },
            a.getString(R.string.goal_delete) to {
                AlertDialog.Builder(a)
                    .setTitle(R.string.goal_delete)
                    .setMessage(goal.title)
                    .setPositiveButton(R.string.delete) { _, _ ->
                        goal.dreamKey?.let { repo.delete("dreams/$it/goal") }
                        repo.delete("goals/${goal.key}")
                        dialog.dismiss()
                    }
                    .setNegativeButton(R.string.settings_cancel, null)
                    .show()
            },
        )
        AlertDialog.Builder(a)
            .setTitle("${goal.emoji} ${goal.title}")
            .setItems(actions.map { it.first }.toTypedArray()) { _, which -> actions[which].second() }
            .show()
    }
}
