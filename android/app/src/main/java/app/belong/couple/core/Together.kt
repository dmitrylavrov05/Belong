package app.belong.couple.core

import org.json.JSONObject

/** The seat key a value is stored under: the real seat for a pair, or "me" / "partner" for the demo couple. */
fun seatKey(me: Role?, mine: Boolean): String = when {
    me == null -> if (mine) "me" else "partner"
    mine -> me.key
    else -> me.other.key
}

data class Moment(val key: String, val title: String, val text: String, val day: Long, val photo: Picture?)

/** One entry in the couple's chronicle ("Us"). */
data class ChronicleItem(
    val kind: Kind,
    val day: Long,
    val title: String,
    val text: String,
    val emoji: String,
    val photo: Picture?,
    /** The same date one or more years ago: shown as "On this day". */
    val anniversary: Boolean,
    val key: String = "",
) {
    enum class Kind { DREAM, GOAL, MOMENT, SINCE }
}

/**
 * Everyday shared things stored under live/: thanks/{day}/{seat},
 * flags/{question|quiz}/{id}/{seat}, couple/since and moments/{key}.
 */
object TogetherModel {

    /** The evening note one partner left for the other on [day]. */
    fun thanks(root: JSONObject, day: Long, seat: String): String? =
        root.optJSONObject("thanks")?.optJSONObject(day.toString())?.optJSONObject(seat)?.optString("text")?.takeIf { it.isNotBlank() }

    /** Whether [seat] has answered today's question or finished a quiz round. */
    fun flag(root: JSONObject, kind: String, id: Long, seat: String): Boolean =
        root.optJSONObject("flags")?.optJSONObject(kind)?.optJSONObject(id.toString())?.optBoolean(seat) == true

    /** The day you got together (epoch day), if set. */
    fun since(root: JSONObject): Long? = root.optJSONObject("couple")?.takeIf { it.has("since") }?.optLong("since")

    fun moments(root: JSONObject): List<Moment> {
        val all = root.optJSONObject("moments") ?: return emptyList()
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            val title = o.optString("title")
            if (title.isEmpty() || !o.has("day")) null else Moment(key, title, o.optString("text"), o.optLong("day"), Picture.from(o.optJSONObject("photo")))
        }.toList()
    }

    /**
     * The chronicle, newest first: dreams that came true, goals reached, memories and the day you got
     * together. Entries from this calendar date in earlier years are marked as "On this day".
     */
    fun chronicle(root: JSONObject, me: Role?, today: Long): List<ChronicleItem> {
        val items = mutableListOf<ChronicleItem>()
        val dreams = DreamsModel.dreams(root, me)
        dreams.filter { it.done }.forEach { d ->
            val day = d.doneAt?.let { it / 86_400_000L } ?: return@forEach
            items += ChronicleItem(ChronicleItem.Kind.DREAM, day, d.title, "", d.emoji, d.photo, false, d.key)
        }
        DreamsModel.goals(root, me).filter { it.done }.forEach { g ->
            val day = g.doneAt?.let { it / 86_400_000L } ?: return@forEach
            val photo = g.dreamKey?.let { k -> dreams.firstOrNull { it.key == k }?.photo }
            items += ChronicleItem(ChronicleItem.Kind.GOAL, day, g.title, "${g.steps.size}", g.emoji, photo, false, g.key)
        }
        moments(root).forEach { m -> items += ChronicleItem(ChronicleItem.Kind.MOMENT, m.day, m.title, m.text, "📸", m.photo, false, m.key) }
        since(root)?.let { items += ChronicleItem(ChronicleItem.Kind.SINCE, it, "", "", "💞", null, false) }
        val todayDate = java.time.LocalDate.ofEpochDay(today)
        return items
            .filter { it.day <= today }
            .map { item ->
                val date = java.time.LocalDate.ofEpochDay(item.day)
                item.copy(anniversary = date.year < todayDate.year && date.monthValue == todayDate.monthValue && date.dayOfMonth == todayDate.dayOfMonth)
            }
            .sortedWith(compareBy<ChronicleItem>({ !it.anniversary }, { -it.day }))
    }
}

/** "Question of the day": both phones pick the same question from the localized list by date. */
object DailyQuestions {
    fun index(day: Long, count: Int): Int = Math.floorMod(day, count.toLong()).toInt()
}

/** "How well do you know me?": ten questions a week, the same on both phones. */
object QuizModel {
    const val PER_ROUND = 10

    /** A round lasts a week (Monday to Sunday). */
    fun round(day: Long): Long = Math.floorDiv(day + 3, 7L) // epoch day 0 was a Thursday

    /** The questions for [round]: a different ten each week, in a shuffled order both phones agree on. */
    fun questions(round: Long, bankSize: Int): List<Int> {
        val order = (0 until bankSize).toMutableList()
        order.shuffle(java.util.Random(round * 7919 + 17))
        return order.take(minOf(PER_ROUND, bankSize))
    }

    /** How many of [guesses] about the partner match what the partner answered about themselves. */
    fun score(guesses: Map<Int, Int>, partnerSelf: Map<Int, Int>): Int = guesses.count { (q, a) -> partnerSelf[q] == a }

    fun answersJson(answers: Map<Int, Int>): JSONObject = JSONObject().apply { answers.forEach { (q, a) -> put("q$q", a) } }

    fun answers(o: JSONObject?): Map<Int, Int> {
        o ?: return emptyMap()
        return o.keys().asSequence().mapNotNull { k -> k.removePrefix("q").toIntOrNull()?.let { it to o.optInt(k) } }.toMap()
    }
}

data class ImportantDate(val key: String, val title: String, val emoji: String, val day: Long, val yearly: Boolean)

/** A date coming up: the next time it falls, and for yearly ones how many years it marks. */
data class Upcoming(val title: String, val emoji: String, val date: Long, val daysLeft: Long, val years: Int?, val kind: Kind, val key: String = "") {
    enum class Kind { DATE, ANNIVERSARY, MEETING }
}

/** The calendar of important dates (live/dates) and the couple's living arrangement (live/couple). */
object CalendarModel {
    fun dates(root: JSONObject): List<ImportantDate> {
        val all = root.optJSONObject("dates") ?: return emptyList()
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            val title = o.optString("title")
            if (title.isEmpty() || !o.has("day")) null else ImportantDate(key, title, o.optString("emoji").ifEmpty { "📅" }, o.optLong("day"), o.optBoolean("yearly"))
        }.toList()
    }

    /** Whether you live apart: null until the couple has said. */
    fun apart(root: JSONObject): Boolean? = root.optJSONObject("couple")?.takeIf { it.has("apart") }?.optBoolean("apart")

    fun meeting(root: JSONObject): Long? = root.optJSONObject("couple")?.takeIf { it.has("meeting") }?.optLong("meeting")

    /** The next time [day] falls on or after [today]: itself, or for a yearly date its next anniversary (29 Feb → 28 Feb). */
    fun nextOccurrence(day: Long, yearly: Boolean, today: Long): Long? {
        if (!yearly) return day.takeIf { it >= today }
        val start = java.time.LocalDate.ofEpochDay(day)
        val now = java.time.LocalDate.ofEpochDay(today)
        var year = now.year
        while (true) {
            val candidate = start.withYear(year)
            if (!candidate.isBefore(now)) return candidate.toEpochDay()
            year++
        }
    }

    /**
     * What's coming, soonest first: your own dates, the yearly anniversary of the day you got together
     * and, for a couple living apart, the next meeting.
     */
    fun upcoming(root: JSONObject, today: Long, anniversaryTitle: String, meetingTitle: String): List<Upcoming> {
        val items = mutableListOf<Upcoming>()
        dates(root).forEach { d ->
            val next = nextOccurrence(d.day, d.yearly, today) ?: return@forEach
            val years = if (d.yearly) (java.time.LocalDate.ofEpochDay(next).year - java.time.LocalDate.ofEpochDay(d.day).year).takeIf { it > 0 } else null
            items += Upcoming(d.title, d.emoji, next, next - today, years, Upcoming.Kind.DATE, d.key)
        }
        TogetherModel.since(root)?.let { since ->
            val next = nextOccurrence(since, true, today)!!
            val years = java.time.LocalDate.ofEpochDay(next).year - java.time.LocalDate.ofEpochDay(since).year
            if (years > 0) items += Upcoming(anniversaryTitle, "💞", next, next - today, years, Upcoming.Kind.ANNIVERSARY)
        }
        if (apart(root) == true) meeting(root)?.takeIf { it >= today }?.let { items += Upcoming(meetingTitle, "✈️", it, it - today, null, Upcoming.Kind.MEETING) }
        return items.sortedWith(compareBy({ it.daysLeft }, { it.kind.ordinal }))
    }

    /** Dates that fall on each day of [month] (yearly ones in every year), for the calendar's dots. */
    fun inMonth(root: JSONObject, month: java.time.YearMonth): Map<Int, List<ImportantDate>> {
        val result = HashMap<Int, MutableList<ImportantDate>>()
        dates(root).forEach { d ->
            val date = java.time.LocalDate.ofEpochDay(d.day)
            val hit = if (d.yearly) date.monthValue == month.monthValue && date.year <= month.year else java.time.YearMonth.from(date) == month
            if (hit) result.getOrPut(minOf(date.dayOfMonth, month.lengthOfMonth())) { mutableListOf() } += d
        }
        return result
    }
}

/** A photo of the day: who added it, when, and an optional caption. The image itself is stored separately. */
data class DayPhoto(val key: String, val day: Long, val by: Owner, val at: Long, val caption: String)

object PhotosModel {
    /** At most this many photos per person per day, to keep the free database plan roomy. */
    const val PER_DAY = 5

    fun photos(root: JSONObject, me: Role?): List<DayPhoto> {
        val days = root.optJSONObject("photos") ?: return emptyList()
        val mine = seatKey(me, mine = true)
        return days.keys().asSequence().flatMap { d ->
            val day = d.toLongOrNull() ?: return@flatMap emptySequence()
            val all = days.optJSONObject(d) ?: return@flatMap emptySequence()
            all.keys().asSequence().mapNotNull { key ->
                val o = all.optJSONObject(key) ?: return@mapNotNull null
                DayPhoto(key, day, if (o.optString("by") == mine) Owner.ME else Owner.PARTNER, o.optLong("at"), o.optString("caption"))
            }
        }.sortedWith(compareBy<DayPhoto>({ -it.day }, { -it.at })).toList()
    }

    fun inMonth(photos: List<DayPhoto>, month: java.time.YearMonth): List<DayPhoto> =
        photos.filter { java.time.YearMonth.from(java.time.LocalDate.ofEpochDay(it.day)) == month }

    fun inYear(photos: List<DayPhoto>, year: Int): List<DayPhoto> =
        photos.filter { java.time.LocalDate.ofEpochDay(it.day).year == year }
}

/** What a month (or a year) held for the two of you, beyond the counters: from live/ data both phones share. */
data class Highlights(
    val photos: Int,
    val photoDays: Int,
    val dreams: List<String>,
    val goals: List<String>,
    val questions: Int,
    val thanks: Int,
    val moments: List<String>,
    val talks: Int,
    val movies: Int = 0,
)

object ReportModel {
    /** Highlights for the days [from]..[to] (epoch days, inclusive). */
    fun highlights(root: JSONObject, me: Role?, from: Long, to: Long): Highlights {
        fun inRange(day: Long) = day in from..to
        val photos = PhotosModel.photos(root, me).filter { inRange(it.day) }
        val dreams = DreamsModel.dreams(root, me).filter { d -> d.done && d.doneAt?.let { inRange(it / 86_400_000L) } == true }.map { "${it.emoji} ${it.title}" }
        val goals = DreamsModel.goals(root, me).filter { g -> g.done && g.doneAt?.let { inRange(it / 86_400_000L) } == true }.map { "${it.emoji} ${it.title}" }
        val questions = root.optJSONObject("flags")?.optJSONObject("question")?.let { q ->
            q.keys().asSequence().count { d -> d.toLongOrNull()?.let(::inRange) == true && (q.optJSONObject(d)?.length() ?: 0) >= 2 }
        } ?: 0
        val thanks = root.optJSONObject("thanks")?.let { t ->
            t.keys().asSequence().filter { d -> d.toLongOrNull()?.let(::inRange) == true }.sumOf { t.optJSONObject(it)?.length() ?: 0 }
        } ?: 0
        val moments = TogetherModel.moments(root).filter { inRange(it.day) }.sortedBy { it.day }.map { it.title }
        val talks = FeelingsModel.notes(root, me).count { inRange(it.at / 86_400_000L) }
        val movies = MoviesModel.watched(MoviesModel.movies(root, me)).count { m -> m.watchedAt?.let { inRange(it / 86_400_000L) } == true }
        return Highlights(photos.size, photos.map { it.day }.distinct().size, dreams, goals, questions, thanks, moments, talks, movies)
    }

    fun month(root: JSONObject, me: Role?, month: java.time.YearMonth): Highlights =
        highlights(root, me, month.atDay(1).toEpochDay(), month.atEndOfMonth().toEpochDay())

    fun year(root: JSONObject, me: Role?, year: Int): Highlights =
        highlights(root, me, java.time.LocalDate.of(year, 1, 1).toEpochDay(), java.time.LocalDate.of(year, 12, 31).toEpochDay())

    /** Up to [count] photos spread over the period: the newest from each day first, then the rest. */
    fun collage(photos: List<DayPhoto>, count: Int): List<DayPhoto> {
        val byDay = photos.groupBy { it.day }.toSortedMap()
        val firsts = byDay.values.map { it.first() }
        val picked = if (firsts.size <= count) firsts + (photos - firsts.toSet()).take(count - firsts.size)
        else (0 until count).map { firsts[it * firsts.size / count] }
        return picked.sortedBy { it.day }
    }
}

/** A note about feelings after a quarrel: one per person, each private until the other has written theirs. */
data class FeelingsNote(val key: String, val title: String, val by: Owner, val at: Long, val mineWritten: Boolean, val partnerWritten: Boolean)

object FeelingsModel {
    fun notes(root: JSONObject, me: Role?): List<FeelingsNote> {
        val all = root.optJSONObject("feelings") ?: return emptyList()
        val mine = seatKey(me, mine = true)
        val theirs = seatKey(me, mine = false)
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            if (!o.has("by")) return@mapNotNull null
            val wrote = o.optJSONObject("wrote")
            FeelingsNote(key, o.optString("title"), if (o.optString("by") == mine) Owner.ME else Owner.PARTNER, o.optLong("at"),
                wrote?.optBoolean(mine) == true, wrote?.optBoolean(theirs) == true)
        }.sortedByDescending { it.at }.toList()
    }

    /** The partner wrote and is waiting for my side. */
    fun waitingForMe(root: JSONObject, me: Role?): FeelingsNote? = notes(root, me).firstOrNull { it.partnerWritten && !it.mineWritten }
}

/** A letter to open later: on a day ([openAt], ms) or "when…" ([title] says when). */
data class Letter(
    val key: String,
    val title: String,
    val kind: Kind,
    val openAt: Long?,
    val by: Owner,
    val at: Long,
    val opened: Boolean,
) {
    enum class Kind { DATE, WHEN }

    /** Whether the reader may open it at [now]. */
    fun canOpen(now: Long): Boolean = kind == Kind.WHEN || (openAt != null && openAt <= now)
}

/** Letters to each other (live/letters); the text itself is in letters/{key} and opens on its day. */
object LettersModel {
    fun letters(root: JSONObject, me: Role?): List<Letter> {
        val all = root.optJSONObject("letters") ?: return emptyList()
        val mine = seatKey(me, mine = true)
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            val title = o.optString("title")
            if (title.isEmpty() || !o.has("by")) return@mapNotNull null
            val kind = if (o.optString("kind") == "when") Letter.Kind.WHEN else Letter.Kind.DATE
            Letter(key, title, kind, if (o.has("openAt")) o.optLong("openAt") else null,
                if (o.optString("by") == mine) Owner.ME else Owner.PARTNER, o.optLong("at"), o.optBoolean("opened"))
        }.toList()
    }

    /** Letters for me: the ones I can open first (dated ones by date), then sealed ones by when they open. */
    fun forMe(letters: List<Letter>, now: Long): List<Letter> = letters.filter { it.by == Owner.PARTNER }
        .sortedWith(compareBy<Letter>({ !it.canOpen(now) }, { it.opened }, { it.openAt ?: 0L }, { -it.at }))

    fun fromMe(letters: List<Letter>): List<Letter> = letters.filter { it.by == Owner.ME }.sortedByDescending { it.at }

    /** A dated letter that has just become openable and is still unread: worth a card on Today. */
    fun ready(letters: List<Letter>, now: Long): Letter? =
        letters.firstOrNull { it.by == Owner.PARTNER && it.kind == Letter.Kind.DATE && it.canOpen(now) && !it.opened }

    fun metaJson(by: String, kind: Letter.Kind, title: String, openAt: Long?, at: Long): JSONObject = JSONObject()
        .put("by", by).put("at", at).put("kind", if (kind == Letter.Kind.WHEN) "when" else "date").put("title", title)
        .apply { if (openAt != null) put("openAt", openAt) }
}

data class Movie(
    val key: String,
    val title: String,
    val series: Boolean,
    val by: Owner,
    val at: Long,
    val watched: Boolean,
    val watchedAt: Long?,
    val myRating: Int?,
    val partnerRating: Int?,
    /** TMDB data when the title was picked from search or the catalog. */
    val tmdb: Int? = null,
    val poster: String? = null,
    val year: Int? = null,
    val genreIds: List<Int> = emptyList(),
) {
    /** The TMDB key ("m157336", "t1399") when known: matches [Title.key]. */
    val tmdbKey: String? get() = tmdb?.let { (if (series) "t" else "m") + it }
}

/** What you want to watch together and what you've watched, with each partner's own rating (live/movies). */
object MoviesModel {
    fun movies(root: JSONObject, me: Role?): List<Movie> {
        val all = root.optJSONObject("movies") ?: return emptyList()
        val mine = seatKey(me, mine = true)
        val theirs = seatKey(me, mine = false)
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            val title = o.optString("title")
            if (title.isEmpty()) return@mapNotNull null
            val rate = o.optJSONObject("rate")
            Movie(key, title, o.optString("kind") == "series", if (o.optString("by") == mine) Owner.ME else Owner.PARTNER, o.optLong("at"),
                o.optBoolean("watched"), if (o.has("watchedAt")) o.optLong("watchedAt") else null,
                rate?.takeIf { it.has(mine) }?.optInt(mine), rate?.takeIf { it.has(theirs) }?.optInt(theirs),
                if (o.has("tmdb")) o.optInt("tmdb") else null, o.optString("poster").ifEmpty { null },
                if (o.has("year")) o.optInt("year") else null,
                o.optString("genres").split(',').mapNotNull { it.trim().toIntOrNull() })
        }.toList()
    }

    /** Still to watch, newest suggestion first. */
    fun toWatch(movies: List<Movie>): List<Movie> = movies.filter { !it.watched }.sortedByDescending { it.at }

    /** Watched, most recent first. */
    fun watched(movies: List<Movie>): List<Movie> = movies.filter { it.watched }.sortedByDescending { it.watchedAt ?: it.at }

    /** Our average for a watched title, once both have rated it. */
    fun together(m: Movie): Double? = if (m.myRating != null && m.partnerRating != null) (m.myRating + m.partnerRating) / 2.0 else null

    /** Something for tonight from the to-watch list, skipping [last] when there's another option. */
    fun pick(movies: List<Movie>, series: Boolean?, random: java.util.Random, last: String? = null): Movie? {
        val options = toWatch(movies).filter { series == null || it.series == series }
        val fresh = options.filter { it.key != last }.ifEmpty { options }
        return if (fresh.isEmpty()) null else fresh[random.nextInt(fresh.size)]
    }

    fun json(title: String, series: Boolean, by: String, at: Long): JSONObject =
        JSONObject().put("title", title).put("kind", if (series) "series" else "movie").put("by", by).put("at", at).put("watched", false)

    /** A title from TMDB, with its id, poster, year and genres for posters and suggestions. */
    fun json(t: Title, by: String, at: Long): JSONObject = json(t.name.take(100), t.series, by, at).also { o ->
        o.put("tmdb", t.id)
        t.poster?.takeIf { it.length <= 64 }?.let { o.put("poster", it) }
        t.year?.let { o.put("year", it) }
        if (t.genres.isNotEmpty()) o.put("genres", t.genres.take(8).joinToString(","))
    }

    /** Titles in the pair's list, by TMDB key, so the catalog can show "in your list" / "watched". */
    fun byTmdbKey(movies: List<Movie>): Map<String, Movie> = movies.filter { it.tmdbKey != null }.associateBy { it.tmdbKey!! }
}

/**
 * The cards on Today that each person can show, hide and reorder. Notices (a letter that opened,
 * a feelings note waiting, the month report) always come first and aren't part of the layout.
 */
object HomeLayout {
    const val COVER = "cover"
    const val PARTNER = "partner"
    const val CHECKIN = "checkin"
    const val NOTE = "note"
    const val DATES = "dates"
    const val ON_THIS_DAY = "onthisday"
    const val PHOTO = "photo"
    const val PLAN = "plan"
    const val EVENING = "evening"
    const val QUESTION = "question"
    const val WIDGETS = "widgets"

    val DEFAULT = listOf(COVER, PARTNER, CHECKIN, NOTE, DATES, ON_THIS_DAY, PHOTO, PLAN, EVENING, QUESTION, WIDGETS)

    /** Off until switched on in "Customise Today". */
    val HIDDEN_BY_DEFAULT = setOf(WIDGETS)

    /** The saved order with unknown ids dropped and cards added in a later version put where they belong by default. */
    fun order(saved: List<String>): List<String> {
        val known = saved.filter { it in DEFAULT }.distinct()
        if (known.isEmpty()) return DEFAULT
        val result = known.toMutableList()
        // A missing card goes right after its neighbour in the default order (the first one, before its follower).
        DEFAULT.forEachIndexed { i, id ->
            if (id !in result) {
                val at = if (i > 0) result.indexOf(DEFAULT[i - 1]) + 1 else DEFAULT.drop(1).firstOrNull { it in result }?.let { result.indexOf(it) } ?: 0
                result.add(at, id)
            }
        }
        return result
    }

    /** [order] with [id] moved one place up (-1) or down (+1). */
    fun move(order: List<String>, id: String, by: Int): List<String> {
        val i = order.indexOf(id)
        val j = i + by
        if (i < 0 || j !in order.indices) return order
        return order.toMutableList().apply { add(j, removeAt(i)) }
    }
}

/** A short note one partner leaves for the other on Today (live/note/{seat}); it stays until replaced. */
data class LoveNote(val text: String, val at: Long)

/** "On this day": photos of the day and memories from this date in earlier years. */
data class OnThisDay(val years: Int, val photos: List<DayPhoto>, val moments: List<Moment>)

object TodayModel {
    fun note(root: JSONObject, seat: String): LoveNote? =
        root.optJSONObject("note")?.optJSONObject(seat)?.let { o -> o.optString("text").takeIf { it.isNotBlank() }?.let { LoveNote(it, o.optLong("at")) } }

    fun cover(root: JSONObject): String? = root.optJSONObject("couple")?.optString("cover")?.takeIf { it.isNotEmpty() }

    /** The most recent earlier year with photos or memories on today's date, if any. */
    fun onThisDay(root: JSONObject, me: Role?, today: Long): OnThisDay? {
        val date = java.time.LocalDate.ofEpochDay(today)
        fun sameDay(day: Long): Int? {
            val d = java.time.LocalDate.ofEpochDay(day)
            return (date.year - d.year).takeIf { it > 0 && d.monthValue == date.monthValue && d.dayOfMonth == date.dayOfMonth }
        }
        val photos = PhotosModel.photos(root, me).mapNotNull { p -> sameDay(p.day)?.let { it to p } }
        val moments = TogetherModel.moments(root).mapNotNull { m -> sameDay(m.day)?.let { it to m } }
        val years = (photos.map { it.first } + moments.map { it.first }).minOrNull() ?: return null
        return OnThisDay(years, photos.filter { it.first == years }.map { it.second }, moments.filter { it.first == years }.map { it.second })
    }
}

/** How a person appears: their photo (a photo_data key), or an emoji on one of the avatar colours. */
data class Profile(val photo: String?, val emoji: String?, val color: Int)

object ProfileModel {
    const val COLORS = 8

    fun profile(root: JSONObject, seat: String): Profile {
        val o = root.optJSONObject("profile")?.optJSONObject(seat) ?: return Profile(null, null, 0)
        return Profile(
            o.optString("photo").ifEmpty { null },
            o.optString("emoji").ifEmpty { null },
            Math.floorMod(o.optInt("color"), COLORS),
        )
    }
}
