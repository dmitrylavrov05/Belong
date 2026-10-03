package app.belong.couple.ui

import android.app.DatePickerDialog
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.ChronicleItem
import app.belong.couple.core.TogetherModel
import app.belong.couple.data.Account
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.SharedRepo
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * "Us": the couple's chronicle — how long you've been together, dreams that came true, goals
 * reached, memories and "on this day" — followed by everything else (wishlist, games, settings…).
 */
class UsScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private val body = ctx.column().apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(20), side, ctx.dp(28))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = scroll

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    private val today: Long get() = LocalDate.now(ZoneId.systemDefault()).toEpochDay()

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val root = repo.root()
        body.addView(header(TogetherModel.since(root)))
        // Everything you can do together, in groups of tiles; the chronicle follows below.
        group(R.string.us_group_each_other, listOf(
            Tile("💌", R.string.letters_title) { activity.select(MainActivity.TAB_LETTERS) },
            Tile("🤍", R.string.feelings_title) { activity.select(MainActivity.TAB_FEELINGS) },
            Tile("🎁", R.string.wish_title) { activity.select(MainActivity.TAB_WISHLIST) },
            Tile("✏️", R.string.tab_doodle) { activity.select(MainActivity.TAB_DOODLE) },
        ))
        group(R.string.us_group_fun, listOf(
            Tile("🎬", R.string.movies_title) { activity.select(MainActivity.TAB_MOVIES) },
            Tile("🧠", R.string.quiz_title) { QuizScreen.show(activity) },
            Tile("🎲", R.string.games_title) { activity.select(MainActivity.TAB_GAMES) },
        ))
        group(R.string.us_group_story, listOf(
            Tile("✨", R.string.month_title) { activity.select(MainActivity.TAB_MONTH) },
            Tile("📅", R.string.calendar_title) { activity.select(MainActivity.TAB_CALENDAR) },
            Tile("🗺", R.string.map_title) { activity.select(MainActivity.TAB_MAP) },
        ))
        group(R.string.us_group_settings, listOfNotNull(
            if (Account.get(ctx).available) Tile("🔗", R.string.pair_title) { PairDialog.show(activity) } else null,
            Tile("📱", R.string.widgets_title) { WidgetsSheet.show(activity) },
            Tile("⚙️", R.string.settings_title) { activity.select(MainActivity.TAB_SETTINGS) },
        ))

        body.addView(ctx.text(ctx.getString(R.string.us_chronicle), 22f, 700).lp(top = 32))
        val items = TogetherModel.chronicle(root, repo.me, today)
        if (items.isEmpty()) body.addView(ctx.text(ctx.getString(R.string.us_chronicle_empty), 15f, 500, ctx.col(R.color.ink2)).lp(top = 8))
        items.forEachIndexed { i, item -> body.addView(timelineRow(item, last = i == items.lastIndex).lp(top = if (i == 0) 12 else 0)) }
        body.addView(ctx.secondaryButton(ctx.getString(R.string.us_add_moment), R.drawable.ic_plus) { MomentSheet.show(activity) }.lp(top = 12))
        scroll.post { scroll.scrollTo(0, y) }
    }

    private fun header(since: Long?): View = ctx.column(6).apply {
        gravity = Gravity.CENTER_HORIZONTAL
        addView(PairMark(ctx).apply {
            initials = store.myName.take(1).uppercase() to store.partnerDisplay.take(1).uppercase()
            if (EasterEgg.isFor(store.myName)) setOnClickListener { v -> secretTap(v) }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(WRAP, ctx.dp(64)))
        addView(ctx.text(ctx.getString(R.string.couple_line, store.myName, store.partnerDisplay), 20f, 700).apply { gravity = Gravity.CENTER })
        val line = if (since != null) {
            val days = (today - since).toInt()
            ctx.getString(R.string.us_together, ctx.resources.getQuantityString(R.plurals.days, days, days), longDate(since))
        } else {
            ctx.getString(R.string.us_set_since)
        }
        addView(ctx.text(line, 14f, 500, ctx.col(R.color.ink2)).apply {
            gravity = Gravity.CENTER
            minHeight = ctx.dp(44)
            setPadding(ctx.dp(8), 0, ctx.dp(8), 0)
            background = ctx.ripple(ctx.rounded(ctx.col(R.color.bg), 12f), 12f)
            setOnClickListener { pickSince(since) }
            if (since == null) setTextColor(ctx.col(R.color.us_end))
        })
    }

    private var taps = 0
    private var lastTap = 0L

    /** Seven quick taps on the two dots: a little heartbeat on each, and then the secret. */
    private fun secretTap(v: View) {
        val now = System.currentTimeMillis()
        taps = if (now - lastTap < 1500) taps + 1 else 1
        lastTap = now
        if (taps >= 3) v.animate().scaleX(1.12f).scaleY(1.12f).setDuration(90).withEndAction {
            v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
        }.start()
        if (taps >= EasterEgg.TAPS) {
            taps = 0
            haptic(v)
            EasterEgg.show(activity)
        }
    }

    private fun pickSince(current: Long?) {
        val date = LocalDate.ofEpochDay(current ?: (today - 365))
        DatePickerDialog(activity, { _, y, m, d ->
            repo.put("couple/since", LocalDate.of(y, m + 1, d).toEpochDay())
        }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
            datePicker.maxDate = System.currentTimeMillis()
        }.show()
    }

    private fun longDate(day: Long) = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(ctx.locale()).format(LocalDate.ofEpochDay(day))

    /** A dot on the line, the date above, and the card. */
    private fun timelineRow(item: ChronicleItem, last: Boolean): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        val rail = FrameLayout(ctx)
        if (!last) rail.addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.line)) }, FrameLayout.LayoutParams(ctx.dp(2), MATCH, Gravity.CENTER_HORIZONTAL))
        val dotColor = when (item.kind) {
            ChronicleItem.Kind.DREAM -> R.color.us_end
            ChronicleItem.Kind.GOAL -> R.color.ok
            ChronicleItem.Kind.MOMENT -> if (item.anniversary) R.color.honey else R.color.her
            ChronicleItem.Kind.SINCE -> R.color.her
        }
        rail.addView(ctx.ownerDot(ctx.col(dotColor), 10).apply {
            layoutParams = FrameLayout.LayoutParams(ctx.dp(10), ctx.dp(10), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = ctx.dp(4) }
        })
        addView(rail, LinearLayout.LayoutParams(ctx.dp(20), MATCH))
        val col = ctx.column(6).apply { setPadding(ctx.dp(8), 0, 0, ctx.dp(20)) }
        col.addView(ctx.text(dateLabel(item.day), 12f, 700, ctx.col(R.color.ink2)))
        col.addView(card(item))
        addView(col, LinearLayout.LayoutParams(0, WRAP, 1f))
    }

    private fun dateLabel(day: Long): String {
        val date = LocalDate.ofEpochDay(day)
        val pattern = android.text.format.DateFormat.getBestDateTimePattern(ctx.locale(), "LLLLyyyy")
        return DateTimeFormatter.ofPattern(pattern, ctx.locale()).format(date)
    }

    private fun card(item: ChronicleItem): View = ctx.card(paddingDp = 8, spacingDp = 8).apply {
        val (title, text) = when (item.kind) {
            ChronicleItem.Kind.DREAM -> ctx.getString(R.string.dream_came_true) to item.title
            ChronicleItem.Kind.GOAL -> ctx.getString(R.string.us_goal_done, item.title) to ctx.resources.getQuantityString(R.plurals.steps, item.text.toIntOrNull() ?: 0, item.text.toIntOrNull() ?: 0)
            ChronicleItem.Kind.MOMENT -> (if (item.anniversary) ctx.getString(R.string.us_on_this_day) else item.title) to (if (item.anniversary) listOf(item.title, item.text).filter { it.isNotBlank() }.joinToString(": ") else item.text)
            ChronicleItem.Kind.SINCE -> ctx.getString(R.string.us_since_title) to longDate(item.day)
        }
        item.photo?.let { photo ->
            addView(roundedImage(ctx, 18f).also { RemoteImage.load(it, photo.thumb, ctx.dp(200)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(150)))
        }
        val row = ctx.row(12).apply { setPadding(ctx.dp(6), ctx.dp(2), ctx.dp(6), ctx.dp(4)) }
        if (item.photo == null) row.addView(ctx.text(item.emoji, 22f).apply {
            gravity = Gravity.CENTER
            background = ctx.rounded(ctx.col(if (item.kind == ChronicleItem.Kind.GOAL) R.color.ok_tint else R.color.her_tint), 14f)
        }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        val texts = ctx.column(2)
        texts.addView(ctx.text(title, 15f, 700))
        if (text.isNotBlank()) texts.addView(ctx.text(text, 13f, 500, ctx.col(R.color.ink2)))
        row.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(row)
        if (item.kind == ChronicleItem.Kind.MOMENT) setOnLongClickListener {
            android.app.AlertDialog.Builder(activity)
                .setTitle(R.string.us_delete_moment)
                .setMessage(item.title)
                .setPositiveButton(R.string.delete) { _, _ -> repo.delete("moments/${item.key}") }
                .setNegativeButton(R.string.settings_cancel, null)
                .show()
            true
        }
    }

    private class Tile(val emoji: String, val title: Int, val onClick: () -> Unit)

    /** A titled group of tiles, two to a row. */
    private fun group(title: Int, tiles: List<Tile>) {
        body.addView(ctx.text(ctx.getString(title), 13f, 700, ctx.col(R.color.ink2)).apply { isAllCaps = true; letterSpacing = 0.06f }.lp(top = 24))
        val box = ctx.column(10)
        tiles.chunked(2).forEach { pair ->
            val row = ctx.row(10)
            pair.forEach { t ->
                row.addView(ctx.card(paddingDp = 14, spacingDp = 8).apply {
                    addView(ctx.text(t.emoji, 24f).apply {
                        gravity = Gravity.CENTER
                        background = ctx.gradient(14f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
                    }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
                    addView(ctx.text(ctx.getString(t.title), 15f, 700).apply { maxLines = 2 })
                    isClickable = true
                    background = ctx.ripple(background, 24f)
                    setOnClickListener { t.onClick() }
                }, LinearLayout.LayoutParams(0, if (pair.size == 2) MATCH else WRAP, 1f))
            }
            if (pair.size == 1) row.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
            box.addView(row)
        }
        body.addView(box.lp(top = 10))
    }

}

/** "Add a memory": a title, a few words, the date and optionally a photo. */
object MomentSheet {
    fun show(activity: MainActivity) {
        val ctx = activity
        var day = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.us_add_moment), 22f, 700))
            fun field(hint: Int, max: Int) = android.widget.EditText(ctx).apply {
                this.hint = ctx.getString(hint)
                inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                filters = arrayOf(android.text.InputFilter.LengthFilter(max))
                typeface = Fonts.get(ctx, 500)
                setTextColor(ctx.col(R.color.ink))
                setHintTextColor(ctx.col(R.color.ink2))
                background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
                setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
                minHeight = ctx.dp(52)
            }
            val title = field(R.string.us_moment_title, 80)
            val text = field(R.string.us_moment_text, 300)
            sheet.addView(title)
            sheet.addView(text)
            val date = ctx.secondaryButton(ctx.formatLongDate(LocalDate.ofEpochDay(day)), R.drawable.ic_calendar) {}
            date.setOnClickListener {
                val d = LocalDate.ofEpochDay(day)
                DatePickerDialog(activity, { _, y, m, dd ->
                    day = LocalDate.of(y, m + 1, dd).toEpochDay()
                    date.text = ctx.formatLongDate(LocalDate.ofEpochDay(day))
                }, d.year, d.monthValue - 1, d.dayOfMonth).apply { datePicker.maxDate = System.currentTimeMillis() }.show()
            }
            sheet.addView(date)
            sheet.addView(ctx.text(ctx.getString(R.string.photo_title), 13f, 700, ctx.col(R.color.ink2)).lp(top = 4))
            val picker = PhotoPicker(activity, null)
            sheet.addView(picker.view)
            title.addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: android.text.Editable?) = picker.search(s.toString())
            })
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.settings_save)) {
                val t = title.text.toString().trim()
                if (t.isEmpty()) {
                    title.error = ctx.getString(R.string.wish_title_required)
                    return@primaryButton
                }
                val moment = org.json.JSONObject().put("title", t).put("text", text.text.toString().trim()).put("day", day).put("at", System.currentTimeMillis())
                picker.picked?.let { moment.put("photo", it.toJson()) }
                picker.confirm()
                SharedRepo(ctx).put("moments/${DreamsScreen.newKey()}", moment)
                dialog.dismiss()
            }.lp(top = 8))
            title.requestFocus()
        }
    }
}
