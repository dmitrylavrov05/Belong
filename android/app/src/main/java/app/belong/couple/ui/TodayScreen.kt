package app.belong.couple.ui

import android.app.DatePickerDialog
import android.graphics.Typeface
import android.os.Build
import android.text.InputFilter
import android.text.InputType
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.format.DateFormat
import android.text.style.StyleSpan
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.FeelingsModel
import app.belong.couple.core.Geo
import app.belong.couple.core.LettersModel
import app.belong.couple.core.Owner
import app.belong.couple.core.PartOfDay
import app.belong.couple.core.PhotosModel
import app.belong.couple.core.Recap
import app.belong.couple.core.Task
import app.belong.couple.core.TimeMath
import app.belong.couple.data.Account
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import app.belong.couple.data.TaskRepo
import app.belong.couple.demo.DemoPartner
import app.belong.couple.sync.LiveModel
import app.belong.couple.sync.LiveSync
import app.belong.couple.widget.CountdownWidget
import app.belong.couple.widget.DoodleWidget
import app.belong.couple.widget.MoodWidget
import app.belong.couple.widget.TasksWidget
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

/**
 * The couple's day: the partner's mood, your check-in, countdowns, the shared plan and the
 * "thinking of you" / "I'm safe" taps. When paired, all of it is shared through [LiveSync].
 */
class TodayScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val body = ctx.column().apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(104))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        clipToPadding = false
        addView(body)
    }
    override val view: View = FrameLayout(ctx).apply {
        addView(scroll, FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.fab(ctx.getString(R.string.add_task_title)) { addTaskSheet() }.apply { tag = "fab" }, FrameLayout.LayoutParams(ctx.dp(56), ctx.dp(56), Gravity.BOTTOM or Gravity.END).apply {
            setMargins(0, 0, ctx.dp(20), ctx.dp(20))
        })
    }

    private val everyday = EverydayCards(activity) { refresh() }

    /** Which part of the plan is shown: mine, ours or the partner's. */
    private var planFilter = Owner.ME

    private val clockUpdaters = mutableListOf<() -> Unit>()
    private val tick = object : Runnable {
        override fun run() {
            clockUpdaters.forEach { it() }
            view.postDelayed(this, 30_000)
        }
    }

    private val paired: Boolean get() = Account.get(ctx).paired

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
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val scrollY = scroll.scrollY
        body.removeAllViews()
        clockUpdaters.clear()
        body.addView(header())
        if (store.apart == null) body.addView(modeCard().lp(top = 24))
        feelingsCard()?.let { body.addView(it.lp(top = 24)) }
        letterCard()?.let { body.addView(it.lp(top = 24)) }
        body.addView(partnerCard().lp(top = 24))
        body.addView(checkInCard().lp(top = 12))
        body.addView(countdowns().lp(top = 28))
        reportCard()?.let { body.addView(it.lp(top = 28)) }
        body.addView(photoCard().lp(top = 28))
        body.addView(planHeader().lp(top = 28))
        body.addView(ctx.segmented(
            listOf(ctx.getString(R.string.owner_me), ctx.getString(R.string.owner_ours), store.partnerDisplay),
            Owner.entries.indexOf(planFilter),
        ) {
            planFilter = Owner.entries[it]
            refresh()
        }.lp(top = 12))
        body.addView(planCard().lp(top = 12))
        everyday.eveningCard()?.let { body.addView(it.lp(top = 28)) }
        body.addView(everyday.shoppingHeader().lp(top = 28))
        body.addView(everyday.shoppingCard().lp(top = 8))
        body.addView(everyday.questionCard().lp(top = 28))
        body.addView(actions().lp(top = 28))
        body.addView(widgetsCard().lp(top = 28))
        clockUpdaters.forEach { it() }
        scroll.post { scroll.scrollTo(0, scrollY) }
    }

    // ---------- Header ----------

    private fun header(): View = ctx.row(12).apply {
        val greeting = when (TimeMath.partOfDay(LocalTime.now().hour)) {
            PartOfDay.MORNING -> R.string.greeting_morning_name
            PartOfDay.DAY -> R.string.greeting_day_name
            PartOfDay.EVENING -> R.string.greeting_evening_name
            PartOfDay.NIGHT -> R.string.greeting_night_name
        }
        val texts = ctx.column(2)
        texts.addView(ctx.text(ctx.getString(greeting, store.myName), 28f, 700).apply { letterSpacing = -0.01f })
        texts.addView(ctx.text(ctx.formatDayHeader(LocalDate.now()), 15f, 500, ctx.col(R.color.ink2)))
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(PairMark(ctx).apply {
            initials = initial(store.myName) to initial(store.partnerDisplay)
            contentDescription = ctx.getString(R.string.settings)
            setOnClickListener { SettingsDialog.show(activity) }
        }, LinearLayout.LayoutParams(WRAP, ctx.dp(44)))
    }

    private fun initial(name: String) = name.trim().take(1).uppercase(ctx.locale())

    // ---------- Partner and check-in ----------

    private fun partnerCard(): View = ctx.card(paddingDp = 16, spacingDp = 14).apply {
        val top = ctx.row(12).apply { gravity = Gravity.TOP }
        top.addView(ctx.avatar(store.partnerDisplay, ctx.col(R.color.him), 44))
        val info = ctx.column(4)
        val name = store.partnerDisplay
        val line = SpannableStringBuilder()
        if (store.hasPartnerCheckIn) {
            val energy = store.partnerEnergy
            val note = ctx.getString(
                when {
                    energy <= 2 -> R.string.energy_note_low
                    energy == 3 -> R.string.energy_note_mid
                    else -> R.string.energy_note_high
                },
            )
            line.append(ctx.getString(R.string.partner_today, name, Recap.emojiFor(store.partnerMood)))
            line.setSpan(StyleSpan(Typeface.BOLD), 0, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            line.append(ctx.getString(R.string.partner_energy_line, energy, note))
        } else {
            line.append(ctx.getString(R.string.partner_no_checkin, name))
        }
        info.addView(ctx.text(line, 16f, 500))
        val time = ctx.text("", 13f, 500, ctx.col(R.color.ink2))
        val city = store.partnerCity
        val apart = store.apart == true
        clockUpdaters += {
            // The partner's city and local time matter only when you live apart.
            val local = if (apart) "${city.name(ctx.language())} ${ctx.timeIn(city.zone)}" else ""
            val updated = if (store.hasPartnerCheckIn) ctx.getString(R.string.updated_at, DateFormat.getTimeFormat(ctx).format(Date(store.partnerMoodAt))) else ""
            time.text = listOf(local, updated).filter { it.isNotEmpty() }.joinToString(" · ")
            time.visibility = if (time.text.isEmpty()) View.GONE else View.VISIBLE
        }
        info.addView(time)
        if (store.hasPartnerCheckIn) info.addView(ctx.meter(store.partnerEnergy, ctx.col(R.color.him), 6).lp(width = ctx.dp(156), top = 4))
        top.addView(info, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(top)
        addView(ctx.tintButton(ctx.getString(R.string.support), R.drawable.ic_heart, ctx.col(R.color.him_tint), ctx.col(R.color.ink)) { v ->
            haptic(v)
            tap(LiveModel.SUPPORT, ctx.getString(R.string.support_sent, store.partnerDisplay), null)
        }.apply { minHeight = ctx.dp(44) })
    }

    private fun checkInCard(): View = ctx.card(paddingDp = 16, spacingDp = 14).apply {
        val head = ctx.row(8)
        head.addView(ctx.text(ctx.getString(R.string.checkin_title_name, store.myName), 17f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        head.addView(ctx.text(ctx.getString(R.string.checkin_hint, store.partnerDisplay), 13f, 500, ctx.col(R.color.ink2)))
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
                    LiveSync.checkIn(ctx, mood, store.myEnergy)
                    refresh()
                }
            }
            val cell = FrameLayout(ctx)
            cell.addView(face, FrameLayout.LayoutParams(ctx.dp(52), ctx.dp(52), Gravity.CENTER))
            moods.addView(cell, LinearLayout.LayoutParams(0, ctx.dp(56), 1f))
        }
        addView(moods)

        // Energy as a little battery: five cells inside an outline with a cap.
        val energy = ctx.row(10)
        energy.addView(ctx.text(ctx.getString(R.string.energy), 13f, 600, ctx.col(R.color.ink2)))
        val battery = ctx.row(3).apply {
            background = ctx.rounded(ctx.col(R.color.surface), 8f, ctx.col(R.color.line), 1.5f)
            val p = ctx.dp(3)
            setPadding(p, p, p, p)
        }
        for (level in 1..5) {
            battery.addView(View(ctx).apply {
                background = ctx.ripple(ctx.rounded(ctx.col(if (level <= store.myEnergy) R.color.her else R.color.her_tint), 4f), 4f)
                contentDescription = ctx.getString(R.string.energy_level, level)
                isSelected = level == store.myEnergy
                setOnClickListener {
                    LiveSync.checkIn(ctx, store.myMood, level)
                    refresh()
                }
            }, LinearLayout.LayoutParams(0, ctx.dp(22), 1f))
        }
        val batteryRow = ctx.row(2)
        batteryRow.addView(battery, LinearLayout.LayoutParams(0, ctx.dp(30), 1f))
        batteryRow.addView(View(ctx).apply { background = ctx.rounded(ctx.col(R.color.line), 2f) }, LinearLayout.LayoutParams(ctx.dp(4), ctx.dp(12)))
        energy.addView(batteryRow, LinearLayout.LayoutParams(0, ctx.dp(44), 1f))
        energy.addView(ctx.text("${store.myEnergy}/5", 15f, 800))
        addView(energy)
    }

    // ---------- Countdowns ----------

    /** Small cards in a sideways row: until we meet, the distance, and the partner's clock. */
    private fun countdowns(): View = HorizontalScrollView(ctx).apply {
        isHorizontalScrollBarEnabled = false
        clipToPadding = false
        val row = ctx.row(12).apply { setPadding(0, ctx.dp(4), ctx.dp(4), ctx.dp(12)) }
        addView(row)
        if (store.apart == true) apartCards(row)
        val today = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
        val upcoming = app.belong.couple.core.CalendarModel.upcoming(
            app.belong.couple.data.SharedRepo(ctx).root(), today, ctx.getString(R.string.calendar_anniversary), ctx.getString(R.string.countdown_title),
        ).filter { it.kind != app.belong.couple.core.Upcoming.Kind.MEETING }.take(3)
        upcoming.forEachIndexed { i, u ->
            row.addView(miniCard(
                R.drawable.ic_calendar, "${u.emoji} ${u.title}",
                if (u.daysLeft > 0) u.daysLeft.toString() else ctx.getString(R.string.countdown_today),
                if (u.daysLeft > 0) ctx.resources.getQuantityString(R.plurals.days_word, u.daysLeft.toInt()) else "",
                listOfNotNull(ctx.formatLongDate(LocalDate.ofEpochDay(u.date)), u.years?.let { ctx.resources.getQuantityString(R.plurals.years, it, it) }).joinToString(" · "),
                if (i == 0 && store.apart != true) ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint)) else null,
            ).apply { setOnClickListener { activity.select(MainActivity.TAB_CALENDAR) } })
        }
        row.addView(ctx.card(paddingDp = 16, spacingDp = 6).apply {
            layoutParams = LinearLayout.LayoutParams(ctx.dp(150), MATCH)
            gravity = Gravity.CENTER
            addView(android.widget.ImageView(ctx).apply { setImageDrawable(ctx.icon(R.drawable.ic_calendar, ctx.col(R.color.ink2), 26)) })
            addView(ctx.text(ctx.getString(if (upcoming.isEmpty()) R.string.calendar_add_first else R.string.calendar_all), 14f, 700).apply { gravity = Gravity.CENTER })
            isClickable = true
            background = ctx.ripple(background, 24f)
            setOnClickListener { activity.select(MainActivity.TAB_CALENDAR) }
        })
    }

    /** For a couple living apart: until we meet, the distance and the partner's clock. */
    private fun apartCards(row: LinearLayout) {
        val days = TimeMath.daysUntil(LocalDate.now(ZoneId.systemDefault()), store.meetingDate)
        row.addView(miniCard(
            R.drawable.ic_heart, ctx.getString(R.string.countdown_title),
            if (days > 0) days.toString() else ctx.getString(if (days == 0L) R.string.countdown_today else R.string.countdown_past),
            if (days > 0) ctx.resources.getQuantityString(R.plurals.days_word, days.toInt()) else "",
            ctx.formatLongDate(store.meetingDate),
            ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint)),
        ).apply {
            contentDescription = ctx.getString(R.string.change_date)
            setOnClickListener { pickMeetingDate() }
        })

        val km = Geo.roundedKm(Geo.distanceKm(store.myCity, store.partnerCity))
        val hours = TimeMath.hoursAhead(store.myCity.zone, store.partnerCity.zone, Instant.now())
        row.addView(miniCard(
            R.drawable.ic_tab_map, ctx.getString(R.string.distance_title),
            NumberFormat.getIntegerInstance(ctx.locale()).format(km), ctx.getString(R.string.km_unit),
            if (hours == 0.0) ctx.getString(R.string.same_zone) else ctx.getString(R.string.hours_apart, TimeMath.formatHours(hours)),
            null,
        ))

        val city = store.partnerCity
        val clock = miniCard(R.drawable.ic_tab_today, ctx.getString(R.string.time_in, city.name(ctx.language())), "", "", store.partnerDisplay, null)
        val big = clock.findViewWithTag<android.widget.TextView>("big")
        clockUpdaters += { big.text = ctx.timeIn(city.zone) }
        row.addView(clock)
    }

    /** Asked once for a new pair: everything about distance and meetings depends on the answer. */
    /** A dated letter from the partner has opened today. */
    private fun letterCard(): View? {
        val repo = SharedRepo(ctx)
        val letter = LettersModel.ready(LettersModel.letters(repo.root(), repo.me), System.currentTimeMillis()) ?: return null
        return ctx.card(paddingDp = 18, spacingDp = 6, background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))).apply {
            addView(ctx.text("💌 " + ctx.getString(R.string.letters_today, store.partnerDisplay), 17f, 700, ctx.col(R.color.on_tint)))
            addView(ctx.text(letter.title, 14f, 500, ctx.col(R.color.on_tint)))
            isClickable = true
            foreground = ctx.ripple(android.graphics.drawable.ColorDrawable(0), 24f)
            setOnClickListener { LettersScreen.read(activity, letter) }
        }
    }

    /** The partner wrote about their feelings and waits for my side. */
    private fun feelingsCard(): View? {
        val repo = SharedRepo(ctx)
        val note = FeelingsModel.waitingForMe(repo.root(), repo.me) ?: return null
        return ctx.card(paddingDp = 18, spacingDp = 6, background = ctx.rounded(ctx.col(R.color.her_tint), 24f)).apply {
            addView(ctx.text("💌 " + ctx.getString(R.string.feelings_today, store.partnerDisplay), 17f, 700, ctx.col(R.color.on_tint)))
            addView(ctx.text(ctx.getString(R.string.feelings_today_text), 14f, 500, ctx.col(R.color.on_tint)))
            isClickable = true
            foreground = ctx.ripple(android.graphics.drawable.ColorDrawable(0), 24f)
            setOnClickListener { FeelingsScreen.write(activity, note) }
        }
    }

    /** In the first week of a month: last month's report is ready, until it's opened. */
    private fun reportCard(): View? {
        val today = java.time.LocalDate.now()
        val month = TimeMath.recapMonth(today)
        if (month == java.time.YearMonth.from(today)) return null
        val prefs = ctx.getSharedPreferences("belong_reports", android.content.Context.MODE_PRIVATE)
        if (prefs.getBoolean("seen_$month", false)) return null
        return ctx.card(paddingDp = 18, spacingDp = 6, background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))).apply {
            addView(ctx.text("✨ " + ctx.getString(R.string.report_ready, StoryRenderer.monthName(ctx, month)), 18f, 700, ctx.col(R.color.on_tint)))
            addView(ctx.text(ctx.getString(R.string.report_ready_text), 14f, 500, ctx.col(R.color.on_tint)))
            isClickable = true
            foreground = ctx.ripple(android.graphics.drawable.ColorDrawable(0), 24f)
            setOnClickListener {
                prefs.edit().putBoolean("seen_$month", true).apply()
                activity.select(MainActivity.TAB_MONTH)
            }
        }
    }

    /** Today's photos from both of you, or an invitation to add one. */
    private fun photoCard(): View = ctx.card(paddingDp = 16, spacingDp = 12).apply {
        val today = DayPhotos.today()
        val photos = PhotosModel.photos(SharedRepo(ctx).root(), SharedRepo(ctx).me).filter { it.day == today }
        val head = ctx.row(8)
        head.addView(ctx.text(ctx.getString(R.string.photos_card_title), 17f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        head.addView(ctx.textButton(ctx.getString(R.string.photos_see_all)) { activity.select(MainActivity.TAB_PHOTOS) })
        addView(head)
        if (photos.isEmpty()) {
            addView(ctx.text(ctx.getString(R.string.photos_today_none), 14f, 500, ctx.col(R.color.ink2)))
        } else {
            addView(PhotosScreen.grid(activity, photos.take(4), 4))
        }
        if (photos.count { it.by == Owner.ME } < PhotosModel.PER_DAY) {
            addView(ctx.secondaryButton(ctx.getString(R.string.photos_add), R.drawable.ic_plus) { PhotosScreen.pick(activity) })
        }
    }

    private fun modeCard(): View = ctx.card(paddingDp = 16, spacingDp = 10).apply {
        addView(ctx.text(ctx.getString(R.string.mode_question), 18f, 700))
        addView(ctx.text(ctx.getString(R.string.mode_text), 14f, 500, ctx.col(R.color.ink2)))
        val buttons = ctx.row(10)
        buttons.addView(ctx.secondaryButton(ctx.getString(R.string.mode_together)) { store.setApart(false) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        buttons.addView(ctx.secondaryButton(ctx.getString(R.string.mode_apart)) { store.setApart(true) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(buttons)
    }

    private fun miniCard(iconRes: Int, title: String, big: String, unit: String, caption: String, background: android.graphics.drawable.Drawable?): LinearLayout =
        ctx.card(paddingDp = 16, spacingDp = 4, background = background).apply {
            layoutParams = LinearLayout.LayoutParams(ctx.dp(200), MATCH)
            if (background != null) elevation = 0f
            val head = ctx.text(title, 13f, 700, ctx.col(R.color.on_tint)).apply {
                setCompoundDrawablesRelative(ctx.icon(iconRes, ctx.col(R.color.on_tint), 14), null, null, null)
                compoundDrawablePadding = ctx.dp(6)
                maxLines = 1
            }
            addView(head)
            val line = ctx.row(6).apply { gravity = Gravity.BOTTOM }
            line.addView(ctx.text(big, if (big.length > 4) 30f else 40f, 800).apply {
                letterSpacing = -0.02f
                tag = "big"
                maxLines = 1
            })
            if (unit.isNotEmpty()) line.addView(ctx.text(unit, 15f, 700).apply { setPadding(0, 0, 0, ctx.dp(7)) })
            addView(line)
            addView(ctx.text(caption, 13f, 500, ctx.col(R.color.on_tint)).apply { maxLines = 2 })
            isClickable = true
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

    // ---------- Plan for today ----------

    private fun planHeader(): View = ctx.row(8).apply {
        addView(ctx.text(ctx.getString(R.string.tasks_title), 22f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        val open = TaskRepo(ctx).forToday().count { it.owner == planFilter && !it.done }
        addView(ctx.text(ctx.resources.getQuantityString(R.plurals.tasks_open, open, open), 13f, 700, ctx.col(R.color.ink2)))
    }

    private fun planCard(): View = ctx.card(paddingDp = 16, spacingDp = 0).apply {
        val repo = TaskRepo(ctx)
        val tasks = repo.forToday().filter { it.owner == planFilter }
        if (tasks.isEmpty()) {
            addView(ctx.text(ctx.getString(R.string.plan_empty), 15f, 500, ctx.col(R.color.ink2)).apply {
                setPadding(0, ctx.dp(6), 0, ctx.dp(6))
            })
        }
        tasks.forEachIndexed { i, task ->
            if (i > 0) addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.sunk)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(1)).apply {
                marginStart = ctx.dp(40)
            })
            addView(taskRow(repo, task))
        }
    }

    private fun ownerColor(owner: Owner): Int? = when (owner) {
        Owner.ME -> ctx.col(R.color.her)
        Owner.PARTNER -> ctx.col(R.color.him)
        Owner.OURS -> null
    }

    private fun taskRow(repo: TaskRepo, task: Task): View = ctx.row(14).apply {
        minimumHeight = ctx.dp(56)
        setPadding(0, ctx.dp(8), 0, ctx.dp(8))
        val color = ownerColor(task.owner)
        addView(TaskRing(ctx, color == null, color ?: 0, task.done), LinearLayout.LayoutParams(ctx.dp(26), ctx.dp(26)))
        val texts = ctx.column(2)
        texts.addView(ctx.text(task.title, 16f, 500, ctx.col(if (task.done) R.color.ink2 else R.color.ink)).apply {
            if (task.done) paintFlags = paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
        })
        if (task.owner == Owner.OURS) texts.addView(ctx.text(ctx.getString(R.string.owner_ours_meta), 13f, 500, ctx.col(R.color.ink2)))
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ctx.ownerDot(color))
        contentDescription = ctx.getString(if (task.done) R.string.task_done_cd else R.string.task_open_cd, task.title)
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 12f), 12f)
        setOnClickListener { v ->
            haptic(v)
            repo.toggle(task.id)
            Widgets.updateAll(ctx)
            refresh()
        }
        setOnLongClickListener {
            android.app.AlertDialog.Builder(activity)
                .setTitle(R.string.task_delete_title)
                .setMessage(task.title)
                .setPositiveButton(R.string.delete) { _, _ ->
                    repo.remove(task.id)
                    Widgets.updateAll(ctx)
                    refresh()
                }
                .setNegativeButton(R.string.settings_cancel, null)
                .show()
            true
        }
    }

    private fun addTaskSheet() {
        var owner = planFilter
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.add_task_title), 22f, 700))
            val input = EditText(ctx).apply {
                hint = ctx.getString(R.string.task_hint)
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                imeOptions = EditorInfo.IME_ACTION_DONE
                filters = arrayOf(InputFilter.LengthFilter(80))
                typeface = Fonts.get(ctx, 500)
                setTextColor(ctx.col(R.color.ink))
                setHintTextColor(ctx.col(R.color.ink2))
                background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
                setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
                minHeight = ctx.dp(52)
            }
            sheet.addView(input)
            sheet.addView(ctx.text(ctx.getString(R.string.add_task_owner), 13f, 700, ctx.col(R.color.ink2)).lp(top = 4))
            val owners = FrameLayout(ctx)
            fun drawOwners() {
                owners.removeAllViews()
                owners.addView(ctx.segmented(
                    listOf(ctx.getString(R.string.owner_me), ctx.getString(R.string.owner_ours), store.partnerDisplay),
                    Owner.entries.indexOf(owner),
                ) {
                    owner = Owner.entries[it]
                    drawOwners()
                })
            }
            drawOwners()
            sheet.addView(owners)
            val add = {
                val text = input.text.toString()
                if (text.isNotBlank()) {
                    TaskRepo(ctx).add(text, owner)
                    planFilter = owner
                    Widgets.updateAll(ctx)
                    dialog.dismiss()
                    refresh()
                }
            }
            input.setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_DONE) {
                    add()
                    true
                } else false
            }
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.task_add)) { add() }.lp(top = 8))
            input.requestFocus()
        }
    }

    // ---------- Taps ----------

    private fun actions(): View = ctx.row(12).apply {
        addView(ctx.primaryButton(ctx.getString(R.string.think), R.drawable.ic_heart) { v ->
            haptic(v)
            tap(LiveModel.THINK, ctx.getString(R.string.think_sent, store.partnerDisplay), Counter.TAPS_SENT)
            if (!paired) DemoPartner.onThinkingSent(ctx)
        }.oneLine(), LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ctx.tintButton(ctx.getString(R.string.safe), R.drawable.ic_shield, ctx.col(R.color.ok_tint), ctx.col(R.color.ok_ink)) { v ->
            haptic(v)
            tap(LiveModel.SAFE, ctx.getString(R.string.safe_sent, store.partnerDisplay), Counter.SAFE)
        }.oneLine(), LinearLayout.LayoutParams(0, WRAP, 1f))
    }

    /** Keeps a half-width button's label on one line, shrinking it a little if a translation is long. */
    private fun android.widget.TextView.oneLine() = apply {
        maxLines = 1
        setPadding(ctx.dp(12), 0, ctx.dp(12), 0)
        compoundDrawablePadding = ctx.dp(6)
        setAutoSizeTextTypeUniformWithConfiguration(11, 15, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
    }

    /** Sends a tap to the partner (or counts it in demo mode) and confirms with a toast. */
    private fun tap(kind: String, sent: String, counter: Counter?) {
        if (!paired) {
            counter?.let { store.increment(it) }
            Toaster.show(activity, sent)
            return
        }
        LiveSync.signal(ctx, kind) { ok ->
            Toaster.show(activity, if (ok) sent else ctx.getString(R.string.pair_error_network))
        }
    }

    private fun widgetsCard(): View = ctx.card().apply {
        addView(ctx.text(ctx.getString(R.string.widgets_title), 17f, 700))
        addView(ctx.text(ctx.getString(R.string.widgets_text), 14f, 400, ctx.col(R.color.ink2)))
        listOf(
            R.string.add_widget_mood to MoodWidget::class.java,
            R.string.add_widget_countdown to CountdownWidget::class.java,
            R.string.add_widget_doodle to DoodleWidget::class.java,
            R.string.add_widget_tasks to TasksWidget::class.java,
        ).chunked(2).forEach { pair ->
            val line = ctx.row(8)
            pair.forEach { (label, cls) ->
                line.addView(ctx.chip("+ ${ctx.getString(label)}", false) {
                    if (!Widgets.requestPin(ctx, cls)) Toaster.show(activity, ctx.getString(R.string.widget_pin_unsupported))
                }.apply { minHeight = ctx.dp(44) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            }
            addView(line)
        }
    }
}
