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
