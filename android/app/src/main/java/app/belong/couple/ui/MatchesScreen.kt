package app.belong.couple.ui

import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.DreamCategory
import app.belong.couple.core.DreamsModel
import app.belong.couple.core.Ideas
import app.belong.couple.core.Owner
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DreamsRepo
import app.belong.couple.data.TaskRepo
import app.belong.couple.sync.Matches

/** One idea from the deck: emoji, category and title, from the localized list. */
data class Idea(val key: String, val emoji: String, val category: DreamCategory, val title: String)

/**
 * "Matches": swipe through ideas one at a time — no, maybe or yes. The partner sees only what you
 * both said yes to; a match opens "It's a match!" with ways to plan it or put it on the map.
 */
object MatchesScreen {

    fun ideas(a: android.content.Context): List<Idea> = a.resources.getStringArray(R.array.dream_ideas).mapIndexed { i, line ->
        val (emoji, cat, title) = line.split('|', limit = 3)
        Idea(Ideas.key(i), emoji, DreamCategory.of(cat), title)
    }

    fun show(a: MainActivity, showMatchesFirst: Boolean = false) {
        val dialog = Dialog(a, R.style.Theme_Belong)
        val stage = FrameLayout(a).apply { setBackgroundColor(a.col(R.color.bg)) }
        dialog.setContentView(stage)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.setOnDismissListener { Matches.markSeen(a) }
        if (showMatchesFirst) showList(a, dialog, stage) else showDeck(a, dialog, stage)
        dialog.show()
    }

    // ---------- The deck ----------

    private fun showDeck(a: MainActivity, dialog: Dialog, stage: FrameLayout) {
        val all = ideas(a)
        val answered = Matches.answers(a)
        val left = all.filter { it.key !in answered }
        stage.removeAllViews()
        val page = a.column().apply { setPadding(a.dp(20), a.dp(12), a.dp(20), a.dp(24)) }
        page.addView(topBar(a, dialog, a.getString(R.string.matches_title),
            a.getString(R.string.matches_progress, (all.size - left.size + 1).coerceAtMost(all.size), all.size)))
        val next = left.firstOrNull()
        if (next == null) {
            showList(a, dialog, stage)
            return
        }

        // A small stack: two tinted cards behind, the idea on top tilted slightly.
        val deck = FrameLayout(a)
        deck.addView(View(a).apply { background = a.rounded(a.col(R.color.him_tint), 28f); rotation = 3f },
            FrameLayout.LayoutParams(MATCH, MATCH).apply { setMargins(a.dp(16), a.dp(4), a.dp(16), a.dp(20)) })
        deck.addView(View(a).apply { background = a.rounded(a.col(R.color.her_tint), 28f); rotation = -4f },
            FrameLayout.LayoutParams(MATCH, MATCH).apply { setMargins(a.dp(8), a.dp(8), a.dp(8), a.dp(16)) })
        val card = ideaCard(a, next)
        deck.addView(card, FrameLayout.LayoutParams(MATCH, MATCH).apply { setMargins(0, a.dp(12), 0, a.dp(8)) })
        page.addView(deck, LinearLayout.LayoutParams(MATCH, 0, 1f).apply { topMargin = a.dp(16) })

        page.addView(a.row(6).apply {
            gravity = Gravity.CENTER
            addView(ImageView(a).apply { setImageDrawable(a.icon(R.drawable.ic_lock, a.col(R.color.ink2), 14)) })
            addView(a.text(a.getString(R.string.matches_hint, CoupleStore.get(a).partnerDisplay), 13f, 500, a.col(R.color.ink2)))
        }.lp(top = 12))

        val buttons = a.row(20).apply { gravity = Gravity.CENTER }
        fun answer(value: String) {
            Matches.answer(a, next.key, value)
            val dx = when (value) {
                Matches.YES -> 1f
                Matches.NO -> -1f
                else -> 0f
            }
            card.animate().translationX(dx * a.dp(400)).translationY(if (dx == 0f) -a.dp(500).toFloat() else 0f)
                .rotation(dx * 18f).alpha(0f).setDuration(220).withEndAction {
                    if (value == Matches.YES) {
                        Matches.check(a, next.key) { match ->
                            if (!dialog.isShowing) return@check
                            if (match) showMatch(a, dialog, stage, next) else showDeck(a, dialog, stage)
                        }
                    } else {
                        showDeck(a, dialog, stage)
                    }
                }.start()
        }
        buttons.addView(roundAnswer(a, R.drawable.ic_close, a.getString(R.string.match_no), 64, false) { answer(Matches.NO) })
        buttons.addView(roundAnswer(a, null, a.getString(R.string.matches_maybe), 56, false) { answer(Matches.MAYBE) })
        buttons.addView(roundAnswer(a, R.drawable.ic_check, a.getString(R.string.match_yes), 64, true) { answer(Matches.YES) })
        page.addView(buttons.lp(top = 16))
        stage.addView(page, FrameLayout.LayoutParams(MATCH, MATCH))
    }

    private fun topBar(a: MainActivity, dialog: Dialog, title: String, subtitle: String): View = a.row(8).apply {
        addView(ImageView(a).apply {
            setImageDrawable(a.icon(R.drawable.ic_close, a.col(R.color.ink), 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = a.getString(R.string.pair_close)
            background = a.ripple(a.rounded(a.col(R.color.bg), 22f), 22f)
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(a.dp(44), a.dp(44)))
        val texts = a.column(1).apply { gravity = Gravity.CENTER_HORIZONTAL }
        texts.addView(a.text(title, 17f, 700).apply { gravity = Gravity.CENTER })
        if (subtitle.isNotEmpty()) texts.addView(a.text(subtitle, 12f, 600, a.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(View(a), LinearLayout.LayoutParams(a.dp(44), a.dp(44)))
    }

    private fun ideaCard(a: MainActivity, idea: Idea): View = a.column().apply {
        background = a.rounded(a.col(R.color.surface), 28f)
        softShadow(10f)
        rotation = -2f
        addView(a.text(idea.emoji, 96f).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(a.col(R.color.her_tint), a.col(R.color.him_tint))).apply {
                val r = a.dp(28).toFloat()
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(MATCH, 0, 1f))
        val texts = a.column(8).apply { setPadding(a.dp(20), a.dp(16), a.dp(20), a.dp(22)) }
        texts.addView(a.text(categoryName(a, idea.category), 13f, 700, a.col(R.color.on_tint)).apply {
            background = a.rounded(a.col(R.color.her_tint), 999f)
            setPadding(a.dp(10), a.dp(4), a.dp(10), a.dp(4))
        }.lp(width = WRAP))
        texts.addView(a.text(idea.title, 24f, 700))
        addView(texts)
    }

    private fun roundAnswer(a: MainActivity, iconRes: Int?, label: String, sizeDp: Int, yes: Boolean, onClick: () -> Unit): View = a.column(6).apply {
        gravity = Gravity.CENTER_HORIZONTAL
        val circle = if (iconRes != null) {
            ImageView(a).apply {
                setImageDrawable(a.icon(iconRes, if (yes) Color.WHITE else a.col(R.color.ink), 26))
                scaleType = ImageView.ScaleType.CENTER
            }
        } else {
            a.text("?", 22f, 800, a.col(R.color.honey_ink)).apply { gravity = Gravity.CENTER }
        }
        circle.background = if (yes) {
            GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(a.col(R.color.us_start), a.col(R.color.us_end))).apply { shape = GradientDrawable.OVAL }
        } else {
            GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(a.col(R.color.surface)) }
        }
        circle.elevation = a.dp(if (yes) 8 else 4).toFloat()
        circle.contentDescription = label
        circle.setOnClickListener { v ->
            haptic(v)
            onClick()
        }
        circle.pressable()
        addView(circle, LinearLayout.LayoutParams(a.dp(sizeDp), a.dp(sizeDp)))
        addView(a.text(label, 13f, 700, a.col(R.color.ink2)))
    }

    // ---------- "It's a match!" ----------

    private fun showMatch(a: MainActivity, dialog: Dialog, stage: FrameLayout, idea: Idea) {
        stage.removeAllViews()
        val store = CoupleStore.get(a)
        stage.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(a.col(R.color.bg), a.col(R.color.her_tint), a.col(R.color.him_tint)))
        stage.addView(Confetti(a), FrameLayout.LayoutParams(MATCH, MATCH))
        val page = a.column(12).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(a.dp(20), a.dp(48), a.dp(20), a.dp(24))
        }
        page.addView(PairMark(a).apply {
            initials = store.myName.take(1).uppercase() to store.partnerDisplay.take(1).uppercase()
        }, LinearLayout.LayoutParams(WRAP, a.dp(120)))
        page.addView(a.text(a.getString(R.string.match_title_big), 34f, 800).apply { gravity = Gravity.CENTER }.lp(top = 24))
        page.addView(a.text(a.getString(R.string.match_both_want, idea.title), 16f, 400, a.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        page.addView(a.card(paddingDp = 10, spacingDp = 0).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(a.text(idea.emoji, 30f).apply {
                gravity = Gravity.CENTER
                background = a.gradient(14f, a.col(R.color.her_tint), a.col(R.color.him_tint))
            }, LinearLayout.LayoutParams(a.dp(60), a.dp(60)))
            val texts = a.column(2).apply { setPadding(a.dp(12), 0, 0, 0) }
            texts.addView(a.text(idea.title, 15f, 700))
            texts.addView(a.text(categoryName(a, idea.category), 12f, 500, a.col(R.color.ink2)))
            addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        }.lp(top = 16))
        page.addView(View(a), LinearLayout.LayoutParams(1, 0, 1f))
        page.addView(a.primaryButton(a.getString(R.string.match_plan), R.drawable.ic_calendar) {
            TaskRepo(a).add(idea.title, Owner.OURS)
            Toaster.show(a, a.getString(R.string.goal_added_today))
        }.apply { minHeight = a.dp(56) })
        page.addView(a.secondaryButton(a.getString(R.string.match_to_map)) {
            val repo = DreamsRepo(a)
            repo.put("dreams/${DreamsScreen.newKey()}", DreamsModel.dreamJson(idea.title, idea.emoji, idea.category, Owner.OURS, System.currentTimeMillis(), repo.me))
            Toaster.show(a, a.getString(R.string.match_added_to_map))
        }.apply { minHeight = a.dp(56) })
        page.addView(a.textButton(a.getString(R.string.match_keep_going)) {
            stage.background = null
            stage.setBackgroundColor(a.col(R.color.bg))
            showDeck(a, dialog, stage)
        })
        stage.addView(page, FrameLayout.LayoutParams(MATCH, MATCH))
    }

    // ---------- All matches ----------

    private fun showList(a: MainActivity, dialog: Dialog, stage: FrameLayout) {
        stage.removeAllViews()
        val page = a.column().apply { setPadding(a.dp(20), a.dp(12), a.dp(20), 0) }
        page.addView(topBar(a, dialog, a.getString(R.string.matches_list_title), ""))
        val list = a.column(10).apply { setPadding(0, a.dp(12), 0, a.dp(24)) }
        page.addView(ScrollView(a).apply { addView(list) }, LinearLayout.LayoutParams(MATCH, 0, 1f))
        stage.addView(page, FrameLayout.LayoutParams(MATCH, MATCH))

        fun fill(matches: Set<String>) {
            list.removeAllViews()
            val all = ideas(a).associateBy { it.key }
            val left = all.keys.count { it !in Matches.answers(a) }
            val found = matches.mapNotNull { all[it] }
            if (found.isEmpty()) list.addView(a.text(a.getString(R.string.matches_none), 15f, 500, a.col(R.color.ink2)))
            found.forEach { idea ->
                list.addView(a.card(paddingDp = 12, spacingDp = 0).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    addView(a.text(idea.emoji, 26f).apply {
                        gravity = Gravity.CENTER
                        background = a.gradient(14f, a.col(R.color.her_tint), a.col(R.color.him_tint))
                    }, LinearLayout.LayoutParams(a.dp(52), a.dp(52)))
                    addView(a.text(idea.title, 15f, 700).apply { setPadding(a.dp(12), 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
                    isClickable = true
                    background = a.ripple(background, 24f)
                    setOnClickListener { showMatch(a, dialog, stage, idea) }
                })
            }
            if (left > 0) list.addView(a.primaryButton(a.getString(R.string.matches_continue, left)) { showDeck(a, dialog, stage) }.lp(top = 12))
        }
        fill(Matches.matches(a))
        Matches.refresh(a) { if (dialog.isShowing) fill(it) }
    }
}
