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
import app.belong.couple.core.HomeLayout
import app.belong.couple.core.LoveNote
import app.belong.couple.core.Geo
import app.belong.couple.core.Owner
import app.belong.couple.core.PartOfDay
import app.belong.couple.core.PhotosModel
import app.belong.couple.core.Recap
import app.belong.couple.core.Task
import app.belong.couple.core.TimeMath
import app.belong.couple.core.TodayModel
import app.belong.couple.core.TogetherModel
import app.belong.couple.core.seatKey
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

    /** The card order and hidden cards on this phone (see [HomeLayout]). */
    private val home = ctx.getSharedPreferences("belong_home", android.content.Context.MODE_PRIVATE)
    private var checkInOpen = false
    private var planOpen = false

    private fun layout(): List<String> = HomeLayout.order(home.getString("order", "").orEmpty().split(',').filter { it.isNotEmpty() })
    /** Hidden cards; until the person changes anything, the widgets card is off (it's in Us → Widgets too). */
    private fun hidden(): Set<String> = home.getStringSet("hidden", null) ?: HomeLayout.HIDDEN_BY_DEFAULT

    override fun refresh() {
        val scrollY = scroll.scrollY
        body.removeAllViews()
        clockUpdaters.clear()
        body.addView(header())
        // Letters, feelings notes, the month report and the like wait behind the bell in the header.
        val off = hidden()
        for (id in layout()) {
            if (id in off) continue
            card(id)?.let { body.addView(it.lp(top = if (id == HomeLayout.CHECKIN) 12 else 24)) }
        }
        body.addView(ctx.textButton("✏️ " + ctx.getString(R.string.home_customize)) { customize() }.apply { gravity = Gravity.CENTER }.lp(top = 24))
        clockUpdaters.forEach { it() }
        scroll.post { scroll.scrollTo(0, scrollY) }
    }

    private fun card(id: String): View? = when (id) {
        HomeLayout.COVER -> coverCard()
        HomeLayout.PARTNER -> partnerCard()
        HomeLayout.CHECKIN -> checkInCard()
        HomeLayout.NOTE -> noteCard()
        HomeLayout.DATES -> countdowns()
        HomeLayout.ON_THIS_DAY -> onThisDayCard()
        HomeLayout.PHOTO -> photoCard()
        HomeLayout.PLAN -> ctx.column().apply {
            addView(planHeader())
            addView(ctx.segmented(
                listOf(ctx.getString(R.string.owner_me), ctx.getString(R.string.owner_ours), store.partnerDisplay),
                Owner.entries.indexOf(planFilter),
            ) {
                planFilter = Owner.entries[it]
                refresh()
            }.lp(top = 12))
            addView(planCard().lp(top = 12))
        }
        HomeLayout.EVENING -> everyday.eveningCard()
        HomeLayout.QUESTION -> everyday.questionCompact()
        HomeLayout.WIDGETS -> if (Widgets.anyPlaced(ctx)) null else widgetsCard()
        else -> null
    }

    private fun cardName(id: String): String = ctx.getString(when (id) {
        HomeLayout.COVER -> R.string.home_card_cover
        HomeLayout.PARTNER -> R.string.home_card_partner
        HomeLayout.CHECKIN -> R.string.home_card_checkin
        HomeLayout.NOTE -> R.string.home_card_note
        HomeLayout.DATES -> R.string.home_card_dates
        HomeLayout.ON_THIS_DAY -> R.string.home_card_onthisday
        HomeLayout.PHOTO -> R.string.photos_card_title
        HomeLayout.PLAN -> R.string.tasks_title
        HomeLayout.EVENING -> R.string.home_card_evening
        HomeLayout.QUESTION -> R.string.home_card_question
        else -> R.string.widgets_title
    })

    /** "Customise Today": each card with a switch and arrows to move it; saved on this phone. */
    private fun customize() {
        val dialog = android.app.Dialog(activity, R.style.Theme_Belong)
        val col = ctx.column(10).apply { setPadding(ctx.dp(20), ctx.dp(12), ctx.dp(20), ctx.dp(28)) }
        val list = ctx.column(8)
        fun draw() {
            list.removeAllViews()
            val order = layout()
            val off = hidden()
            order.forEachIndexed { i, id ->
                list.addView(ctx.card(paddingDp = 10, spacingDp = 0).apply {
                    val r = ctx.row(6)
                    val check = android.widget.CheckBox(ctx).apply {
                        isChecked = id !in off
                        text = cardName(id)
                        textSize = 16f
                        typeface = Fonts.get(ctx, 600)
                        setTextColor(ctx.col(R.color.ink))
                        buttonTintList = android.content.res.ColorStateList.valueOf(ctx.col(R.color.her))
                        setOnCheckedChangeListener { _, on ->
                            home.edit().putStringSet("hidden", if (on) hidden() - id else hidden() + id).apply()
                        }
                    }
                    r.addView(check, LinearLayout.LayoutParams(0, WRAP, 1f))
                    fun arrow(label: Int, by: Int, enabled: Boolean) = android.widget.ImageView(ctx).apply {
                        setImageDrawable(ctx.icon(R.drawable.ic_chevron, ctx.col(R.color.ink), 18))
                        rotation = if (by < 0) -90f else 90f
                        scaleType = android.widget.ImageView.ScaleType.CENTER
                        contentDescription = ctx.getString(label, cardName(id))
                        background = ctx.ripple(ctx.rounded(ctx.col(R.color.bg), 20f), 20f)
                        isEnabled = enabled
                        alpha = if (enabled) 1f else 0.25f
                        setOnClickListener {
                            home.edit().putString("order", HomeLayout.move(layout(), id, by).joinToString(",")).apply()
                            draw()
                        }
                    }
                    r.addView(arrow(R.string.home_move_up, -1, i > 0), LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
                    r.addView(arrow(R.string.home_move_down, 1, i < order.lastIndex), LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
                    addView(r)
                })
            }
        }
        val top = ctx.row(8)
        top.addView(ctx.text(ctx.getString(R.string.home_customize), 24f, 700), LinearLayout.LayoutParams(0, WRAP, 1f))
        top.addView(android.widget.ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_close, ctx.col(R.color.ink), 22))
            scaleType = android.widget.ImageView.ScaleType.CENTER
            contentDescription = ctx.getString(R.string.pair_close)
            background = ctx.ripple(ctx.rounded(ctx.col(R.color.bg), 22f), 22f)
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        col.addView(top)
        col.addView(ctx.text(ctx.getString(R.string.home_customize_text), 14f, 500, ctx.col(R.color.ink2)))
        draw()
        col.addView(list)
        col.addView(ctx.textButton(ctx.getString(R.string.home_reset)) {
            home.edit().clear().apply()
            draw()
        })
        dialog.setContentView(ScrollView(ctx).apply {
            setBackgroundColor(ctx.col(R.color.bg))
            addView(col)
        })
        dialog.window?.setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.setOnDismissListener { refresh() }
        dialog.show()
    }

    // ---------- Cover, note and "on this day" ----------

    /** The couple's photo with your names and how long you've been together; tap to change it. */
    private fun coverCard(): View {
        val repo = SharedRepo(ctx)
        val root = repo.root()
        val cover = TodayModel.cover(root)
        val since = TogetherModel.since(root)
        val today = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
        val line = if (since != null) {
            val days = (today - since).toInt()
            ctx.getString(R.string.home_together, ctx.resources.getQuantityString(R.plurals.days, days, days))
        } else ctx.getString(R.string.couple_line, store.myName, store.partnerDisplay)
        val frame = FrameLayout(ctx).apply {
            background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
            outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(view: View, outline: android.graphics.Outline) = outline.setRoundRect(0, 0, view.width, view.height, ctx.dp(24).toFloat())
            }
            clipToOutline = true
        }
        if (cover != null) {
            frame.addView(android.widget.ImageView(ctx).apply {
                scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                DayPhotos.load(this, cover, thumb = false)
            }, FrameLayout.LayoutParams(MATCH, ctx.dp(210)))
            frame.addView(View(ctx).apply {
                background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0x99000000.toInt(), 0))
            }, FrameLayout.LayoutParams(MATCH, ctx.dp(110), Gravity.BOTTOM))
            frame.addView(ctx.column(2).apply {
                setPadding(ctx.dp(18), 0, ctx.dp(18), ctx.dp(16))
                addView(ctx.text(ctx.getString(R.string.couple_line, store.myName, store.partnerDisplay), 20f, 800, ctx.col(R.color.white)))
                if (since != null) addView(ctx.text(line, 14f, 600, 0xE6FFFFFF.toInt()))
            }, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM))
        } else {
            frame.addView(ctx.column(6).apply {
                setPadding(ctx.dp(18), ctx.dp(18), ctx.dp(18), ctx.dp(18))
                addView(ctx.text(line, 20f, 800, ctx.col(R.color.on_tint)))
                addView(ctx.text(ctx.getString(R.string.home_cover_add), 14f, 600, ctx.col(R.color.on_tint)))
            }, FrameLayout.LayoutParams(MATCH, WRAP))
        }
        frame.contentDescription = ctx.getString(R.string.home_cover_change)
        frame.isClickable = true
        frame.foreground = ctx.ripple(android.graphics.drawable.ColorDrawable(0), 24f)
        frame.setOnClickListener { pickCover(cover != null) }
        return frame
    }

    private fun pickCover(hasCover: Boolean) {
        val pick = {
            val intent = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).apply {
                type = "image/*"
                addCategory(android.content.Intent.CATEGORY_OPENABLE)
            }
            try {
                @Suppress("DEPRECATION")
                activity.startActivityForResult(android.content.Intent.createChooser(intent, ctx.getString(R.string.home_cover_change)), MainActivity.REQUEST_COVER)
            } catch (e: android.content.ActivityNotFoundException) {
                Toaster.show(activity, ctx.getString(R.string.photos_no_gallery))
            }
        }
        if (!hasCover) return pick()
        android.app.AlertDialog.Builder(activity)
            .setItems(arrayOf(ctx.getString(R.string.home_cover_change), ctx.getString(R.string.home_cover_remove))) { _, which ->
                if (which == 0) pick() else SharedRepo(ctx).delete("couple/cover")
            }
            .show()
    }

    /** Called by MainActivity with the picked cover photo. */
    fun onCoverPicked(data: android.content.Intent?) {
        val uri = data?.data ?: return
        DayPhotos.setCover(ctx, uri) { ok -> if (!ok) Toaster.show(activity, ctx.getString(R.string.photos_failed)) }
    }

    /** The partner's note for me, and leaving or changing mine for them. */
    private fun noteCard(): View {
        val repo = SharedRepo(ctx)
        val root = repo.root()
        val theirs = TodayModel.note(root, seatKey(repo.me, mine = false))
        val mine = TodayModel.note(root, seatKey(repo.me, mine = true))
        return ctx.card(paddingDp = 16, spacingDp = 8, background = if (theirs != null) ctx.rounded(ctx.col(R.color.him_tint), 24f) else null).apply {
            if (theirs != null) {
                addView(ctx.text("💌 " + ctx.getString(R.string.note_from, store.partnerDisplay), 13f, 700, ctx.col(R.color.on_tint)))
                addView(ctx.text(theirs.text, 18f, 600))
            } else {
                addView(ctx.text(ctx.getString(R.string.note_none, store.partnerDisplay), 14f, 500, ctx.col(R.color.ink2)))
            }
            addView(ctx.textButton(
                if (mine == null) "+ " + ctx.getString(R.string.note_leave, store.partnerDisplay) else ctx.getString(R.string.note_yours, mine.text),
            ) { writeNote(mine) }.apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
        }
    }

    private fun writeNote(current: LoveNote?) {
        val repo = SharedRepo(ctx)
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.note_leave, store.partnerDisplay), 22f, 700))
            sheet.addView(ctx.text(ctx.getString(R.string.note_hint, store.partnerDisplay), 14f, 500, ctx.col(R.color.ink2)))
            val input = EditText(ctx).apply {
                setText(current?.text.orEmpty())
                hint = ctx.getString(R.string.note_placeholder)
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                filters = arrayOf(InputFilter.LengthFilter(200))
                typeface = Fonts.get(ctx, 500)
                setTextColor(ctx.col(R.color.ink))
                setHintTextColor(ctx.col(R.color.ink2))
                background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
                setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
                minLines = 2
            }
            sheet.addView(input)
            val chips = ctx.row(8)
            listOf(R.string.note_idea_1, R.string.note_idea_2, R.string.note_idea_3).forEach { res ->
                chips.addView(ctx.chip(ctx.getString(res), false) { input.setText(ctx.getString(res)) })
            }
            sheet.addView(HorizontalScrollView(ctx).apply {
                isHorizontalScrollBarEnabled = false
                addView(chips)
            })
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.note_save)) {
                val t = input.text.toString().trim()
                if (t.isEmpty()) repo.delete("note/${seatKey(repo.me, mine = true)}")
                else repo.put("note/${seatKey(repo.me, mine = true)}", org.json.JSONObject().put("text", t).put("at", System.currentTimeMillis()))
                dialog.dismiss()
                if (t.isNotEmpty()) Toaster.show(activity, ctx.getString(R.string.note_sent, store.partnerDisplay))
            }.lp(top = 8))
            input.requestFocus()
        }
    }

    /** Photos and memories from this date a year (or more) ago. */
    private fun onThisDayCard(): View? {
        val repo = SharedRepo(ctx)
        val today = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
        val day = TodayModel.onThisDay(repo.root(), repo.me, today) ?: return null
        return ctx.card(paddingDp = 16, spacingDp = 10, background = ctx.rounded(ctx.col(R.color.honey_tint), 24f)).apply {
            addView(ctx.text("🕰 " + ctx.resources.getQuantityString(R.plurals.home_years_ago, day.years, day.years), 17f, 700, ctx.col(R.color.honey_ink)))
            day.moments.forEach { m ->
                addView(ctx.text(m.title, 16f, 700))
                if (m.text.isNotBlank()) addView(ctx.text(m.text, 14f, 500, ctx.col(R.color.ink2)))
            }
            if (day.photos.isNotEmpty()) addView(PhotosScreen.grid(activity, day.photos.take(4), 4))
        }
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
        texts.addView(ctx.text(ctx.getString(greeting, store.myName), 26f, 700).apply {
            letterSpacing = -0.01f
            maxLines = 1
            setAutoSizeTextTypeUniformWithConfiguration(18, 26, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
        }, LinearLayout.LayoutParams(MATCH, ctx.dp(36)))
        texts.addView(ctx.text(ctx.formatDayHeader(LocalDate.now()), 15f, 500, ctx.col(R.color.ink2)))
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(bell(), LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        addView(PairMark(ctx).apply {
            initials = initial(store.myName) to initial(store.partnerDisplay)
            contentDescription = ctx.getString(R.string.settings)
            setOnClickListener { SettingsDialog.show(activity) }
        }, LinearLayout.LayoutParams(WRAP, ctx.dp(44)))
    }

    private fun initial(name: String) = name.trim().take(1).uppercase(ctx.locale())

    /** The bell: opens notifications, with a dot and the number of new ones. */
    private fun bell(): View = FrameLayout(ctx).apply {
        val count = InboxScreen.unseen(activity)
        addView(android.widget.ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_bell, ctx.col(R.color.ink), 22))
            scaleType = android.widget.ImageView.ScaleType.CENTER
            background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 22f), 22f)
        }, FrameLayout.LayoutParams(MATCH, MATCH))
        if (count > 0) addView(ctx.text(if (count > 9) "9+" else count.toString(), 10f, 800, ctx.col(R.color.white)).apply {
            gravity = Gravity.CENTER
            background = ctx.gradient(999f, ctx.col(R.color.us_start), ctx.col(R.color.us_end))
            setPadding(ctx.dp(4), 0, ctx.dp(4), 0)
            minWidth = ctx.dp(18)
        }, FrameLayout.LayoutParams(WRAP, ctx.dp(18), Gravity.TOP or Gravity.END))
        contentDescription = if (count > 0) ctx.resources.getQuantityString(R.plurals.inbox_new, count, count) else ctx.getString(R.string.inbox_title)
        isClickable = true
        setOnClickListener { activity.select(MainActivity.TAB_INBOX) }
    }

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
        // Everything you can send lives here, next to the person it goes to.
        addView(actions())
    }

    private fun checkInCard(): View {
        if (!store.checkedInToday() || checkInOpen) return fullCheckIn()
        // Already checked in today: one line, tap to change.
        return ctx.card(paddingDp = 16, spacingDp = 0).apply {
            val r = ctx.row(12)
            r.addView(ctx.text(Recap.emojiFor(store.myMood), 26f))
            r.addView(ctx.text(ctx.getString(R.string.checkin_done, store.myEnergy), 15f, 600), LinearLayout.LayoutParams(0, WRAP, 1f))
            r.addView(ctx.text(ctx.getString(R.string.checkin_change), 14f, 700, ctx.col(R.color.him)))
            addView(r)
            isClickable = true
            background = ctx.ripple(background, 24f)
            setOnClickListener {
                checkInOpen = true
                refresh()
            }
        }
    }

    private fun fullCheckIn(): View = ctx.card(paddingDp = 16, spacingDp = 14).apply {
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
                    checkInOpen = true
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
                    checkInOpen = false
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
        // Open tasks come first; past three, the rest wait behind "N more".
        val shown = if (planOpen) tasks else tasks.take(PLAN_PREVIEW)
        shown.forEachIndexed { i, task ->
            if (i > 0) addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.sunk)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(1)).apply {
                marginStart = ctx.dp(40)
            })
            addView(taskRow(repo, task))
        }
        if (tasks.size > PLAN_PREVIEW) addView(ctx.textButton(
            if (planOpen) ctx.getString(R.string.home_less) else ctx.getString(R.string.home_more, tasks.size - PLAN_PREVIEW),
        ) {
            planOpen = !planOpen
            refresh()
        })
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

    /** One big "Thinking of you", and the other taps behind the ⋯ button (or a long press). */
    private fun actions(): View = ctx.row(10).apply {
        addView(ctx.primaryButton(ctx.getString(R.string.think), R.drawable.ic_heart) { v ->
            haptic(v)
            tap(LiveModel.THINK, ctx.getString(R.string.think_sent, store.partnerDisplay), Counter.TAPS_SENT)
            if (!paired) DemoPartner.onThinkingSent(ctx)
        }.oneLine().apply {
            setOnLongClickListener {
                moreTaps()
                true
            }
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ctx.tintButton("⋯", null, ctx.col(R.color.him_tint), ctx.col(R.color.ink)) { moreTaps() }.apply {
            contentDescription = ctx.getString(R.string.home_more_taps)
            setPadding(0, 0, 0, 0)
        }, LinearLayout.LayoutParams(ctx.dp(56), WRAP))
    }

    private fun moreTaps() {
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.home_more_taps), 20f, 700))
            fun option(emoji: String, title: String, text: String, onClick: () -> Unit) = ctx.card(paddingDp = 14, spacingDp = 2).apply {
                val r = ctx.row(12)
                r.addView(ctx.text(emoji, 24f))
                val t = ctx.column(2)
                t.addView(ctx.text(title, 16f, 700))
                t.addView(ctx.text(text, 13f, 500, ctx.col(R.color.ink2)))
                r.addView(t, LinearLayout.LayoutParams(0, WRAP, 1f))
                addView(r)
                isClickable = true
                background = ctx.ripple(background, 24f)
                setOnClickListener { v ->
                    haptic(v)
                    dialog.dismiss()
                    onClick()
                }
            }
            sheet.addView(option("🤗", ctx.getString(R.string.support), ctx.getString(R.string.home_support_text, store.partnerDisplay)) {
                tap(LiveModel.SUPPORT, ctx.getString(R.string.support_sent, store.partnerDisplay), null)
            })
            sheet.addView(option("🛡", ctx.getString(R.string.safe), ctx.getString(R.string.home_safe_text, store.partnerDisplay)) {
                tap(LiveModel.SAFE, ctx.getString(R.string.safe_sent, store.partnerDisplay), Counter.SAFE)
            })
        }
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

    companion object {
        private const val PLAN_PREVIEW = 3
    }
}
