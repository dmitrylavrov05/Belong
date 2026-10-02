package app.belong.couple.sync

import app.belong.couple.core.ChatMessage
import app.belong.couple.core.Role
import org.json.JSONObject

/**
 * The pair's chat as the server sees it, kept up to date from the database event stream.
 * Each message is stored under its key as {from, text?, photo?, voice?, dur?, at, heart}.
 */
class ChatFeed {
    private val messages = HashMap<String, JSONObject>()

    val keys: Set<String> get() = messages.keys

    /** Applies one "put" or "patch" event; [data] is the event's JSON: {"path": "/…", "data": …}. */
    fun apply(event: String, data: String) {
        val o = JSONObject(data)
        val parts = o.optString("path", "/").split('/').filter { it.isNotEmpty() }
        val value = o.opt("data").takeUnless { it == JSONObject.NULL }
        when (event) {
            "put" -> put(parts, value)
            "patch" -> (value as? JSONObject)?.let { patch ->
                patch.keys().forEach { k -> put(parts + k.split('/').filter { it.isNotEmpty() }, patch.opt(k).takeUnless { it == JSONObject.NULL }) }
            }
        }
    }

    private fun put(parts: List<String>, value: Any?) {
        when (parts.size) {
            0 -> {
                messages.clear()
                (value as? JSONObject)?.let { all -> all.keys().forEach { k -> all.optJSONObject(k)?.let { messages[k] = it } } }
            }
            1 -> if (value is JSONObject) messages[parts[0]] = value else messages.remove(parts[0])
            else -> {
                val message = messages[parts[0]] ?: return
                if (value == null) message.remove(parts[1]) else message.put(parts[1], value)
            }
        }
    }

    /** Messages as this phone shows them, oldest first. */
    fun toList(me: Role): List<ChatMessage> =
        messages.entries
            .filter { (_, m) -> m.has("from") && (m.has("text") || m.has("photo") || m.has("voice")) }
            .map { (key, m) ->
                ChatMessage(
                    id = idFor(key),
                    fromMe = m.optString("from") == me.key,
                    text = m.optString("text"),
                    at = m.optLong("at"),
                    hearted = m.optBoolean("heart"),
                    key = key,
                    photo = m.optString("photo").ifEmpty { null },
                    voice = m.optString("voice").ifEmpty { null },
                    dur = m.optInt("dur"),
                )
            }
            .sortedWith(compareBy({ it.at }, { it.key }))

    companion object {
        /** A stable local id for a server key. */
        fun idFor(key: String): Long = key.fold(1125899906842597L) { h, c -> 31 * h + c.code }

        /** A key that sorts by time and won't collide between the two phones. */
        fun newKey(now: Long, random: java.util.Random): String {
            val alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
            return now.toString(36).padStart(9, '0') + buildString { repeat(8) { append(alphabet[random.nextInt(alphabet.length)]) } }
        }
    }
}
