package app.belong.couple.data

import android.content.Context
import app.belong.couple.R
import app.belong.couple.core.Role
import app.belong.couple.sync.JsonTree
import app.belong.couple.sync.LiveSync
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/**
 * Dreams and goals. For a pair: the server's copy plus changes not sent yet (an ordered queue of
 * put / delete / add operations, so offline edits and money added on both phones all count).
 * In demo mode the changes go straight into the example couple's copy on this phone.
 */
class DreamsRepo(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** This phone's seat, or null for the demo couple (whose data says me / ours / partner). */
    val me: Role? get() = Account.get(app).takeIf { it.paired }?.seat?.role

    /** Everything as this phone should show it: { dreams: {...}, goals: {...} }. */
    fun root(): JSONObject = synchronized(lock) {
        val tree = JsonTree(base())
        ops().forEach { apply(tree, it) }
        tree.root
    }

    fun put(path: String, value: Any) = change(JSONObject().put("op", "put").put("path", path).put("value", value))

    fun delete(path: String) = change(JSONObject().put("op", "del").put("path", path))

    /** Adds money to a goal; the server adds it to whatever the other phone added meanwhile. */
    fun add(path: String, amount: Long) = change(JSONObject().put("op", "add").put("path", path).put("value", amount))

    private fun change(op: JSONObject) {
        synchronized(lock) {
            if (me == null) {
                val tree = JsonTree(base())
                apply(tree, op)
                prefs.edit().putString("base", tree.root.toString()).apply()
            } else {
                prefs.edit().putString("ops", JSONArray(ops().map { it } + op).toString()).apply()
            }
        }
        DataEvents.changed()
        if (me != null) LiveSync.flushSoon(app)
    }

    // ---------- For LiveSync ----------

    fun ops(): List<JSONObject> = synchronized(lock) {
        try {
            val array = JSONArray(prefs.getString("ops", "[]"))
            (0 until array.length()).mapNotNull { array.optJSONObject(it) }
        } catch (e: JSONException) {
            emptyList()
        }
    }

    /** Drops the oldest operation once the server has it (or refused it). */
    fun sent(op: JSONObject) = synchronized(lock) {
        val rest = ops()
        if (rest.firstOrNull()?.toString() == op.toString()) prefs.edit().putString("ops", JSONArray(rest.drop(1)).toString()).apply()
    }

    /** The server's latest copy of dreams and goals. */
    fun setBase(dreams: JSONObject?, goals: JSONObject?) = synchronized(lock) {
        val root = JSONObject()
        dreams?.let { root.put("dreams", JSONObject(it.toString())) }
        goals?.let { root.put("goals", JSONObject(it.toString())) }
        prefs.edit().putString("base", root.toString()).apply()
    }

    // ---------- Example couple ----------

    fun ensureSeeded() {
        if (prefs.getBoolean("seeded", false)) return
        val now = System.currentTimeMillis()
        val dreams = JSONObject()
        app.resources.getStringArray(R.array.dream_seeds).forEachIndexed { i, line ->
            val (emoji, cat, owner, title) = line.split('|', limit = 4)
            val dream = JSONObject().put("title", title).put("emoji", emoji).put("cat", cat).put("owner", owner).put("at", now - i * 60_000L)
            if (i == 0) dream.put("goal", "demo-goal")
            dreams.put("demo-$i", dream)
        }
        val (target, mine, partner, unit) = app.getString(R.string.goal_seed_money).split('|')
        val today = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
        val steps = JSONObject()
        app.resources.getStringArray(R.array.goal_seed_steps).forEachIndexed { i, line ->
            val (who, done, due, title) = line.split('|', limit = 4)
            val step = JSONObject().put("title", title).put("who", who).put("done", done == "1").put("at", i.toLong())
            due.toLongOrNull()?.let { step.put("due", today + it) }
            steps.put("s$i", step)
        }
        val goal = JSONObject()
            .put("title", app.getString(R.string.goal_seed_title)).put("emoji", "🌸")
            .put("at", now - 200L * 86_400_000L).put("target", target.toLong()).put("unit", unit).put("dream", "demo-0")
            .put("saved", JSONObject().put("me", mine.toLong()).put("partner", partner.toLong()))
            .put("steps", steps)
        val root = JSONObject().put("dreams", dreams).put("goals", JSONObject().put("demo-goal", goal))
        prefs.edit().putBoolean("seeded", true).putString("base", root.toString()).apply()
    }

    /** A real pair starts with an empty map; the server fills it in. */
    fun startReal() = prefs.edit().putBoolean("seeded", true).remove("base").remove("ops").apply()

    private fun base(): JSONObject = try {
        JSONObject(prefs.getString("base", "{}")!!)
    } catch (e: JSONException) {
        JSONObject()
    }

    companion object {
        private const val PREFS = "belong_dreams"
        private val lock = Any()

        fun apply(tree: JsonTree, op: JSONObject) {
            val path = op.optString("path")
            when (op.optString("op")) {
                "put" -> tree.set(path, op.opt("value"))
                "del" -> tree.set(path, null)
                "add" -> tree.add(path, op.optLong("value"))
            }
        }
    }
}
