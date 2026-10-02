package app.belong.couple.core

import org.json.JSONObject

/** The seat key a value is stored under: the real seat for a pair, or "me" / "partner" for the demo couple. */
fun seatKey(me: Role?, mine: Boolean): String = when {
    me == null -> if (mine) "me" else "partner"
    mine -> me.key
    else -> me.other.key
}

data class ShoppingItem(val key: String, val title: String, val by: Owner, val done: Boolean, val at: Long)

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
 * Everyday shared things stored under live/: shopping/{key}, thanks/{day}/{seat},
 * flags/{question|quiz}/{id}/{seat}, couple/since and moments/{key}.
 */
object TogetherModel {

    fun shopping(root: JSONObject, me: Role?): List<ShoppingItem> {
        val all = root.optJSONObject("shopping") ?: return emptyList()
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            val title = o.optString("title")
            if (title.isEmpty()) return@mapNotNull null
            val by = if (o.optString("by") == seatKey(me, mine = true)) Owner.ME else Owner.PARTNER
            ShoppingItem(key, title, by, o.optBoolean("done"), o.optLong("at"))
        }.sortedWith(compareBy<ShoppingItem>({ it.done }, { it.at })).toList()
    }

    fun shoppingJson(title: String, me: Role?, at: Long): JSONObject =
        JSONObject().put("title", title).put("by", seatKey(me, mine = true)).put("done", false).put("at", at)

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
        return Highlights(photos.size, photos.map { it.day }.distinct().size, dreams, goals, questions, thanks, moments, talks)
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
