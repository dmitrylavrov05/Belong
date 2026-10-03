package app.belong.couple.ui

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.CalendarModel
import app.belong.couple.core.FeelingsModel
import app.belong.couple.core.LettersModel
import app.belong.couple.core.Owner
import app.belong.couple.core.PhotosModel
import app.belong.couple.core.TimeMath
import app.belong.couple.core.TodayModel
import app.belong.couple.core.Upcoming
import app.belong.couple.core.seatKey
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId

/**
 * Notifications, so Today can stay calm: a letter that has opened, a feelings note waiting for
 * your side, the month report, a new note or photos from your partner, dates coming up and, once,
 * whether you live together or apart. The bell on Today shows how many are new.
 */
class InboxScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val body = ctx.column(12).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(8), side, ctx.dp(28))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = scroll

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        body.removeAllViews()
        body.addView(ctx.text(ctx.getString(R.string.inbox_title), 28f, 700))
        val list = items(activity)
        val seen = seen(ctx)
        if (list.isEmpty()) {
            body.addView(ctx.column(8).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(0, ctx.dp(48), 0, 0)
                addView(ctx.text("🌿", 44f))
                addView(ctx.text(ctx.getString(R.string.inbox_empty), 16f, 600, ctx.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
            })
        }
        list.forEach { body.addView(row(it, it.key !in seen)) }
        markSeen(ctx, list)
    }

    private fun row(item: Item, new: Boolean): View = ctx.card(paddingDp = 16, spacingDp = 8, background = if (new) ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint)) else null).apply {
        val r = ctx.row(14).apply { gravity = Gravity.TOP }
        r.addView(ctx.text(item.emoji, 24f).apply {
            gravity = Gravity.CENTER
            background = ctx.rounded(ctx.col(R.color.surface), 16f)
        }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
        val texts = ctx.column(2)
        texts.addView(ctx.text(item.title, 16f, 700, ctx.col(if (new) R.color.on_tint else R.color.ink)))
        if (item.text.isNotEmpty()) texts.addView(ctx.text(item.text, 14f, 500, ctx.col(if (new) R.color.on_tint else R.color.ink2)))
        r.addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        if (new) r.addView(View(ctx).apply { background = ctx.rounded(ctx.col(R.color.her), 5f) }, LinearLayout.LayoutParams(ctx.dp(10), ctx.dp(10)).apply { topMargin = ctx.dp(6) })
        addView(r)
        if (item.buttons.isNotEmpty()) {
            val b = ctx.row(10)
            item.buttons.forEach { (label, action) -> b.addView(ctx.secondaryButton(label) { action() }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)) }
            addView(b)
        }
        item.open?.let { open ->
            isClickable = true
            foreground = ctx.ripple(android.graphics.drawable.ColorDrawable(0), 24f)
            setOnClickListener { open() }
        }
    }

    /** One notification. [key] identifies it for "seen"; a new key (e.g. a newer note) shows as new again. */
    data class Item(
        val key: String,
        val emoji: String,
        val title: String,
        val text: String,
        val open: (() -> Unit)? = null,
        val buttons: List<Pair<String, () -> Unit>> = emptyList(),
    )

    companion object {
        private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("belong_inbox", Context.MODE_PRIVATE)

        fun seen(context: Context): Set<String> = prefs(context).getStringSet("seen", emptySet())!!

        /** Everything listed now counts as seen; keys no longer listed are forgotten. */
        private fun markSeen(context: Context, items: List<Item>) {
            prefs(context).edit().putStringSet("seen", items.map { it.key }.toSet()).apply()
        }

        /** How many notifications are new: the number on the bell. */
        fun unseen(activity: MainActivity): Int {
            val seen = seen(activity)
            return items(activity).count { it.key !in seen }
        }

        fun items(a: MainActivity): List<Item> {
            val store = CoupleStore.get(a)
            val repo = SharedRepo(a)
            val root = repo.root()
            val me = repo.me
            val now = System.currentTimeMillis()
            val today = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
            val partner = store.partnerDisplay
            val list = mutableListOf<Item>()

            if (store.apart == null) list += Item(
                "mode", "🏡", a.getString(R.string.mode_question), a.getString(R.string.mode_text),
                buttons = listOf(a.getString(R.string.mode_together) to { store.setApart(false) }, a.getString(R.string.mode_apart) to { store.setApart(true) }),
            )
            FeelingsModel.waitingForMe(root, me)?.let { n ->
                list += Item("feel-${n.key}", "🫶", a.getString(R.string.feelings_today, partner), a.getString(R.string.feelings_today_text), open = { FeelingsScreen.write(a, n) })
            }
            LettersModel.letters(root, me).filter { it.by == Owner.PARTNER && it.canOpen(now) && !it.opened && it.kind == app.belong.couple.core.Letter.Kind.DATE }.forEach { l ->
                list += Item("letter-${l.key}", "💌", a.getString(R.string.letters_today, partner), l.title, open = { LettersScreen.read(a, l) })
            }
            TodayModel.note(root, seatKey(me, mine = false))?.let { n ->
                list += Item("note-${n.at}", "📝", a.getString(R.string.inbox_note, partner), n.text, open = { a.select(MainActivity.TAB_TODAY) })
            }
            val theirPhotos = PhotosModel.photos(root, me).count { it.day == today && it.by == Owner.PARTNER }
            if (theirPhotos > 0) list += Item("photos-$today-$theirPhotos", "📸", a.getString(R.string.inbox_photos, partner),
                a.resources.getQuantityString(R.plurals.report_photos, theirPhotos, theirPhotos), open = { a.select(MainActivity.TAB_PHOTOS) })
            val month = TimeMath.recapMonth(LocalDate.now())
            if (month != YearMonth.from(LocalDate.now())) list += Item("report-$month", "✨",
                a.getString(R.string.report_ready, StoryRenderer.monthName(a, month)), a.getString(R.string.report_ready_text), open = { a.select(MainActivity.TAB_MONTH) })
            CalendarModel.upcoming(root, today, a.getString(R.string.calendar_anniversary), a.getString(R.string.countdown_title))
                .filter { it.daysLeft in 0..3 }
                .forEach { u ->
                    val whenText = if (u.daysLeft == 0L) a.getString(R.string.countdown_today) else a.resources.getQuantityString(R.plurals.letters_in_days, u.daysLeft.toInt(), u.daysLeft.toInt())
                    list += Item("date-${u.kind}-${u.key}-${u.date}", if (u.kind == Upcoming.Kind.MEETING) "✈️" else u.emoji, u.title,
                        whenText.replaceFirstChar { it.titlecase(a.locale()) }, open = { a.select(MainActivity.TAB_CALENDAR) })
                }
            return list
        }
    }
}
