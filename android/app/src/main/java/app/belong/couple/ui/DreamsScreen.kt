package app.belong.couple.ui

import android.app.AlertDialog
import android.graphics.drawable.GradientDrawable
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.core.Dream
import app.belong.couple.core.DreamCategory
import app.belong.couple.core.DreamsModel
import app.belong.couple.core.Goal
import app.belong.couple.core.Owner
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DreamsRepo
import app.belong.couple.sync.ChatFeed
import app.belong.couple.sync.Matches
import java.security.SecureRandom
import java.text.NumberFormat

/**
 * Dreams: the shared wish map (mine, my partner's and ours), the goals made from them, and the
 * way into "Matches". A dream becomes a goal in one tap; the goal gets steps and savings.
 */
class DreamsScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = DreamsRepo(ctx)
    private var filter: DreamCategory? = null

    private val body = ctx.column().apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(104))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = FrameLayout(ctx).apply {
        addView(scroll, FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.fab(ctx.getString(R.string.dream_add_title)) { addDream() }.apply { tag = "fab" },
            FrameLayout.LayoutParams(ctx.dp(56), ctx.dp(56), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, ctx.dp(20), ctx.dp(20)) })
    }
    private var checkedMatches = false

    init {
        repo.ensureSeeded()
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val scrollY = scroll.scrollY
        body.removeAllViews()
        val root = repo.root()
        val me = repo.me
        val dreams = DreamsModel.dreams(root, me)
        val goals = DreamsModel.goals(root, me)

        body.addView(header())
        if (dreams.isEmpty() && goals.isEmpty()) {
            body.addView(emptyState())
            view.findViewWithTag<View>("fab")?.visibility = View.GONE
            return
        }
        view.findViewWithTag<View>("fab")?.visibility = View.VISIBLE
        body.addView(matchesBanner().lp(top = 16))
        if (goals.isNotEmpty()) {
            body.addView(ctx.text(ctx.getString(R.string.goals_title), 22f, 700).lp(top = 28))
            body.addView(goalsRow(goals).lp(top = 8))
        }
        body.addView(chips().lp(top = 24))
        body.addView(grid(dreams.filter { filter == null || it.category == filter }, goals.associateBy { it.key }).lp(top = 12))
        scroll.post { scroll.scrollTo(0, scrollY) }
        if (!checkedMatches) {
            checkedMatches = true
            Matches.refresh(ctx) { if (view.isShown) refresh() }
        }
    }

    private fun header(): View = ctx.row(8).apply {
        addView(ctx.text(ctx.getString(R.string.dreams_title), 28f, 700).apply { letterSpacing = -0.01f }, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_tab_gift, ctx.col(R.color.ink), 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = ctx.getString(R.string.dreams_wishlist)
            background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 22f), 22f)
            softShadow(3f)
            setOnClickListener { activity.select(MainActivity.TAB_WISHLIST) }
        }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
    }

    // ---------- Matches ----------

    private fun matchesBanner(): View = ctx.row(12).apply {
        background = ctx.gradient(20f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
        setPadding(ctx.dp(14), ctx.dp(10), ctx.dp(10), ctx.dp(10))
        minimumHeight = ctx.dp(60)
        addView(PairMark(ctx), LinearLayout.LayoutParams(WRAP, ctx.dp(28)))
        val unseen = Matches.unseen(ctx).size
        val texts = ctx.column(1)
        texts.addView(ctx.text(
            if (unseen > 0) ctx.getString(R.string.dreams_matches_new, unseen) else ctx.getString(R.string.matches_title) + " 💞",
            15f, 700,
        ))
        if (unseen == 0) texts.addView(ctx.text(ctx.getString(R.string.dreams_matches_text), 12f, 500, ctx.col(R.color.on_tint)))
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ctx.text(ctx.getString(if (unseen > 0) R.string.dreams_matches_view else R.string.dreams_matches_play), 14f, 700).apply {
            gravity = Gravity.CENTER
            minHeight = ctx.dp(40)
            setPadding(ctx.dp(14), 0, ctx.dp(14), 0)
            background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 999f), 999f)
            setOnClickListener { MatchesScreen.show(activity, showMatchesFirst = unseen > 0) }
        })
    }

    // ---------- Goals ----------

    private fun goalsRow(goals: List<Goal>): View = HorizontalScrollView(ctx).apply {
        isHorizontalScrollBarEnabled = false
        clipToPadding = false
        val row = ctx.row(12).apply { setPadding(0, ctx.dp(4), ctx.dp(4), ctx.dp(12)) }
        goals.forEach { goal ->
            row.addView(ctx.card(paddingDp = 14, spacingDp = 8).apply {
                layoutParams = LinearLayout.LayoutParams(ctx.dp(220), MATCH)
                val top = ctx.row(12)
                top.addView(ProgressRing(ctx, goal.progress, ctx.col(R.color.sunk), ctx.col(R.color.ink)), LinearLayout.LayoutParams(ctx.dp(52), ctx.dp(52)))
                top.addView(ctx.text("${goal.emoji} ${goal.title}", 15f, 700).apply { maxLines = 3 }, LinearLayout.LayoutParams(0, WRAP, 1f))
                addView(top)
                val line = when {
                    goal.done -> ctx.getString(R.string.goal_done_short)
                    goal.hasSavings -> ctx.getString(R.string.goal_saved_short, money(goal.saved, goal.unit), money(goal.target, goal.unit))
                    else -> ctx.getString(R.string.goal_steps_count, goal.stepsDone, goal.steps.size)
                }
                addView(ctx.text(line, 13f, 500, ctx.col(R.color.ink2)))
                isClickable = true
                background = ctx.ripple(background, 24f)
                setOnClickListener { GoalScreen.show(activity, goal.key) }
            })
        }
        addView(row)
    }

    private fun money(amount: Long, unit: String) = formatMoney(ctx, amount, unit)

    // ---------- The wish map ----------

    private fun chips(): View = HorizontalScrollView(ctx).apply {
        isHorizontalScrollBarEnabled = false
        val row = ctx.row(8)
        row.addView(ctx.chip(ctx.getString(R.string.dream_cat_all), filter == null) {
            filter = null
            refresh()
        })
        DreamCategory.entries.forEach { cat ->
            row.addView(ctx.chip(categoryName(ctx, cat), filter == cat) {
                filter = cat
                refresh()
            })
        }
        addView(row)
    }

    /** Two columns of cards with uneven picture heights, like the design's masonry. */
    private fun grid(dreams: List<Dream>, goals: Map<String, Goal>): View = ctx.row(12).apply {
        gravity = Gravity.TOP
        val columns = listOf(ctx.column(12), ctx.column(12))
        val heights = intArrayOf(0, 0)
        dreams.forEachIndexed { i, dream ->
            val tall = i % 3 == 0
            val col = if (heights[0] <= heights[1]) 0 else 1
            heights[col] += if (tall) 3 else 2
            columns[col].addView(dreamCard(dream, dream.goalKey?.let { goals[it] }, tall))
        }
        if (dreams.isEmpty()) {
            addView(ctx.text(ctx.getString(R.string.dreams_none_here), 15f, 500, ctx.col(R.color.ink2)))
            return@apply
        }
        columns.forEach { addView(it, LinearLayout.LayoutParams(0, WRAP, 1f)) }
    }

    private fun dreamCard(dream: Dream, goal: Goal?, tall: Boolean): View = ctx.card(paddingDp = 8, spacingDp = 8).apply {
        addView(ctx.text(dream.emoji, if (tall) 52f else 40f).apply {
            gravity = Gravity.CENTER
            background = ownerTile(dream.owner)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(MATCH, ctx.dp(if (tall) 150 else 104)))
        val texts = ctx.column(4).apply { setPadding(ctx.dp(6), 0, ctx.dp(6), ctx.dp(4)) }
        texts.addView(ctx.text(dream.title, 16f, 700))
        val who = ctx.row(6)
        who.addView(ctx.ownerDot(ownerColor(dream.owner)))
        who.addView(ctx.text(ownerLabel(dream.owner), 13f, 500, ctx.col(R.color.ink2)))
        texts.addView(who)
        when {
            dream.done -> texts.addView(ctx.text(ctx.getString(R.string.dream_came_true), 13f, 700, ctx.col(R.color.ok_ink)))
            goal != null -> texts.addView(ctx.text(ctx.getString(R.string.dream_goal_link, goal.progress), 13f, 700, ctx.col(R.color.ink)))
            dream.owner == Owner.OURS -> texts.addView(smallGradientButton(ctx.getString(R.string.dream_make_goal)) { makeGoal(dream) }.lp(top = 4))
            dream.owner == Owner.PARTNER -> texts.addView(ctx.chip(ctx.getString(R.string.dream_me_too), false) {
                repo.put("dreams/${dream.key}/owner", app.belong.couple.core.ownerKey(Owner.OURS, repo.me))
                Toaster.show(activity, ctx.getString(R.string.dream_me_too_done))
            }.apply { textSize = 13f }.lp(width = WRAP, top = 4))
        }
        addView(texts)
        isClickable = true
        background = ctx.ripple(background, 24f)
        contentDescription = "${dream.emoji} ${dream.title}, ${ownerLabel(dream.owner)}"
        setOnClickListener { if (goal != null) GoalScreen.show(activity, goal.key) else dreamMenu(dream) }
        setOnLongClickListener {
            dreamMenu(dream)
            true
        }
    }

    private fun smallGradientButton(label: String, onClick: () -> Unit): TextView =
        ctx.text(label, 13f, 700, ctx.col(R.color.white)).apply {
            gravity = Gravity.CENTER
            minHeight = ctx.dp(40)
            setPadding(ctx.dp(10), 0, ctx.dp(10), 0)
            background = ctx.ripple(ctx.gradient(12f, ctx.col(R.color.us_start), ctx.col(R.color.us_end)), 12f)
            setOnClickListener { onClick() }
            pressable()
        }

    private fun ownerTile(owner: Owner): GradientDrawable = when (owner) {
        Owner.ME -> ctx.rounded(ctx.col(R.color.her_tint), 18f)
        Owner.PARTNER -> ctx.rounded(ctx.col(R.color.him_tint), 18f)
        Owner.OURS -> ctx.gradient(18f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
    }

    private fun ownerColor(owner: Owner): Int? = when (owner) {
        Owner.ME -> ctx.col(R.color.her)
        Owner.PARTNER -> ctx.col(R.color.him)
        Owner.OURS -> null
    }

    private fun ownerLabel(owner: Owner): String = when (owner) {
        Owner.ME -> ctx.getString(R.string.dream_owner_me)
        Owner.PARTNER -> ctx.getString(R.string.dream_owner_partner, store.partnerDisplay)
        Owner.OURS -> ctx.getString(R.string.dream_owner_ours)
    }

    private fun dreamMenu(dream: Dream) {
        val actions = mutableListOf<Pair<String, () -> Unit>>()
        if (dream.goalKey == null && !dream.done) actions += ctx.getString(R.string.dream_make_goal) to { makeGoal(dream) }
        if (!dream.done) actions += ctx.getString(R.string.dream_mark_true) to {
            repo.put("dreams/${dream.key}/done", true)
            Toaster.show(activity, ctx.getString(R.string.dream_came_true))
        }
        actions += ctx.getString(R.string.delete) to {
            AlertDialog.Builder(activity)
                .setTitle(R.string.dream_delete_title)
                .setMessage(dream.title)
                .setPositiveButton(R.string.delete) { _, _ -> repo.delete("dreams/${dream.key}") }
                .setNegativeButton(R.string.settings_cancel, null)
                .show()
        }
        AlertDialog.Builder(activity)
            .setTitle("${dream.emoji} ${dream.title}")
            .setItems(actions.map { it.first }.toTypedArray()) { _, which -> actions[which].second() }
            .show()
    }

    private fun makeGoal(dream: Dream) {
        val key = newKey()
        repo.put("goals/$key", org.json.JSONObject()
            .put("title", dream.title).put("emoji", dream.emoji).put("at", System.currentTimeMillis()).put("dream", dream.key))
        repo.put("dreams/${dream.key}/goal", key)
        GoalScreen.show(activity, key)
    }

    private fun emptyState(): View = ctx.column(12).apply {
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(0, ctx.dp(48), 0, 0)
        val art = FrameLayout(ctx)
        art.addView(View(ctx).apply { background = ctx.glow() }, FrameLayout.LayoutParams(ctx.dp(240), ctx.dp(240), Gravity.CENTER))
        art.addView(PairMark(ctx, soft = true), FrameLayout.LayoutParams(WRAP, ctx.dp(110), Gravity.CENTER))
        addView(art, LinearLayout.LayoutParams(MATCH, ctx.dp(220)))
        addView(ctx.text(ctx.getString(R.string.dreams_empty_title), 22f, 700).apply { gravity = Gravity.CENTER })
        addView(ctx.text(ctx.getString(R.string.dreams_empty_text, store.partnerDisplay), 15f, 400, ctx.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        addView(ctx.primaryButton(ctx.getString(R.string.dreams_add_first), R.drawable.ic_plus) { addDream() }.lp(width = WRAP, top = 12))
    }

    // ---------- Adding a dream ----------

    private fun addDream() {
        var owner = Owner.OURS
        var category = filter ?: DreamCategory.TRAVEL
        var emoji = EMOJI.first()
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.dream_add_title), 22f, 700))
            val input = sheetInput(ctx.getString(R.string.dream_field_title), 60)
            sheet.addView(input)

            sheet.addView(sheetLabel(R.string.dream_picture))
            val emojis = FrameLayout(ctx)
            fun drawEmojis() {
                emojis.removeAllViews()
                emojis.addView(HorizontalScrollView(ctx).apply {
                    isHorizontalScrollBarEnabled = false
                    val row = ctx.row(6)
                    EMOJI.forEach { e ->
                        row.addView(ctx.text(e, 24f).apply {
                            gravity = Gravity.CENTER
                            background = ctx.ripple(ctx.rounded(ctx.col(if (e == emoji) R.color.her_tint else R.color.sunk), 22f,
                                if (e == emoji) ctx.col(R.color.her) else null, 2f), 22f)
                            setOnClickListener {
                                emoji = e
                                drawEmojis()
                            }
                        }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
                    }
                    addView(row)
                })
            }
            drawEmojis()
            sheet.addView(emojis)

            sheet.addView(sheetLabel(R.string.dream_category))
            val cats = FrameLayout(ctx)
            fun drawCats() {
                cats.removeAllViews()
                cats.addView(HorizontalScrollView(ctx).apply {
                    isHorizontalScrollBarEnabled = false
                    val row = ctx.row(8)
                    DreamCategory.entries.forEach { c ->
                        row.addView(ctx.chip(categoryName(ctx, c), c == category) {
                            category = c
                            drawCats()
                        })
                    }
                    addView(row)
                })
            }
            drawCats()
            sheet.addView(cats)

            sheet.addView(sheetLabel(R.string.dream_whose))
            val owners = FrameLayout(ctx)
            fun drawOwners() {
                owners.removeAllViews()
                owners.addView(ctx.segmented(
                    listOf(ctx.getString(R.string.dream_owner_me), ctx.getString(R.string.dream_owner_ours_short), store.partnerDisplay),
                    Owner.entries.indexOf(owner),
                ) {
                    owner = Owner.entries[it]
                    drawOwners()
                })
            }
            drawOwners()
            sheet.addView(owners)

            sheet.addView(ctx.primaryButton(ctx.getString(R.string.task_add)) {
                val title = input.text.toString().trim()
                if (title.isEmpty()) {
                    input.error = ctx.getString(R.string.wish_title_required)
                    return@primaryButton
                }
                repo.put("dreams/${newKey()}", DreamsModel.dreamJson(title, emoji, category, owner, System.currentTimeMillis(), repo.me))
                dialog.dismiss()
            }.lp(top = 8))
        }
    }

    private fun sheetLabel(res: Int) = ctx.text(ctx.getString(res), 13f, 700, ctx.col(R.color.ink2)).lp(top = 4)

    private fun sheetInput(hint: String, max: Int): EditText = EditText(ctx).apply {
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

    companion object {
        private val random = SecureRandom()

        val EMOJI = listOf("✨", "🌸", "✈️", "🏝️", "🏡", "🐶", "💃", "🌌", "🎓", "💍", "🚗", "💰", "🧘", "🎸", "📸", "🍷")

        fun newKey(): String = ChatFeed.newKey(System.currentTimeMillis(), random)
    }
}

fun categoryName(ctx: android.content.Context, cat: DreamCategory): String = ctx.getString(
    when (cat) {
        DreamCategory.TRAVEL -> R.string.dream_cat_travel
        DreamCategory.HOME -> R.string.dream_cat_home
        DreamCategory.MONEY -> R.string.dream_cat_money
        DreamCategory.HEALTH -> R.string.dream_cat_health
        DreamCategory.FUN -> R.string.dream_cat_fun
        DreamCategory.FAMILY -> R.string.dream_cat_family
    },
)

/** "248 000 ₴", or "$3,100" in English: the locale's grouping and where the unit usually goes. */
fun formatMoney(ctx: android.content.Context, amount: Long, unit: String): String {
    val number = NumberFormat.getIntegerInstance(ctx.locale()).format(amount)
    return when {
        unit.isBlank() -> number
        ctx.language() == "en" && unit in setOf("$", "€", "£") -> "$unit$number"
        else -> "$number $unit"
    }
}
