package app.belong.couple.ui

import android.app.AlertDialog
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.Movie
import app.belong.couple.core.MoviesModel
import app.belong.couple.core.Owner
import app.belong.couple.core.Suggestion
import app.belong.couple.core.Title
import app.belong.couple.core.seatKey
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.SharedRepo
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.MovieSuggestions
import app.belong.couple.sync.Tmdb
import java.util.concurrent.Executors

/**
 * Films and series to watch together. Either of you adds a title (found in TMDB or typed in); once
 * you've watched it, each gives their own stars, and your partner's stars show after you've given
 * yours. The catalog suggests what you'd both enjoy, from your stars.
 */
class MoviesScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private val tmdb = Tmdb.forApp(ctx)
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

    // ---------- Catalog state: kept across refreshes so typing and results survive data changes ----------

    private sealed class Shelf {
        object ForYou : Shelf()
        object Popular : Shelf()
        object TopFilms : Shelf()
        object TopSeries : Shelf()
        data class Genre(val id: Int) : Shelf()
        data class Search(val query: String) : Shelf()
    }

    private var shelf: Shelf = Shelf.ForYou
    private var page = 1
    private var titles: List<Title> = emptyList()
    private var suggestions: List<Suggestion> = emptyList()
    private var loading = false
    private var failed = false
    private var token = 0
    private val catalogResults = ctx.column(12)
    private val shelves = ctx.row(8)
    private val search = EditText(ctx).apply {
        hint = ctx.getString(R.string.movies_search)
        inputType = android.text.InputType.TYPE_CLASS_TEXT
        imeOptions = EditorInfo.IME_ACTION_SEARCH
        typeface = Fonts.get(ctx, 500)
        setTextColor(ctx.col(R.color.ink))
        setHintTextColor(ctx.col(R.color.ink2))
        background = ctx.rounded(ctx.col(R.color.surface), 22f, ctx.col(R.color.line))
        setPadding(ctx.dp(16), ctx.dp(10), ctx.dp(16), ctx.dp(10))
        minHeight = ctx.dp(48)
        setSingleLine()
        setOnEditorActionListener { _, _, _ ->
            val q = text.toString().trim()
            if (q.isNotEmpty()) open(Shelf.Search(q))
            true
        }
    }
    private val catalog: View = ctx.column(12).apply {
        addView(search)
        addView(HorizontalScrollView(ctx).apply {
            isHorizontalScrollBarEnabled = false
            addView(shelves)
        })
        addView(catalogResults)
        addView(ctx.text(ctx.getString(R.string.movies_tmdb_credit), 12f, 500, ctx.col(R.color.ink2)).apply {
            setOnClickListener { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(Tmdb.home))) }
        }.lp(top = 12))
    }
    private val io = Executors.newSingleThreadExecutor()
    private val hydrated = HashSet<String>()

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val all = MoviesModel.movies(repo.root(), repo.me)
        hydrate(all)
        val toWatch = MoviesModel.toWatch(all)
        val watched = MoviesModel.watched(all)
        body.addView(ctx.text(ctx.getString(R.string.movies_title), 28f, 700))
        body.addView(ctx.text(ctx.getString(R.string.movies_counts, toWatch.size, watched.size), 15f, 500, ctx.col(R.color.ink2)))
        if (toWatch.isNotEmpty() && tab == 0) body.addView(pickCard(all).lp(top = 8))
        body.addView(ctx.segmented(listOf(ctx.getString(R.string.movies_tab_want), ctx.getString(R.string.movies_tab_watched), ctx.getString(R.string.movies_catalog)), tab) {
            tab = it
            refresh()
            if (it == 2 && titles.isEmpty() && suggestions.isEmpty() && !loading) open(shelf)
        }.lp(top = 8))
        if (tab == 2) {
            (catalog.parent as? android.view.ViewGroup)?.removeView(catalog)
            body.addView(catalog)
            drawShelves()
            drawResults(all)
        } else {
            val list = if (tab == 0) toWatch else watched
            if (list.isEmpty()) body.addView(ctx.text(ctx.getString(if (tab == 0) R.string.movies_empty else R.string.movies_watched_empty), 15f, 500, ctx.col(R.color.ink2)).lp(top = 8))
            val card = ctx.card(paddingDp = 16, spacingDp = 0)
            list.forEachIndexed { i, m ->
                if (i > 0) card.addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.sunk)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(1)))
                card.addView(row(m))
            }
            if (list.isNotEmpty()) body.addView(card)
            if (tab == 0 && tmdb.ready) body.addView(ctx.secondaryButton(ctx.getString(R.string.movies_find_more), null) {
                tab = 2
                refresh()
                if (titles.isEmpty() && suggestions.isEmpty() && !loading) open(shelf)
            })
        }
        scroll.post { scroll.scrollTo(0, y) }
    }

    /** "What shall we watch tonight?": a random title from the list, and another if you don't fancy it. */
    private fun pickCard(all: List<Movie>): View = ctx.card(paddingDp = 16, spacingDp = 8, background = ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))).apply {
        addView(ctx.text(ctx.getString(R.string.movies_tonight), 17f, 700, ctx.col(R.color.on_tint)))
        val chosen = all.firstOrNull { it.key == picked && !it.watched }
        if (chosen != null) {
            val line = ctx.row(12)
            chosen.poster?.let { p -> line.addView(posterView(p, 10f).also { RemoteImage.load(it, Tmdb.poster(p, 154), ctx.dp(80)) }, LinearLayout.LayoutParams(ctx.dp(54), ctx.dp(80))) }
            line.addView(ctx.text("${if (chosen.poster == null) (if (chosen.series) "📺 " else "🎬 ") else ""}${chosen.title}", 22f, 800), LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(line)
        }
        addView(ctx.tintButton(ctx.getString(if (chosen == null) R.string.movies_pick else R.string.movies_pick_again), null, ctx.col(R.color.surface), ctx.col(R.color.ink)) { v ->
            haptic(v)
            picked = MoviesModel.pick(all, null, random, picked)?.key
            refresh()
        })
    }

    private fun posterView(path: String?, radius: Float): ImageView = roundedImage(ctx, radius).apply {
        contentDescription = null
        if (path == null) setImageDrawable(null)
    }

    private fun row(m: Movie): View = ctx.row(14).apply {
        minimumHeight = ctx.dp(64)
        setPadding(0, ctx.dp(8), 0, ctx.dp(8))
        if (m.poster != null) {
            addView(posterView(m.poster, 10f).also { RemoteImage.load(it, Tmdb.poster(m.poster, 154), ctx.dp(66)) }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(66)))
        } else {
            addView(ctx.text(if (m.series) "📺" else "🎬", 22f).apply {
                gravity = Gravity.CENTER
                background = ctx.rounded(ctx.col(if (m.by == Owner.ME) R.color.her_tint else R.color.him_tint), 14f)
            }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
        }
        val texts = ctx.column(2)
        texts.addView(ctx.text(m.title, 16f, 700))
        val kind = listOfNotNull(ctx.getString(if (m.series) R.string.movies_series else R.string.movies_movie), m.year?.toString()).joinToString(" · ")
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

    // ---------- Catalog ----------

    private fun shelfLabel(s: Shelf): String = when (s) {
        Shelf.ForYou -> ctx.getString(R.string.movies_for_you)
        Shelf.Popular -> ctx.getString(R.string.movies_popular)
        Shelf.TopFilms -> ctx.getString(R.string.movies_top_films)
        Shelf.TopSeries -> ctx.getString(R.string.movies_top_series)
        is Shelf.Genre -> genreName(s.id)
        is Shelf.Search -> "🔎 ${s.query}"
    }

    private fun drawShelves() {
        shelves.removeAllViews()
        val list = mutableListOf<Shelf>(Shelf.ForYou, Shelf.Popular, Shelf.TopFilms, Shelf.TopSeries)
        (shelf as? Shelf.Search)?.let { list.add(0, it) }
        GENRE_SHELVES.forEach { list += Shelf.Genre(it) }
        list.forEach { s -> shelves.addView(ctx.chip(shelfLabel(s), s == shelf) { open(s) }) }
    }

    private fun open(s: Shelf) {
        shelf = s
        page = 1
        titles = emptyList()
        suggestions = emptyList()
        load()
    }

    private fun load() {
        if (!tmdb.ready) return
        val t = ++token
        loading = true
        failed = false
        if (tab == 2) {
            drawShelves()
            drawResults(MoviesModel.movies(repo.root(), repo.me))
        }
        val s = shelf
        if (s == Shelf.ForYou) {
            MovieSuggestions.load(ctx) { list ->
                if (t != token) return@load
                loading = false
                failed = list == null
                suggestions = list.orEmpty()
                if (tab == 2) drawResults(MoviesModel.movies(repo.root(), repo.me))
            }
            return
        }
        val p = page
        io.execute {
            val more = try {
                when (s) {
                    Shelf.Popular -> tmdb.trending(p)
                    Shelf.TopFilms -> tmdb.topRated(false, p)
                    Shelf.TopSeries -> tmdb.topRated(true, p)
                    is Shelf.Genre -> {
                        val tv = app.belong.couple.core.MovieTaste.forSeries(listOf(s.id))
                        (tmdb.discover(false, listOf(s.id), p) + if (tv.isEmpty()) emptyList() else tmdb.discover(true, tv, p)).sortedByDescending { it.votes }
                    }
                    is Shelf.Search -> tmdb.search(s.query, p)
                    Shelf.ForYou -> emptyList()
                }
            } catch (e: CloudException) {
                null
            }
            view.post {
                if (t != token) return@post
                loading = false
                failed = more == null
                if (more != null) titles = (titles + more).distinctBy { it.key }
                if (tab == 2) drawResults(MoviesModel.movies(repo.root(), repo.me))
            }
        }
    }

    private fun drawResults(all: List<Movie>) {
        catalogResults.removeAllViews()
        if (!tmdb.ready) {
            catalogResults.addView(ctx.text(ctx.getString(R.string.movies_no_key), 15f, 500, ctx.col(R.color.ink2)))
            return
        }
        val inList = MoviesModel.byTmdbKey(all)
        if (shelf == Shelf.ForYou) {
            val rated = all.count { it.watched && it.tmdb != null && (it.myRating != null || it.partnerRating != null) }
            if (rated < 3) catalogResults.addView(ctx.text(ctx.getString(R.string.movies_for_you_start), 14f, 500, ctx.col(R.color.on_tint)).apply {
                background = ctx.rounded(ctx.col(R.color.her_tint), 16f)
                setPadding(ctx.dp(14), ctx.dp(12), ctx.dp(14), ctx.dp(12))
            })
            suggestions.filter { it.title.key !in inList }.take(30).forEach { sg -> catalogResults.addView(suggestionRow(sg)) }
        } else {
            titles.chunked(3).forEach { chunk ->
                val r = ctx.row(10).apply { gravity = Gravity.TOP }
                chunk.forEach { t -> r.addView(tile(t, inList[t.key]), LinearLayout.LayoutParams(0, WRAP, 1f)) }
                repeat(3 - chunk.size) { r.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)) }
                catalogResults.addView(r)
            }
            if (titles.isNotEmpty() && !loading) catalogResults.addView(ctx.secondaryButton(ctx.getString(R.string.movies_more), null) {
                page++
                load()
            })
            if (titles.isEmpty() && !loading && !failed && shelf is Shelf.Search) catalogResults.addView(ctx.text(ctx.getString(R.string.movies_nothing_found), 15f, 500, ctx.col(R.color.ink2)))
        }
        if (loading) catalogResults.addView(ctx.text(ctx.getString(R.string.movies_loading), 15f, 500, ctx.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        if (failed) catalogResults.addView(ctx.text(ctx.getString(R.string.movies_offline), 15f, 500, ctx.col(R.color.ink2)))
    }

    /** A suggestion: poster, title, why it was picked and TMDB's rating. */
    private fun suggestionRow(sg: Suggestion): View = ctx.card(paddingDp = 12, spacingDp = 0).apply {
        val t = sg.title
        val r = ctx.row(14)
        r.addView(posterView(t.poster, 12f).also { v -> t.poster?.let { RemoteImage.load(v, Tmdb.poster(it, 185), ctx.dp(105)) } }, LinearLayout.LayoutParams(ctx.dp(70), ctx.dp(105)))
        val texts = ctx.column(4)
        texts.addView(ctx.text(t.name, 16f, 700))
        texts.addView(ctx.text(meta(t), 13f, 500, ctx.col(R.color.ink2)))
        texts.addView(ctx.text(reason(sg.reason), 13f, 600, ctx.col(R.color.her)))
        r.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(r)
        isClickable = true
        background = ctx.ripple(background, 24f)
        setOnClickListener { titleSheet(t, sg.reason) }
    }

    private fun tile(t: Title, listed: Movie?): View = ctx.column(4).apply {
        val frame = FrameLayout(ctx)
        frame.addView(posterView(t.poster, 12f).also { v -> t.poster?.let { RemoteImage.load(v, Tmdb.poster(it, 185), ctx.dp(160)) } }, FrameLayout.LayoutParams(MATCH, ctx.dp(150)))
        if (t.poster == null) frame.addView(ctx.text(if (t.series) "📺" else "🎬", 28f).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(MATCH, ctx.dp(150)))
        if (listed != null) frame.addView(ctx.text(if (listed.watched) "✓" else "♥", 13f, 800, ctx.col(R.color.white)).apply {
            gravity = Gravity.CENTER
            background = ctx.rounded(ctx.col(if (listed.watched) R.color.ok else R.color.her), 12f)
        }, FrameLayout.LayoutParams(ctx.dp(24), ctx.dp(24), Gravity.TOP or Gravity.END).apply { setMargins(0, ctx.dp(6), ctx.dp(6), 0) })
        addView(frame)
        addView(ctx.text(t.name, 13f, 700).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END })
        addView(ctx.text(listOfNotNull(t.year?.toString(), if (t.rating > 0) "★ " + String.format(ctx.locale(), "%.1f", t.rating) else null).joinToString(" · "), 12f, 500, ctx.col(R.color.ink2)))
        isClickable = true
        setOnClickListener { titleSheet(t, null) }
    }

    private fun meta(t: Title): String = listOfNotNull(
        ctx.getString(if (t.series) R.string.movies_series else R.string.movies_movie),
        t.year?.toString(),
        t.genres.take(2).map { genreName(it) }.filter { it.isNotEmpty() }.joinToString(", ").ifEmpty { null },
        if (t.rating > 0) "★ " + String.format(ctx.locale(), "%.1f", t.rating) else null,
    ).joinToString(" · ")

    private fun reason(r: Suggestion.Reason): String = when (r) {
        is Suggestion.Reason.Like -> when (r.who) {
            Owner.OURS -> ctx.getString(R.string.movies_because_both, r.name)
            Owner.ME -> ctx.getString(R.string.movies_because_one, store.myName, r.name)
            Owner.PARTNER -> ctx.getString(R.string.movies_because_one, store.partnerDisplay, r.name)
        }
        is Suggestion.Reason.Genre -> ctx.getString(R.string.movies_because_genre, genreName(r.genre).lowercase(ctx.locale()))
        Suggestion.Reason.Popular -> ctx.getString(R.string.movies_because_popular)
    }

    private val genreNames: Map<Int, String> by lazy {
        ctx.resources.getStringArray(R.array.tmdb_genres).associate { line -> line.substringBefore('|').toInt() to line.substringAfter('|') }
    }

    private fun genreName(id: Int): String = genreNames[id].orEmpty()

    /** A title from TMDB: poster, what it is, the description, and adding it to your list. */
    private fun titleSheet(t: Title, why: Suggestion.Reason?) {
        val listed = MoviesModel.byTmdbKey(MoviesModel.movies(repo.root(), repo.me))[t.key]
        activity.bottomSheet { sheet, dialog ->
            val head = ctx.row(14)
            head.addView(posterView(t.poster, 12f).also { v -> t.poster?.let { RemoteImage.load(v, Tmdb.poster(it, 342), ctx.dp(150)) } }, LinearLayout.LayoutParams(ctx.dp(100), ctx.dp(150)))
            val texts = ctx.column(4)
            texts.addView(ctx.text(t.name, 20f, 800))
            texts.addView(ctx.text(meta(t), 13f, 500, ctx.col(R.color.ink2)))
            why?.let { texts.addView(ctx.text(reason(it), 13f, 600, ctx.col(R.color.her))) }
            if (listed != null) texts.addView(ctx.text(ctx.getString(if (listed.watched) R.string.movies_already_watched else R.string.movies_already_listed), 13f, 700, ctx.col(R.color.ok_ink)))
            head.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
            sheet.addView(head)
            if (t.overview.isNotBlank()) sheet.addView(ctx.text(t.overview, 15f, 500).apply {
                maxLines = 9
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
            if (listed == null) {
                sheet.addView(ctx.primaryButton(ctx.getString(R.string.movies_want), R.drawable.ic_plus) {
                    repo.put("movies/${DreamsScreen.newKey()}", MoviesModel.json(t, seatKey(repo.me, mine = true), System.currentTimeMillis()))
                    MovieSuggestions.invalidate()
                    dialog.dismiss()
                    Toaster.show(activity, ctx.getString(R.string.movies_added, store.partnerDisplay))
                })
                sheet.addView(ctx.text(ctx.getString(R.string.movies_seen_it), 14f, 700, ctx.col(R.color.ink2)).lp(top = 4))
                sheet.addView(starsRow { n ->
                    val key = DreamsScreen.newKey()
                    val o = MoviesModel.json(t, seatKey(repo.me, mine = true), System.currentTimeMillis())
                        .put("watched", true).put("watchedAt", System.currentTimeMillis())
                        .put("rate", org.json.JSONObject().put(seatKey(repo.me, mine = true), n))
                    repo.put("movies/$key", o)
                    MovieSuggestions.invalidate()
                    dialog.dismiss()
                    Toaster.show(activity, ctx.getString(R.string.movies_rated))
                })
                if (why != null) sheet.addView(ctx.textButton(ctx.getString(R.string.movies_not_interested)) {
                    MovieSuggestions.hide(ctx, t.key)
                    suggestions = suggestions.filter { it.title.key != t.key }
                    dialog.dismiss()
                    refresh()
                })
            }
        }
    }

    /** Titles saved before posters (or the example ones) get their poster, year and genres from TMDB once. */
    private fun hydrate(all: List<Movie>) {
        if (!tmdb.ready) return
        val todo = all.filter { it.tmdb != null && it.poster == null && hydrated.add(it.key) }.take(6)
        if (todo.isEmpty()) return
        io.execute {
            val found = todo.mapNotNull { m -> try { tmdb.details(m.tmdb!!, m.series)?.let { m to it } } catch (e: CloudException) { null } }
            if (found.isEmpty()) return@execute
            view.post {
                found.forEach { (m, t) ->
                    t.poster?.takeIf { it.length <= 64 }?.let { repo.put("movies/${m.key}/poster", it) }
                    if (m.year == null) t.year?.let { repo.put("movies/${m.key}/year", it) }
                    if (m.genreIds.isEmpty() && t.genres.isNotEmpty()) repo.put("movies/${m.key}/genres", t.genres.take(8).joinToString(","))
                }
            }
        }
    }

    // ---------- Adding and rating ----------

    /** Adding a title: search TMDB as you type, or keep what you typed. */
    private fun add() {
        var series = false
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.movies_add), 22f, 700))
            val title = EditText(ctx).apply {
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
            val results = ctx.column(4)
            sheet.addView(results)
            val manual = ctx.column(10)
            val kind = FrameLayout(ctx)
            fun drawKind() {
                kind.removeAllViews()
                kind.addView(ctx.segmented(listOf("🎬 " + ctx.getString(R.string.movies_movie), "📺 " + ctx.getString(R.string.movies_series)), if (series) 1 else 0) {
                    series = it == 1
                    drawKind()
                })
            }
            drawKind()
            manual.addView(kind)
            manual.addView(ctx.primaryButton(ctx.getString(R.string.settings_save)) {
                val t = title.text.toString().trim()
                if (t.isEmpty()) {
                    title.error = ctx.getString(R.string.wish_title_required)
                    return@primaryButton
                }
                repo.put("movies/${DreamsScreen.newKey()}", MoviesModel.json(t, series, seatKey(repo.me, mine = true), System.currentTimeMillis()))
                tab = 0
                dialog.dismiss()
            })
            sheet.addView(manual)
            var searchToken = 0
            val searchLater = Runnable {
                val q = title.text.toString().trim()
                val mine = ++searchToken
                if (q.length < 2 || !tmdb.ready) {
                    results.removeAllViews()
                    return@Runnable
                }
                io.execute {
                    val found = try { tmdb.search(q).take(5) } catch (e: CloudException) { null }
                    results.post {
                        if (mine != searchToken || !dialog.isShowing) return@post
                        results.removeAllViews()
                        found?.forEach { t -> results.addView(searchRow(t) {
                            repo.put("movies/${DreamsScreen.newKey()}", MoviesModel.json(t, seatKey(repo.me, mine = true), System.currentTimeMillis()))
                            MovieSuggestions.invalidate()
                            tab = 0
                            dialog.dismiss()
                        }) }
                        if (!found.isNullOrEmpty()) results.addView(ctx.text(ctx.getString(R.string.movies_or_manual), 13f, 600, ctx.col(R.color.ink2)).lp(top = 6))
                    }
                }
            }
            title.addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: android.text.Editable?) {
                    title.removeCallbacks(searchLater)
                    title.postDelayed(searchLater, 450)
                }
            })
            title.requestFocus()
        }
    }

    private fun searchRow(t: Title, onPick: () -> Unit): View = ctx.row(12).apply {
        minimumHeight = ctx.dp(56)
        addView(posterView(t.poster, 8f).also { v -> t.poster?.let { RemoteImage.load(v, Tmdb.poster(it, 92), ctx.dp(60)) } }, LinearLayout.LayoutParams(ctx.dp(36), ctx.dp(54)))
        val texts = ctx.column(2)
        texts.addView(ctx.text(t.name, 15f, 700))
        texts.addView(ctx.text(meta(t), 12f, 500, ctx.col(R.color.ink2)))
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 12f), 12f)
        setOnClickListener { onPick() }
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
                MovieSuggestions.invalidate()
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
                MovieSuggestions.invalidate()
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

    companion object {
        /** Genre chips in the catalog: drama, comedy, romance, sci-fi, thriller, mystery, animation, adventure, horror, documentary. */
        private val GENRE_SHELVES = listOf(18, 35, 10749, 878, 53, 9648, 16, 12, 27, 99)
    }
}
