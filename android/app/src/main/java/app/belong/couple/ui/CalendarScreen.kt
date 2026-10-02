package app.belong.couple.ui

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.CalendarModel
import app.belong.couple.core.Upcoming
import app.belong.couple.data.DataEvents
import app.belong.couple.data.SharedRepo
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.WeekFields

/** Important dates: a month grid with dots, what's coming up, and adding birthdays, anniversaries and plans. */
class CalendarScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val repo = SharedRepo(ctx)
    private var month = YearMonth.now()
    private val body = ctx.column().apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(8), side, ctx.dp(104))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = FrameLayout(ctx).apply {
        addView(scroll, FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.fab(ctx.getString(R.string.calendar_add)) { addDate() },
            FrameLayout.LayoutParams(ctx.dp(56), ctx.dp(56), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, ctx.dp(20), ctx.dp(20)) })
    }

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    private val today: Long get() = LocalDate.now(ZoneId.systemDefault()).toEpochDay()

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val root = repo.root()
        body.addView(ctx.text(ctx.getString(R.string.calendar_title), 28f, 700))
        body.addView(monthCard(root).lp(top = 16))
        body.addView(ctx.text(ctx.getString(R.string.calendar_upcoming), 22f, 700).lp(top = 28))
        val upcoming = CalendarModel.upcoming(root, today, ctx.getString(R.string.calendar_anniversary), ctx.getString(R.string.countdown_title))
        if (upcoming.isEmpty()) body.addView(ctx.text(ctx.getString(R.string.calendar_empty), 15f, 500, ctx.col(R.color.ink2)).lp(top = 8))
        val list = ctx.card(paddingDp = 16, spacingDp = 0)
        upcoming.forEachIndexed { i, u ->
            if (i > 0) list.addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.sunk)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(1)))
            list.addView(row(u))
        }
        if (upcoming.isNotEmpty()) body.addView(list.lp(top = 12))
        scroll.post { scroll.scrollTo(0, y) }
    }

    private fun monthCard(root: org.json.JSONObject): View = ctx.card(paddingDp = 12, spacingDp = 8).apply {
        val head = ctx.row(4)
        head.addView(arrow(R.drawable.ic_back, ctx.getString(R.string.calendar_prev)) {
            month = month.minusMonths(1)
            refresh()
        })
        head.addView(ctx.text(DateTimeFormatter.ofPattern("LLLL yyyy", ctx.locale()).format(month).replaceFirstChar { it.titlecase(ctx.locale()) }, 17f, 700).apply {
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        head.addView(arrow(R.drawable.ic_chevron, ctx.getString(R.string.calendar_next)) {
            month = month.plusMonths(1)
            refresh()
        })
        addView(head)

        val firstDay = WeekFields.of(ctx.locale()).firstDayOfWeek
        val names = ctx.row()
        for (i in 0 until 7) {
            names.addView(ctx.text(firstDay.plus(i.toLong()).getDisplayName(TextStyle.SHORT_STANDALONE, ctx.locale()), 12f, 700, ctx.col(R.color.ink2)).apply {
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        addView(names)
        val marks = CalendarModel.inMonth(root, month)
        val meeting = if (CalendarModel.apart(root) == true) CalendarModel.meeting(root) else null
        val since = app.belong.couple.core.TogetherModel.since(root)
        val offset = Math.floorMod(month.atDay(1).dayOfWeek.value - firstDay.value, 7)
        var dayNumber = 1 - offset
        while (dayNumber <= month.lengthOfMonth()) {
            val week = ctx.row()
            for (i in 0 until 7) {
                val cell = ctx.column(2).apply { gravity = Gravity.CENTER_HORIZONTAL }
                if (dayNumber in 1..month.lengthOfMonth()) {
                    val date = month.atDay(dayNumber)
                    val isToday = date.toEpochDay() == today
                    val anniversary = since != null && LocalDate.ofEpochDay(since).let { it.monthValue == date.monthValue && it.dayOfMonth == date.dayOfMonth && it.year < date.year }
                    val hasDot = marks[dayNumber] != null || anniversary || meeting == date.toEpochDay()
                    cell.addView(ctx.text(dayNumber.toString(), 15f, if (isToday) 800 else 500, ctx.col(if (isToday) R.color.white else R.color.ink)).apply {
                        gravity = Gravity.CENTER
                        if (isToday) background = ctx.gradient(999f, ctx.col(R.color.us_start), ctx.col(R.color.us_end))
                    }, LinearLayout.LayoutParams(ctx.dp(34), ctx.dp(34)))
                    cell.addView(View(ctx).apply {
                        background = if (hasDot) ctx.rounded(ctx.col(if (meeting == date.toEpochDay()) R.color.him else R.color.her), 3f) else null
                    }, LinearLayout.LayoutParams(ctx.dp(6), ctx.dp(6)))
                    marks[dayNumber]?.let { dates -> cell.contentDescription = "$dayNumber: " + dates.joinToString { it.title } }
                }
                week.addView(cell, LinearLayout.LayoutParams(0, WRAP, 1f))
                dayNumber++
            }
            addView(week)
        }
    }

    private fun arrow(iconRes: Int, label: String, onClick: () -> Unit): View = ImageView(ctx).apply {
        setImageDrawable(ctx.icon(iconRes, ctx.col(R.color.ink), 20))
        scaleType = ImageView.ScaleType.CENTER
        contentDescription = label
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 22f), 22f)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44))
    }

    private fun row(u: Upcoming): View = ctx.row(14).apply {
        minimumHeight = ctx.dp(60)
        addView(ctx.text(u.emoji, 22f).apply {
            gravity = Gravity.CENTER
            background = ctx.rounded(ctx.col(R.color.her_tint), 14f)
        }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        val texts = ctx.column(2)
        texts.addView(ctx.text(u.title, 16f, 700))
        texts.addView(ctx.text(listOfNotNull(ctx.formatLongDate(LocalDate.ofEpochDay(u.date)), u.years?.let { ctx.resources.getQuantityString(R.plurals.years, it, it) }).joinToString(" · "), 13f, 500, ctx.col(R.color.ink2)))
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ctx.text(
            if (u.daysLeft == 0L) ctx.getString(R.string.countdown_today) else ctx.resources.getQuantityString(R.plurals.days, u.daysLeft.toInt(), u.daysLeft.toInt()),
            14f, 800, ctx.col(if (u.daysLeft <= 7) R.color.honey_ink else R.color.ink),
        ))
        if (u.kind == Upcoming.Kind.DATE) setOnLongClickListener {
            AlertDialog.Builder(activity).setTitle(R.string.calendar_delete).setMessage(u.title)
                .setPositiveButton(R.string.delete) { _, _ -> repo.delete("dates/${u.key}") }
                .setNegativeButton(R.string.settings_cancel, null).show()
            true
        }
    }

    private fun addDate() {
        var emoji = EMOJI.first()
        var day = today
        var yearly = true
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.calendar_add), 22f, 700))
            val title = android.widget.EditText(ctx).apply {
                hint = ctx.getString(R.string.calendar_field_title)
                inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                filters = arrayOf(android.text.InputFilter.LengthFilter(60))
                typeface = Fonts.get(ctx, 500)
                setTextColor(ctx.col(R.color.ink))
                setHintTextColor(ctx.col(R.color.ink2))
                background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
                setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
                minHeight = ctx.dp(52)
            }
            sheet.addView(title)
            val emojis = FrameLayout(ctx)
            fun drawEmojis() {
                emojis.removeAllViews()
                emojis.addView(HorizontalScrollView(ctx).apply {
                    isHorizontalScrollBarEnabled = false
                    val row = ctx.row(6)
                    EMOJI.forEach { e ->
                        row.addView(ctx.text(e, 22f).apply {
                            gravity = Gravity.CENTER
                            background = ctx.ripple(ctx.rounded(ctx.col(if (e == emoji) R.color.her_tint else R.color.sunk), 22f, if (e == emoji) ctx.col(R.color.her) else null, 2f), 22f)
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
            val date = ctx.secondaryButton(ctx.formatLongDate(LocalDate.ofEpochDay(day)), R.drawable.ic_calendar) {}
            date.setOnClickListener {
                val d = LocalDate.ofEpochDay(day)
                DatePickerDialog(activity, { _, y, m, dd ->
                    day = LocalDate.of(y, m + 1, dd).toEpochDay()
                    date.text = ctx.formatLongDate(LocalDate.ofEpochDay(day))
                }, d.year, d.monthValue - 1, d.dayOfMonth).show()
            }
            sheet.addView(date)
            val repeat = FrameLayout(ctx)
            fun drawRepeat() {
                repeat.removeAllViews()
                repeat.addView(ctx.segmented(listOf(ctx.getString(R.string.calendar_yearly), ctx.getString(R.string.calendar_once)), if (yearly) 0 else 1) {
                    yearly = it == 0
                    drawRepeat()
                })
            }
            drawRepeat()
            sheet.addView(repeat)
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.settings_save)) {
                val t = title.text.toString().trim()
                if (t.isEmpty()) {
                    title.error = ctx.getString(R.string.wish_title_required)
                    return@primaryButton
                }
                repo.put("dates/${DreamsScreen.newKey()}", org.json.JSONObject().put("title", t).put("emoji", emoji).put("day", day).put("yearly", yearly).put("at", System.currentTimeMillis()))
                dialog.dismiss()
            }.lp(top = 8))
            title.requestFocus()
        }
    }

    companion object {
        val EMOJI = listOf("🎂", "💞", "💍", "✈️", "🎉", "🌹", "🏡", "🎓", "🐶", "📅")
    }
}
