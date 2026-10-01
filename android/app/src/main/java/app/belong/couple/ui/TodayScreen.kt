package app.belong.couple.ui

import android.app.DatePickerDialog
import android.os.Build
import android.text.format.DateFormat
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.City
import app.belong.couple.core.Geo
import app.belong.couple.core.PartOfDay
import app.belong.couple.core.Recap
import app.belong.couple.core.TimeMath
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.demo.DemoPartner
import app.belong.couple.widget.CountdownWidget
import app.belong.couple.widget.DoodleWidget
import app.belong.couple.widget.MoodWidget
import app.belong.couple.widget.Widgets
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Date
import java.util.TimeZone

fun haptic(view: View) {
    view.performHapticFeedback(
        if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY,
    )
}

/** Local time in [zone], formatted the way the phone is set up (12 or 24 hours). */
fun android.content.Context.timeIn(zone: String, at: Date = Date()): String =
    DateFormat.getTimeFormat(this).apply { timeZone = TimeZone.getTimeZone(zone) }.format(at)

class TodayScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val body = ctx.column(16).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(12), side, ctx.dp(28))
    }
    override val view: View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }

    private val clockUpdaters = mutableListOf<() -> Unit>()
    private val tick = object : Runnable {
        override fun run() {
            clockUpdaters.forEach { it() }
            view.postDelayed(this, 30_000)
        }
    }

    init {
        view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                v.removeCallbacks(tick)
                v.post(tick)
            }

            override fun onViewDetachedFromWindow(v: View) {
                v.removeCallbacks(tick)
            }
        })
    }

    override fun refresh() {
        body.removeAllViews()
        clockUpdaters.clear()
        body.addView(header())
        body.addView(partnerCard())
        body.addView(checkInCard())
        body.addView(distanceCard())
        body.addView(countdownCard())
        body.addView(actions())
        body.addView(widgetsCard())
        clockUpdaters.forEach { it() }
    }

    private fun header(): View = ctx.row(12).apply {
        val greeting = when (TimeMath.partOfDay(LocalTime.now().hour)) {
            PartOfDay.MORNING -> R.string.greeting_morning
            PartOfDay.DAY -> R.string.greeting_day
            PartOfDay.EVENING -> R.string.greeting_evening
            PartOfDay.NIGHT -> R.string.greeting_night
        }
        val texts = ctx.column(2).apply {
            addView(ctx.text(ctx.getString(greeting), 28f, 800).apply { letterSpacing = -0.02f })
            addView(
                ctx.text(
                    "${ctx.getString(R.string.couple_line, store.myName, store.partnerName)} · ${ctx.formatDayHeader(LocalDate.now())}",
                    14f, 500, ctx.col(R.color.ink2),
                ),
            )
        }
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_settings, ctx.col(R.color.ink), 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = ctx.getString(R.string.settings)
            background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 24f), 24f)
            setOnClickListener { SettingsDialog.show(activity) }
        }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
    }

    private fun partnerCard(): View = ctx.card(spacingDp = 14).apply {
        val top = ctx.row(12)
        top.addView(ctx.avatar(store.partnerName, ctx.col(R.color.us_end)))
        val info = ctx.column(3)
        info.addView(ctx.text(ctx.getString(R.string.partner_now, store.partnerName), 17f, 700))
        info.addView(ctx.text(ctx.getString(R.string.mood_line, Recap.emojiFor(store.partnerMood), store.partnerEnergy), 15f, 500))
        val time = ctx.text("", 13f, 500, ctx.col(R.color.ink2))
        val city = store.partnerCity
        clockUpdaters += {
            val updated = ctx.getString(R.string.updated_at, DateFormat.getTimeFormat(ctx).format(Date(store.partnerMoodAt)))
            time.text = "${city.name(ctx.language())} ${ctx.timeIn(city.zone)} · $updated"
        }
        info.addView(time)
        top.addView(info, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(top)
        addView(ctx.meter(store.partnerEnergy, ctx.col(R.color.him)))
        addView(ctx.tintButton(ctx.getString(R.string.support), R.drawable.ic_heart, ctx.col(R.color.him_tint), ctx.col(R.color.on_tint)) { v ->
            haptic(v)
            ctx.toast(ctx.getString(R.string.support_sent, store.partnerName))
        })
    }

    private fun checkInCard(): View = ctx.card(spacingDp = 14).apply {
        val head = ctx.row(8)
        head.addView(ctx.text(ctx.getString(R.string.checkin_title), 17f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        head.addView(ctx.text(ctx.getString(R.string.checkin_hint, store.partnerName), 13f, 500, ctx.col(R.color.ink2)))
        addView(head)

        val moodNames = listOf(R.string.mood_1, R.string.mood_2, R.string.mood_3, R.string.mood_4, R.string.mood_5)
        val moods = ctx.row()
        for (mood in 1..5) {
            val selected = store.myMood == mood
            val face = ctx.text(Recap.emojiFor(mood), 24f).apply {
                gravity = Gravity.CENTER
                background = ctx.ripple(
                    ctx.rounded(
                        ctx.col(if (selected) R.color.her_tint else R.color.sunk), 26f,
                        if (selected) ctx.col(R.color.her) else null, 2f,
                    ),
                    26f,
                )
                contentDescription = ctx.getString(moodNames[mood - 1])
                isSelected = selected
                setOnClickListener { v ->
                    haptic(v)
                    store.setMyCheckIn(mood, store.myEnergy)
                    refresh()
                }
            }
            val cell = FrameLayout(ctx)
            cell.addView(face, FrameLayout.LayoutParams(ctx.dp(52), ctx.dp(52), Gravity.CENTER))
            moods.addView(cell, LinearLayout.LayoutParams(0, ctx.dp(56), 1f))
        }
        addView(moods)

        val energy = ctx.row(10)
        energy.addView(ctx.text(ctx.getString(R.string.energy), 13f, 600, ctx.col(R.color.ink2)))
        val segments = ctx.row(4)
        for (level in 1..5) {
            val cell = FrameLayout(ctx).apply {
                contentDescription = ctx.getString(R.string.energy_level, level)
                isSelected = level == store.myEnergy
                background = ctx.ripple(ctx.rounded(0, 8f), 8f)
                setOnClickListener {
                    store.setMyCheckIn(store.myMood, level)
                    refresh()
                }
            }
            cell.addView(View(ctx).apply {
                background = ctx.rounded(ctx.col(if (level <= store.myEnergy) R.color.her else R.color.her_tint), 5f)
            }, FrameLayout.LayoutParams(MATCH, ctx.dp(14), Gravity.CENTER))
            segments.addView(cell, LinearLayout.LayoutParams(0, ctx.dp(44), 1f))
        }
        energy.addView(segments, LinearLayout.LayoutParams(0, WRAP, 1f))
        energy.addView(ctx.text("${store.myEnergy}/5", 15f, 800))
        addView(energy)
    }

    private fun clockBox(city: City, name: String, tint: Int): View = ctx.column(2).apply {
        background = ctx.rounded(tint, 20f)
        val p = ctx.dp(12)
        setPadding(p, p, p, p)
        gravity = Gravity.CENTER_HORIZONTAL
        addView(ctx.text(city.name(ctx.language()), 13f, 700, ctx.col(R.color.on_tint)))
        val time = ctx.text("", 26f, 800).apply { letterSpacing = -0.02f }
        clockUpdaters += { time.text = ctx.timeIn(city.zone) }
        addView(time)
        addView(ctx.text(name, 12f, 600, ctx.col(R.color.on_tint)))
    }

    private fun distanceCard(): View = ctx.card().apply {
        addView(ctx.text(ctx.getString(R.string.distance_title), 14f, 700, ctx.col(R.color.ink2)))
        val clocks = ctx.row(10)
        clocks.addView(clockBox(store.myCity, store.myName, ctx.col(R.color.her_tint)), LinearLayout.LayoutParams(0, WRAP, 1f))
        clocks.addView(clockBox(store.partnerCity, store.partnerName, ctx.col(R.color.him_tint)), LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(clocks)
        val km = Geo.roundedKm(Geo.distanceKm(store.myCity, store.partnerCity))
        val hours = TimeMath.hoursAhead(store.myCity.zone, store.partnerCity.zone, Instant.now())
        val kmText = ctx.getString(R.string.km, NumberFormat.getIntegerInstance(ctx.locale()).format(km))
        val diff = if (hours == 0.0) ctx.getString(R.string.same_zone) else ctx.getString(R.string.hours_apart, TimeMath.formatHours(hours))
        addView(ctx.text("$kmText · $diff", 15f, 700))
    }

    private fun countdownCard(): View = ctx.card(
        spacingDp = 6,
        background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint)),
    ).apply {
        elevation = 0f
        addView(ctx.text(ctx.getString(R.string.countdown_title), 14f, 700, ctx.col(R.color.on_tint)))
        val days = TimeMath.daysUntil(LocalDate.now(ZoneId.systemDefault()), store.meetingDate)
        val headline = when {
            days > 0 -> ctx.resources.getQuantityString(R.plurals.days, days.toInt(), days.toInt())
            days == 0L -> ctx.getString(R.string.countdown_today)
            else -> ctx.getString(R.string.countdown_past)
        }
        addView(ctx.text(headline, 34f, 800).apply { letterSpacing = -0.02f })
        if (days >= 0) addView(ctx.text(ctx.formatLongDate(store.meetingDate), 14f, 500, ctx.col(R.color.on_tint)))
        addView(ctx.text(ctx.getString(R.string.change_date), 14f, 800).apply {
            minHeight = ctx.dp(44)
            gravity = Gravity.CENTER_VERTICAL
            paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
            setOnClickListener { pickMeetingDate() }
        })
    }

    private fun pickMeetingDate() {
        val date = store.meetingDate
        DatePickerDialog(activity, { _, year, month, day ->
            store.meetingDate = LocalDate.of(year, month + 1, day)
            Widgets.updateAll(ctx)
            refresh()
        }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
            datePicker.minDate = System.currentTimeMillis() - 1_000
        }.show()
    }

    private fun actions(): View = ctx.column(10).apply {
        addView(ctx.primaryButton(ctx.getString(R.string.think), R.drawable.ic_heart) { v ->
            haptic(v)
            store.increment(Counter.TAPS_SENT)
            ctx.toast(ctx.getString(R.string.think_sent, store.partnerName))
            DemoPartner.onThinkingSent(ctx)
        })
        addView(ctx.tintButton(ctx.getString(R.string.safe), R.drawable.ic_shield, ctx.col(R.color.ok_tint), ctx.col(R.color.ok_ink)) { v ->
            haptic(v)
            store.increment(Counter.SAFE)
            ctx.toast(ctx.getString(R.string.safe_sent, store.partnerName))
        })
    }

    private fun widgetsCard(): View = ctx.card().apply {
        addView(ctx.text(ctx.getString(R.string.widgets_title), 17f, 700))
        addView(ctx.text(ctx.getString(R.string.widgets_text), 14f, 400, ctx.col(R.color.ink2)))
        val buttons = ctx.row(8)
        listOf(
            R.string.add_widget_mood to MoodWidget::class.java,
            R.string.add_widget_countdown to CountdownWidget::class.java,
            R.string.add_widget_doodle to DoodleWidget::class.java,
        ).forEach { (label, cls) ->
            buttons.addView(ctx.secondaryButton("+ ${ctx.getString(label)}") {
                if (!Widgets.requestPin(ctx, cls)) ctx.toast(ctx.getString(R.string.widget_pin_unsupported))
            }.apply {
                textSize = 14f
                minHeight = ctx.dp(48)
                setPadding(ctx.dp(6), 0, ctx.dp(6), 0)
            }, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        addView(buttons)
    }
}
