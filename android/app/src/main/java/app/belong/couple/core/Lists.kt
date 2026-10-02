package app.belong.couple.core

/** Who something belongs to: me, both of us, or my partner. */
enum class Owner(val key: String) {
    ME("me"),
    OURS("ours"),
    PARTNER("partner");

    companion object {
        fun of(key: String?): Owner = entries.firstOrNull { it.key == key } ?: ME
    }
}

/** [key] names the task on the server once the plan is shared with a partner. */
data class Task(val id: Long, val title: String, val owner: Owner, val done: Boolean, val day: Long, val key: String = "")

object TaskList {
    /**
     * Today's plan: today's tasks plus anything left unfinished on earlier days, which rolls over.
     * Open tasks come first, then mine, ours and the partner's, in the order they were added (keys sort by time).
     */
    fun forDay(all: List<Task>, today: Long): List<Task> =
        all.asSequence()
            .filter { it.day == today || (it.day < today && !it.done) }
            .map { if (it.day < today) it.copy(day = today) else it }
            .sortedWith(compareBy<Task>({ it.done }, { it.owner.ordinal }, { it.key }, { it.id }))
            .toList()

    /** Drops finished tasks from earlier days so the stored list doesn't grow forever. */
    fun prune(all: List<Task>, today: Long): List<Task> = all.filterNot { it.done && it.day < today }

    fun doneCount(tasks: List<Task>): Int = tasks.count { it.done }
}

data class WishItem(
    val id: Long,
    val owner: Owner,
    val title: String,
    val price: String,
    val link: String,
    val note: String,
    val reserved: Boolean,
    val createdAt: Long,
    /** Names the wish on the server once the lists are shared with a partner. */
    val key: String = "",
)

/** [key] is the server key once the chat is shared with a partner; [pending] means it hasn't reached the server yet. */
data class ChatMessage(
    val id: Long,
    val fromMe: Boolean,
    val text: String,
    val at: Long,
    val hearted: Boolean,
    val key: String = "",
    val pending: Boolean = false,
)

object Links {
    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")
    private val HOST = Regex("^[^\\s/?#]+\\.[^\\s/?#]{2,}")

    /** A web link that is safe to open, or null. Adds https:// when the scheme is missing. */
    fun safeUrl(input: String): String? {
        val text = input.trim()
        if (text.isEmpty() || text.any { it.isWhitespace() }) return null
        val url = if (SCHEME.containsMatchIn(text)) text else "https://$text"
        val lower = url.lowercase()
        if (!lower.startsWith("https://") && !lower.startsWith("http://")) return null
        val rest = url.substringAfter("://")
        return if (HOST.containsMatchIn(rest)) url else null
    }
}
