package app.belong.couple.data

import android.content.Context
import app.belong.couple.R
import app.belong.couple.core.MoviesModel
import app.belong.couple.core.Role
import app.belong.couple.sync.JsonTree
import app.belong.couple.sync.Letters
import app.belong.couple.sync.LiveSync
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/**
 * The pair's shared things that both can edit: dreams, goals, the shopping list, evening notes,
 * memories and the date you got together. For a pair: the server's copy plus changes not sent yet
 * (an ordered queue of put / delete / add operations, so offline edits and money added on both
 * phones all count). In demo mode the changes go straight into the example couple's copy here.
 */
class SharedRepo(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** This phone's seat, or null for the demo couple (whose data says me / ours / partner). */
    val me: Role? get() = Account.get(app).takeIf { it.paired }?.seat?.role

    /** Everything as this phone should show it: { dreams: {...}, goals: {...}, shopping: {...}, ... }. */
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

    /** The server's latest copy of the sections this repo shows (see [SECTIONS]). */
    fun setBase(live: JSONObject) = synchronized(lock) {
        val root = JSONObject()
        for (section in SECTIONS) live.optJSONObject(section)?.let { root.put(section, JSONObject(it.toString())) }
        prefs.edit().putString("base", root.toString()).apply()
    }

    // ---------- Example couple ----------

    fun ensureSeeded() {
        seedDreams()
        seedEveryday()
        seedCalendar()
        seedPhotos()
        seedLetters()
    }

    /** Letters and a film list for the example couple. */
    private fun seedLetters() {
        if (prefs.getBoolean("seeded_letters", false)) return
        prefs.edit().putBoolean("seeded_letters", true).apply()
        if (me != null) return
        Letters.seedDemo(app, app.resources.getStringArray(R.array.letter_seeds).toList())
        val now = System.currentTimeMillis()
        app.resources.getStringArray(R.array.movie_seeds).forEachIndexed { i, line ->
            val (kind, by, rates, tmdb, genres, year, title) = line.split('|', limit = 7).let { p -> Seed(p[0], p[1], p[2], p[3], p[4], p[5], p[6]) }
            val movie = MoviesModel.json(title, kind == "series", by, now - (i + 1) * 3_600_000L)
                .put("tmdb", tmdb.toInt()).put("genres", genres).put("year", year.toInt())
            if (rates.isNotEmpty()) {
                val (mine, theirs) = rates.split(',')
                movie.put("watched", true).put("watchedAt", now - (i + 1) * 86_400_000L)
                val rate = JSONObject()
                mine.toIntOrNull()?.let { rate.put("me", it) }
                theirs.toIntOrNull()?.let { rate.put("partner", it) }
                movie.put("rate", rate)
            }
            put("movies/demo-f$i", movie)
        }
    }

    /** A few photos of the day for the example couple, so the gallery and the month report aren't empty. */
    private fun seedPhotos() {
        if (prefs.getBoolean("seeded_photos", false)) return
        prefs.edit().putBoolean("seeded_photos", true).apply()
        if (me == null) DayPhotos.seedDemo(app, app.resources.getStringArray(R.array.photo_seeds).toList())
    }

    /** The example couple lives apart and has a few dates in the calendar. */
    private fun seedCalendar() {
        if (prefs.getBoolean("seeded_calendar", false)) return
        if (me != null) {
            prefs.edit().putBoolean("seeded_calendar", true).apply()
            return
        }
        val now = System.currentTimeMillis()
        val today = LocalDate.now(ZoneId.systemDefault())
        val dates = JSONObject()
        app.resources.getStringArray(R.array.date_seeds).forEachIndexed { i, line ->
            val (emoji, yearsAgo, monthDay, title) = line.split('|', limit = 4)
            val (m, d) = monthDay.split('-').map { it.toInt() }
            val day = LocalDate.of(today.year - yearsAgo.toInt(), m, d).toEpochDay()
            dates.put("demo-d$i", JSONObject().put("title", title).put("emoji", emoji).put("day", day).put("yearly", true).put("at", now))
        }
        synchronized(lock) {
            val tree = JsonTree(base())
            tree.set("dates", dates)
            tree.set("couple/apart", true)
            tree.set("couple/meeting", CoupleStore.get(app).localMeeting.toEpochDay())
            prefs.edit().putBoolean("seeded_calendar", true).putString("base", tree.root.toString()).apply()
        }
    }

    private fun seedDreams() {
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

    /** The example couple's shopping list, evening note, memories and anniversary. */
    private fun seedEveryday() {
        if (prefs.getBoolean("seeded_everyday", false)) return
        if (me != null) {
            prefs.edit().putBoolean("seeded_everyday", true).apply()
            return
        }
        val now = System.currentTimeMillis()
        val today = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
        val shopping = JSONObject()
        app.resources.getStringArray(R.array.shopping_seeds).forEachIndexed { i, line ->
            val (who, done, title) = line.split('|', limit = 3)
            shopping.put("demo-s$i", JSONObject().put("title", title).put("by", who).put("done", done == "1").put("at", now - (10 - i) * 60_000L))
        }
        val (title, text) = app.getString(R.string.moment_seed).split('|', limit = 2)
        val moments = JSONObject().put("demo-m0", JSONObject().put("title", title).put("text", text).put("day", today - 365).put("at", now))
        synchronized(lock) {
            val tree = JsonTree(base())
            tree.set("shopping", shopping)
            tree.set("moments", moments)
            tree.set("couple/since", today - 960)
            tree.set("thanks/${today - 1}/partner", JSONObject().put("text", app.getString(R.string.thanks_seed)).put("at", now - 12 * 3600_000L))
            tree.set("flags/question/$today/partner", true)
            // The northern lights came true last March: something for the chronicle.
            if (tree.obj("dreams", "demo-4") != null) {
                tree.set("dreams/demo-4/done", true)
                tree.set("dreams/demo-4/doneAt", now - 200L * 86_400_000L)
            }
            prefs.edit().putBoolean("seeded_everyday", true).putString("base", tree.root.toString()).apply()
        }
    }

    /** A real pair starts with an empty map; the server fills it in. */
    fun startReal() = prefs.edit().putBoolean("seeded", true).putBoolean("seeded_everyday", true).putBoolean("seeded_calendar", true).putBoolean("seeded_photos", true).putBoolean("seeded_letters", true).remove("base").remove("ops").apply()

    private fun base(): JSONObject = try {
        JSONObject(prefs.getString("base", "{}")!!)
    } catch (e: JSONException) {
        JSONObject()
    }

    /** One line of an example list, split up. */
    private data class Seed(val a: String, val b: String, val c: String, val d: String, val e: String, val f: String, val g: String)

    companion object {
        private const val PREFS = "belong_dreams"

        /** Parts of live/ kept here; the rest (check-ins, tasks, wishes…) have their own stores. */
        val SECTIONS = listOf("dreams", "goals", "shopping", "thanks", "flags", "couple", "moments", "dates", "photos", "feelings", "letters", "movies")
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
