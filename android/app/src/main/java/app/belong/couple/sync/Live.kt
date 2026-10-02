package app.belong.couple.sync

import app.belong.couple.core.Owner
import app.belong.couple.core.Role
import app.belong.couple.core.Task
import org.json.JSONObject

/** Any part of the database kept in step with the event stream's "put" and "patch" events. */
class JsonTree {
    var root = JSONObject()
        private set

    fun apply(event: String, data: String) {
        val o = JSONObject(data)
        val path = split(o.optString("path", "/"))
        val value = o.opt("data").takeUnless { it == JSONObject.NULL }
        when (event) {
            "put" -> put(path, value)
            "patch" -> (value as? JSONObject)?.let { patch ->
                patch.keys().forEach { k -> put(path + split(k), patch.opt(k).takeUnless { it == JSONObject.NULL }) }
            }
        }
    }

    private fun split(path: String) = path.split('/').filter { it.isNotEmpty() }

    private fun put(path: List<String>, value: Any?) {
        if (path.isEmpty()) {
            root = value as? JSONObject ?: JSONObject()
            return
        }
        var node = root
        for (part in path.dropLast(1)) {
            node = node.optJSONObject(part) ?: if (value == null) return else JSONObject().also { node.put(part, it) }
        }
        if (value == null) node.remove(path.last()) else node.put(path.last(), value)
    }

    fun obj(vararg path: String): JSONObject? {
        var node: JSONObject? = root
        for (part in path) node = node?.optJSONObject(part)
        return node
    }
}

/** A partner's mood and energy check-in. */
data class CheckIn(val mood: Int, val energy: Int, val at: Long)

/** The last "thinking of you", "I'm safe" or "support" tap a partner sent. */
data class Signal(val kind: String, val at: Long, val id: String)

/**
 * The pair's "Today" as stored under pairs/{code}/live:
 * checkin/{role}, signal/{role}, count/{role}/{yyyy-MM}/{kind} and tasks/{key}.
 * Tasks are stored with the seat that owns them ("a", "b" or "both"), so each phone shows them as its own or the partner's.
 */
object LiveModel {
    const val THINK = "think"
    const val SAFE = "safe"
    const val SUPPORT = "support"
    const val DOODLE = "doodle"

    fun checkIn(tree: JsonTree, role: Role): CheckIn? {
        val o = tree.obj("checkin", role.key) ?: return null
        val mood = o.optInt("mood")
        val energy = o.optInt("energy")
        return if (mood in 1..5 && energy in 1..5) CheckIn(mood, energy, o.optLong("at")) else null
    }

    fun signal(tree: JsonTree, role: Role): Signal? {
        val o = tree.obj("signal", role.key) ?: return null
        val id = o.optString("id")
        return if (id.isEmpty()) null else Signal(o.optString("kind"), o.optLong("at"), id)
    }

    fun count(tree: JsonTree, role: Role, month: String, kind: String): Int =
        tree.obj("count", role.key, month)?.optInt(kind) ?: 0

    fun tasks(tree: JsonTree, me: Role): List<Task> {
        val all = tree.obj("tasks") ?: return emptyList()
        return all.keys().asSequence().mapNotNull { key ->
            val o = all.optJSONObject(key) ?: return@mapNotNull null
            val title = o.optString("title")
            if (title.isEmpty() || !o.has("day")) return@mapNotNull null
            Task(ChatFeed.idFor(key), title, ownerOf(o.optString("owner"), me), o.optBoolean("done"), o.optLong("day"), key)
        }.toList()
    }

    fun taskJson(task: Task, me: Role): JSONObject = JSONObject()
        .put("title", task.title)
        .put("owner", ownerKey(task.owner, me))
        .put("done", task.done)
        .put("day", task.day)

    fun ownerOf(key: String, me: Role): Owner = when (key) {
        me.key -> Owner.ME
        me.other.key -> Owner.PARTNER
        else -> Owner.OURS
    }

    fun ownerKey(owner: Owner, me: Role): String = when (owner) {
        Owner.ME -> me.key
        Owner.PARTNER -> me.other.key
        Owner.OURS -> "both"
    }

    /**
     * The plan this phone shows: the server's tasks, with local edits that haven't reached it yet
     * on top ([dirty] keys use the local version, [deleted] keys are left out).
     */
    fun mergeTasks(server: List<Task>, local: List<Task>, dirty: Set<String>, deleted: Set<String>): List<Task> {
        val mine = local.filter { it.key in dirty }.associateBy { it.key }
        val fromServer = server.filter { it.key !in deleted && it.key !in mine }
        return (fromServer + mine.values).sortedBy { it.key }
    }
}
