package app.belong.couple.core

import org.json.JSONObject

/** Dream categories, in the order the filter chips show them. */
enum class DreamCategory(val key: String) {
    TRAVEL("travel"),
    HOME("home"),
    MONEY("money"),
    HEALTH("health"),
    FUN("fun"),
    FAMILY("family");

    companion object {
        fun of(key: String?): DreamCategory = entries.firstOrNull { it.key == key } ?: FUN
    }
}

/** Who a dream, goal step or task belongs to, from this phone's point of view. */
fun ownerOf(key: String?, me: Role?): Owner = when {
    me == null -> Owner.of(key) // demo data is stored as me / ours / partner
    key == me.key -> Owner.ME
    key == me.other.key -> Owner.PARTNER
    else -> Owner.OURS
}

fun ownerKey(owner: Owner, me: Role?): String = when {
    me == null -> owner.key
    owner == Owner.ME -> me.key
    owner == Owner.PARTNER -> me.other.key
    else -> "both"
}

/**
 * A picture for a dream: a photo found on Unsplash or the preview image of a shared link
 * (Pinterest, a website). Only links are stored; the image stays where it is hosted.
 */
data class Picture(
    val url: String,
    val thumb: String,
    /** Who to credit: the Unsplash photographer, or the website's name. */
    val by: String,
    /** Where the credit links to. */
    val link: String,
    /** "unsplash" or "web". */
    val source: String,
    /** Unsplash asks apps to call this when a photo is chosen; empty for other sources. */
    val downloadLocation: String = "",
) {
    fun toJson(): JSONObject = JSONObject().put("url", url).put("thumb", thumb).put("by", by).put("link", link).put("src", source)

    companion object {
        fun from(o: JSONObject?): Picture? {
            val url = o?.optString("url").orEmpty()
            if (!url.startsWith("https://")) return null
            return Picture(url, o!!.optString("thumb").ifEmpty { url }, o.optString("by"), o.optString("link"), o.optString("src", "web"))
        }
    }
}

data class Dream(
    val key: String,
    val title: String,
    val emoji: String,
    val category: DreamCategory,
    val owner: Owner,
    val at: Long,
    val goalKey: String?,
    val done: Boolean,
    val photo: Picture? = null,
)

data class GoalStep(val key: String, val title: String, val who: Owner, val done: Boolean, val due: Long?, val at: Long)

data class Goal(
    val key: String,
    val title: String,
    val emoji: String,
    val at: Long,
    val target: Long,
    val unit: String,
    val savedMine: Long,
    val savedPartner: Long,
    val steps: List<GoalStep>,
    val dreamKey: String?,
    val done: Boolean,
) {
    val saved: Long get() = savedMine + savedPartner
    val hasSavings: Boolean get() = target > 0
    val stepsDone: Int get() = steps.count { it.done }

    /** 0–100: savings and steps count equally when there are both. */
    val progress: Int
        get() {
            val parts = buildList {
                if (hasSavings) add(saved.coerceAtMost(target).toDouble() / target)
                if (steps.isNotEmpty()) add(stepsDone.toDouble() / steps.size)
            }
            if (done) return 100
            return if (parts.isEmpty()) 0 else (parts.average() * 100).toInt()
        }
}

/**
 * Dreams and goals as stored under live/: dreams/{key} and goals/{key}, each goal with
 * steps/{key} and saved/{seat}. [me] is null for the demo couple, whose data says me / ours / partner.
 */
object DreamsModel {
    fun dreams(root: JSONObject, me: Role?): List<Dream> {
        val all = root.optJSONObject("dreams") ?: return emptyList()
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            val title = o.optString("title")
            if (title.isEmpty()) return@mapNotNull null
            Dream(
                key, title, o.optString("emoji").ifEmpty { "✨" }, DreamCategory.of(o.optString("cat")),
                ownerOf(o.optString("owner"), me), o.optLong("at"), o.optString("goal").ifEmpty { null }, o.optBoolean("done"),
                Picture.from(o.optJSONObject("photo")),
            )
        }.sortedByDescending { it.at }.toList()
    }

    fun goals(root: JSONObject, me: Role?): List<Goal> {
        val all = root.optJSONObject("goals") ?: return emptyList()
        return all.keys().asSequence().mapNotNull { key -> parseGoal(all.optJSONObject(key) ?: return@mapNotNull null, key, me) }
            .sortedWith(compareBy<Goal>({ it.done }, { -it.at }))
            .toList()
    }

    fun goal(root: JSONObject, key: String, me: Role?): Goal? =
        root.optJSONObject("goals")?.optJSONObject(key)?.let { parseGoal(it, key, me) }

    private fun parseGoal(o: JSONObject, key: String, me: Role?): Goal? {
        val title = o.optString("title")
        if (title.isEmpty()) return null
        val saved = o.optJSONObject("saved")
        val mineKey = me?.key ?: "me"
        val partnerKey = me?.other?.key ?: "partner"
        val steps = o.optJSONObject("steps")?.let { s ->
            s.keys().asSequence().mapNotNull { sk ->
                val so = s.optJSONObject(sk) ?: return@mapNotNull null
                val st = so.optString("title")
                if (st.isEmpty()) null else GoalStep(
                    sk, st, ownerOf(so.optString("who"), me), so.optBoolean("done"),
                    if (so.has("due")) so.optLong("due") else null, so.optLong("at"),
                )
            }.sortedWith(compareBy({ it.at }, { it.key })).toList()
        } ?: emptyList()
        return Goal(
            key, title, o.optString("emoji").ifEmpty { "⭐" }, o.optLong("at"), o.optLong("target"), o.optString("unit"),
            saved?.optLong(mineKey) ?: 0, saved?.optLong(partnerKey) ?: 0, steps, o.optString("dream").ifEmpty { null }, o.optBoolean("done"),
        )
    }

    fun dreamJson(title: String, emoji: String, category: DreamCategory, owner: Owner, at: Long, me: Role?): JSONObject = JSONObject()
        .put("title", title).put("emoji", emoji).put("cat", category.key).put("owner", ownerKey(owner, me)).put("at", at)

    fun stepJson(title: String, who: Owner, at: Long, me: Role?): JSONObject = JSONObject()
        .put("title", title).put("who", ownerKey(who, me)).put("done", false).put("at", at)

    /**
     * Days until the savings reach the target at the pace so far (from the goal's start), or null
     * when there's nothing saved yet or the target is already reached.
     */
    fun daysToTarget(goal: Goal, todayMillis: Long): Long? {
        if (!goal.hasSavings || goal.saved <= 0 || goal.saved >= goal.target) return null
        val days = ((todayMillis - goal.at) / 86_400_000L).coerceAtLeast(1)
        val perDay = goal.saved.toDouble() / days
        return Math.ceil((goal.target - goal.saved) / perDay).toLong()
    }
}

/** Ideas for "Matches", keyed i01, i02… by their place in the localized list so both phones agree. */
object Ideas {
    fun key(index: Int): String = String.format(java.util.Locale.ROOT, "i%02d", index + 1)

    fun index(key: String): Int? = key.removePrefix("i").toIntOrNull()?.minus(1)
}
