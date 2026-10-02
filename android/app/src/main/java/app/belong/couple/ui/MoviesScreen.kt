package app.belong.couple.ui

import android.app.AlertDialog
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.Movie
import app.belong.couple.core.MoviesModel
import app.belong.couple.core.Owner
import app.belong.couple.core.seatKey
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.SharedRepo

/**
 * Films and series to watch together. Either of you adds a title; once you've watched it, each gives
 * their own stars. Your partner's stars show after you've given yours, so you don't just agree.
 */
class MoviesScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private var tab = 0
    private var picked: String? = null
    private val random = java.util.Random()
    private val body = ctx.column(12).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(8), side, ctx.dp(104))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = FrameLayout(ctx).apply {
        addView(scroll, FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.fab(ctx.getString(R.string.movies_add)) { add() },
            FrameLayout.LayoutParams(ctx.dp(56), ctx.dp(56), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, ctx.dp(20), ctx.dp(20)) })
    }

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val all = MoviesModel.movies(repo.root(), repo.me)
        val toWatch = MoviesModel.toWatch(all)
        val watched = MoviesModel.watched(all)
        body.addView(ctx.text(ctx.getString(R.string.movies_title), 28f, 700))
        body.addView(ctx.text(ctx.getString(R.string.movies_counts, toWatch.size, watched.size), 15f, 500, ctx.col(R.color.ink2)))
        if (toWatch.isNotEmpty()) body.addView(pickCard(all).lp(top = 8))
        body.addView(ctx.segmented(listOf(ctx.getString(R.string.movies_to_watch), ctx.getString(R.string.movies_watched)), tab) {
            tab = it
            refresh()
        }.lp(top = 8))
        val list = if (tab == 0) toWatch else watched
        if (list.isEmpty()) body.addView(ctx.text(ctx.getString(if (tab == 0) R.string.movies_empty else R.string.movies_watched_empty), 15f, 500, ctx.col(R.color.ink2)).lp(top = 8))
        val card = ctx.card(paddingDp = 16, spacingDp = 0)
        list.forEachIndexed { i, m ->
            if (i > 0) card.addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.sunk)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(1)))
            card.addView(row(m))
        }
        if (list.isNotEmpty()) body.addView(card)
        scroll.post { scroll.scrollTo(0, y) }
    }

    /** "What shall we watch tonight?": a random title from the list, and another if you don't fancy it. */
    private fun pickCard(all: List<Movie>): View = ctx.card(paddingDp = 16, spacingDp = 8, background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))).apply {
        addView(ctx.text(ctx.getString(R.string.movies_tonight), 17f, 700, ctx.col(R.color.on_tint)))
        val chosen = all.firstOrNull { it.key == picked && !it.watched }
        if (chosen != null) addView(ctx.text("${if (chosen.series) "📺" else "🎬"} ${chosen.title}", 22f, 800))
        addView(ctx.tintButton(ctx.getString(if (chosen == null) R.string.movies_pick else R.string.movies_pick_again), null, ctx.col(R.color.surface), ctx.col(R.color.ink)) { v ->
            haptic(v)
            picked = MoviesModel.pick(all, null, random, picked)?.key
            refresh()
        })
    }

    private fun row(m: Movie): View = ctx.row(14).apply {
        minimumHeight = ctx.dp(64)
        setPadding(0, ctx.dp(8), 0, ctx.dp(8))
        addView(ctx.text(if (m.series) "📺" else "🎬", 22f).apply {
            gravity = Gravity.CENTER
            background = ctx.rounded(ctx.col(if (m.by == Owner.ME) R.color.her_tint else R.color.him_tint), 14f)
        }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        val texts = ctx.column(2)
        texts.addView(ctx.text(m.title, 16f, 700))
        val kind = ctx.getString(if (m.series) R.string.movies_series else R.string.movies_movie)
        if (!m.watched) {
            texts.addView(ctx.text("$kind · ${ctx.getString(R.string.movies_idea_of, if (m.by == Owner.ME) store.myName else store.partnerDisplay)}", 13f, 500, ctx.col(R.color.ink2)))
        } else {
            texts.addView(ctx.text("${store.myName} ${stars(m.myRating)}", 13f, 600, ctx.col(R.color.her)))
            texts.addView(ctx.text(
                if (m.myRating == null) ctx.getString(R.string.movies_rate_to_see, store.partnerDisplay) else "${store.partnerDisplay} ${stars(m.partnerRating)}",
                13f, 600, ctx.col(if (m.myRating == null) R.color.ink2 else R.color.him),
            ))
        }
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        MoviesModel.together(m)?.let { avg ->
            addView(ctx.text(String.format(ctx.locale(), "%.1f", avg), 18f, 800).apply {
                gravity = Gravity.CENTER
                background = ctx.rounded(ctx.col(R.color.honey_tint), 12f)
                setPadding(ctx.dp(10), ctx.dp(4), ctx.dp(10), ctx.dp(4))
            })
        }
        isClickable = true
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 12f), 12f)
        setOnClickListener { if (m.watched) rate(m) else watchedSheet(m) }
        setOnLongClickListener {
            AlertDialog.Builder(activity).setTitle(R.string.movies_delete).setMessage(m.title)
                .setPositiveButton(R.string.delete) { _, _ -> repo.delete("movies/${m.key}") }
                .setNegativeButton(R.string.settings_cancel, null).show()
            true
        }
    }

    private fun stars(n: Int?): String = if (n == null) "—" else "★".repeat(n) + "☆".repeat(5 - n)

    private fun add() {
        var series = false
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.movies_add), 22f, 700))
            val title = android.widget.EditText(ctx).apply {
                hint = ctx.getString(R.string.movies_field_title)
                inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                filters = arrayOf(android.text.InputFilter.LengthFilter(100))
                typeface = Fonts.get(ctx, 500)
                setTextColor(ctx.col(R.color.ink))
                setHintTextColor(ctx.col(R.color.ink2))
                background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
                setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
                minHeight = ctx.dp(52)
            }
            sheet.addView(title)
            val kind = FrameLayout(ctx)
            fun drawKind() {
                kind.removeAllViews()
                kind.addView(ctx.segmented(listOf("🎬 " + ctx.getString(R.string.movies_movie), "📺 " + ctx.getString(R.string.movies_series)), if (series) 1 else 0) {
                    series = it == 1
                    drawKind()
                })
            }
            drawKind()
            sheet.addView(kind)
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.settings_save)) {
                val t = title.text.toString().trim()
                if (t.isEmpty()) {
                    title.error = ctx.getString(R.string.wish_title_required)
                    return@primaryButton
                }
                repo.put("movies/${DreamsScreen.newKey()}", MoviesModel.json(t, series, seatKey(repo.me, mine = true), System.currentTimeMillis()))
                tab = 0
                dialog.dismiss()
            }.lp(top = 8))
            title.requestFocus()
        }
    }

    /** "We watched it": moves it to the watched list and asks for my stars. */
    private fun watchedSheet(m: Movie) {
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(m.title, 22f, 700))
            sheet.addView(ctx.text(ctx.getString(R.string.movies_watched_question), 15f, 500, ctx.col(R.color.ink2)))
            sheet.addView(starsRow { n ->
                repo.put("movies/${m.key}/watched", true)
                repo.put("movies/${m.key}/watchedAt", System.currentTimeMillis())
                repo.put("movies/${m.key}/rate/${seatKey(repo.me, mine = true)}", n)
                tab = 1
                dialog.dismiss()
                Toaster.show(activity, ctx.getString(R.string.movies_rated))
            })
        }
    }

    private fun rate(m: Movie) {
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(m.title, 22f, 700))
            sheet.addView(ctx.text(ctx.getString(R.string.movies_your_rating), 15f, 500, ctx.col(R.color.ink2)))
            sheet.addView(starsRow(m.myRating) { n ->
                repo.put("movies/${m.key}/rate/${seatKey(repo.me, mine = true)}", n)
                dialog.dismiss()
            })
            sheet.addView(ctx.textButton(ctx.getString(R.string.movies_not_watched)) {
                repo.put("movies/${m.key}/watched", false)
                dialog.dismiss()
            })
        }
    }

    private fun starsRow(current: Int? = null, onPick: (Int) -> Unit): View = ctx.row(6).apply {
        gravity = Gravity.CENTER
        for (n in 1..5) {
            addView(ctx.text(if (current != null && n <= current) "★" else "☆", 34f, 500, ctx.col(R.color.honey)).apply {
                gravity = Gravity.CENTER
                contentDescription = ctx.resources.getQuantityString(R.plurals.movies_stars, n, n)
                background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 24f), 24f)
                setOnClickListener { v ->
                    haptic(v)
                    onPick(n)
                }
            }, LinearLayout.LayoutParams(ctx.dp(56), ctx.dp(56)))
        }
    }
}
