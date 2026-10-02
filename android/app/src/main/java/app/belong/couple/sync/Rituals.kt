package app.belong.couple.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.belong.couple.R
import app.belong.couple.core.DailyQuestions
import app.belong.couple.core.Letter
import app.belong.couple.core.LettersModel
import app.belong.couple.core.QuizModel
import app.belong.couple.core.seatKey
import app.belong.couple.data.Account
import app.belong.couple.data.SharedRepo
import app.belong.couple.ui.DreamsScreen
import org.json.JSONObject
import java.util.concurrent.Executors

private val worker = Executors.newSingleThreadExecutor()
private val main = Handler(Looper.getMainLooper())

private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("belong_rituals", Context.MODE_PRIVATE)

/**
 * "Question of the day". Answers live at answers/{day}/{seat}; the database lets the partner read
 * yours only once they have answered too, so nobody can peek first.
 */
object DayQuestion {

    fun mine(context: Context, day: Long): String? = prefs(context).getString("q_mine_$day", null)

    fun cachedPartner(context: Context, day: Long): String? = prefs(context).getString("q_partner_$day", null)

    /** Saves my answer and sends it. Calls [done] on the main thread with whether the server has it. */
    fun answer(context: Context, day: Long, text: String, done: (Boolean) -> Unit) {
        val app = context.applicationContext
        prefs(app).edit().putString("q_mine_$day", text).apply()
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) return done(true)
        worker.execute {
            val ok = try {
                Db(account.config).put("pairs/${seat.code}/answers/$day/${seat.role.key}", JSONObject().put("text", text).put("at", Db.serverTime()), account.token())
                true
            } catch (e: CloudException) {
                false
            }
            if (ok) SharedRepo(app).put("flags/question/$day/${seat.role.key}", true)
            main.post { done(ok) }
        }
    }

    /** The partner's answer, readable once I've answered; null if they haven't answered yet. */
    fun partner(context: Context, day: Long, done: (String?) -> Unit) {
        val app = context.applicationContext
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) {
            val demo = app.resources.getStringArray(R.array.demo_answers)
            return done(demo[DailyQuestions.index(day, demo.size)])
        }
        worker.execute {
            val text = try {
                (Db(account.config).get("pairs/${seat.code}/answers/$day/${seat.role.other.key}", account.token()) as? JSONObject)?.optString("text")
            } catch (e: CloudException) {
                cachedPartner(app, day)
            }
            if (text != null) prefs(app).edit().putString("q_partner_$day", text).apply()
            main.post { done(text) }
        }
    }
}

/**
 * "How well do you know me?": each week both partners answer ten questions about themselves and
 * guess the other's answers. A finished round at quiz/{round}/{seat} becomes readable to the
 * partner only once they have finished theirs, so nobody can copy.
 */
object Quiz {
    data class Entry(val self: Map<Int, Int>, val guess: Map<Int, Int>, val done: Boolean) {
        fun toJson(): JSONObject = JSONObject()
            .put("self", QuizModel.answersJson(self)).put("guess", QuizModel.answersJson(guess)).put("done", done)

        companion object {
            fun from(o: JSONObject?): Entry? = o?.let { Entry(QuizModel.answers(it.optJSONObject("self")), QuizModel.answers(it.optJSONObject("guess")), it.optBoolean("done")) }
        }
    }

    fun mine(context: Context, round: Long): Entry =
        prefs(context).getString("quiz_$round", null)?.let { Entry.from(JSONObject(it)) } ?: Entry(emptyMap(), emptyMap(), false)

    fun save(context: Context, round: Long, entry: Entry) = prefs(context).edit().putString("quiz_$round", entry.toJson().toString()).apply()

    /** Sends a finished round. Calls [done] on the main thread with whether the server has it. */
    fun submit(context: Context, round: Long, entry: Entry, done: (Boolean) -> Unit) {
        val app = context.applicationContext
        val finished = entry.copy(done = true)
        save(app, round, finished)
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) return done(true)
        worker.execute {
            val ok = try {
                Db(account.config).put("pairs/${seat.code}/quiz/$round/${seat.role.key}", finished.toJson(), account.token())
                true
            } catch (e: CloudException) {
                false
            }
            if (ok) SharedRepo(app).put("flags/quiz/$round/${seat.role.key}", true)
            main.post { done(ok) }
        }
    }

    /** The partner's finished round, once mine is finished too; null while they're still playing. */
    fun partner(context: Context, round: Long, done: (Entry?) -> Unit) {
        val app = context.applicationContext
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) return done(demoPartner(round))
        worker.execute {
            val entry = try {
                Entry.from(Db(account.config).get("pairs/${seat.code}/quiz/$round/${seat.role.other.key}", account.token()) as? JSONObject)
                    ?.takeIf { it.done }
            } catch (e: CloudException) {
                null
            }
            main.post { done(entry) }
        }
    }

    /** The demo partner answers at random, but the same way every time for a given week. */
    private fun demoPartner(round: Long): Entry {
        val random = java.util.Random(round)
        val self = (0 until QuizModel.PER_ROUND).associateWith { random.nextInt(4) }
        val guess = (0 until QuizModel.PER_ROUND).associateWith { random.nextInt(4) }
        return Entry(self, guess, true)
    }

    fun partnerSeat(me: app.belong.couple.core.Role?) = seatKey(me, mine = false)
}

/**
 * Notes about feelings after a quarrel. Each of you writes what happened, what you feel, what you
 * need and what you'd ask for. The note lives at feelings/{key}/{seat}; the database lets the
 * partner read it only once they've written their own, so both speak first and listen second.
 * live/feelings/{key} only says who has written.
 */
object Feelings {
    data class Note(val what: String, val feel: String, val need: String, val ask: String) {
        fun toJson(): JSONObject = JSONObject().put("what", what).put("feel", feel).put("need", need).put("ask", ask)

        companion object {
            fun from(o: JSONObject?): Note? = o?.takeIf { it.has("feel") }?.let { Note(it.optString("what"), it.optString("feel"), it.optString("need"), it.optString("ask")) }
        }
    }

    fun mine(context: Context, key: String): Note? = prefs(context).getString("feel_mine_$key", null)?.let { Note.from(JSONObject(it)) }

    /** Saves my side of [key] (a new note when [title] is given) and sends it. [done] gets whether the server has it. */
    fun write(context: Context, key: String, title: String?, note: Note, done: (Boolean) -> Unit) {
        val app = context.applicationContext
        prefs(app).edit().putString("feel_mine_$key", note.toJson().toString()).apply()
        val repo = SharedRepo(app)
        val me = seatKey(repo.me, mine = true)
        fun record() {
            if (title != null) {
                repo.put("feelings/$key", JSONObject().put("by", me).put("at", System.currentTimeMillis()).put("title", title.take(80)).put("wrote", JSONObject().put(me, true)))
            } else {
                repo.put("feelings/$key/wrote/$me", true)
            }
        }
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) {
            record()
            // The example partner answers a moment later, so the demo shows both sides.
            if (title != null) main.postDelayed({ repo.put("feelings/$key/wrote/partner", true) }, 1500)
            return done(true)
        }
        worker.execute {
            val ok = try {
                Db(account.config).put("pairs/${seat.code}/feelings/$key/${seat.role.key}", note.toJson().put("at", Db.serverTime()), account.token())
                true
            } catch (e: CloudException) {
                false
            }
            main.post {
                if (ok) record()
                done(ok)
            }
        }
    }

    /** The partner's side, readable once mine is written; null if they haven't written yet. */
    fun partner(context: Context, key: String, done: (Note?) -> Unit) {
        val app = context.applicationContext
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) {
            val (what, feel, need, ask) = app.getString(R.string.feelings_demo).split('|', limit = 4)
            return done(Note(what, feel, need, ask))
        }
        prefs(app).getString("feel_partner_$key", null)?.let { return done(Note.from(JSONObject(it))) }
        worker.execute {
            val note = try {
                Note.from(Db(account.config).get("pairs/${seat.code}/feelings/$key/${seat.role.other.key}", account.token()) as? JSONObject)
            } catch (e: CloudException) {
                null
            }
            if (note != null) prefs(app).edit().putString("feel_partner_$key", note.toJson().toString()).apply()
            main.post { done(note) }
        }
    }
}

/**
 * Letters "open when…". The text goes to letters/{key}, which the database lets the partner read only
 * from the day it opens (or at any time for a "when you're sad" letter); live/letters/{key} only says
 * when, from whom and whether it's been opened.
 */
object Letters {
    private fun cacheKey(key: String) = "letter_text_$key"

    /** Seals a new letter. [done] gets whether the server has it (always true for the example couple). */
    fun write(context: Context, kind: Letter.Kind, title: String, openAt: Long?, text: String, done: (Boolean) -> Unit) {
        val app = context.applicationContext
        val key = DreamsScreen.newKey()
        prefs(app).edit().putString(cacheKey(key), text).apply()
        val repo = SharedRepo(app)
        val meta = LettersModel.metaJson(seatKey(repo.me, mine = true), kind, title.take(80), openAt, System.currentTimeMillis())
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) {
            repo.put("letters/$key", meta)
            return done(true)
        }
        worker.execute {
            val ok = try {
                Db(account.config).put("pairs/${seat.code}/letters/$key", JSONObject().put("by", seat.role.key).put("text", text).put("at", Db.serverTime()), account.token())
                true
            } catch (e: CloudException) {
                false
            }
            main.post {
                if (ok) repo.put("letters/$key", meta)
                done(ok)
            }
        }
    }

    /** The letter's text: mine always, the partner's once it may be opened. Null if it can't be read (yet). */
    fun text(context: Context, key: String, done: (String?) -> Unit) {
        val app = context.applicationContext
        prefs(app).getString(cacheKey(key), null)?.let { return done(it) }
        val account = Account.get(app)
        val seat = account.seat
        if (!account.paired || seat == null) return done(null)
        worker.execute {
            val text = try {
                (Db(account.config).get("pairs/${seat.code}/letters/$key", account.token()) as? JSONObject)?.optString("text")?.takeIf { it.isNotEmpty() }
            } catch (e: CloudException) {
                null
            }
            if (text != null) prefs(app).edit().putString(cacheKey(key), text).apply()
            main.post { done(text) }
        }
    }

    fun markOpened(context: Context, key: String) = SharedRepo(context).put("letters/$key/opened", true)

    /** Takes back one of my letters. */
    fun delete(context: Context, key: String) {
        val app = context.applicationContext
        SharedRepo(app).delete("letters/$key")
        prefs(app).edit().remove(cacheKey(key)).apply()
        val account = Account.get(app)
        val seat = account.seat ?: return
        if (!account.paired) return
        worker.execute {
            try {
                Db(account.config).delete("pairs/${seat.code}/letters/$key", account.token())
            } catch (e: CloudException) {
                // The description is gone already; the text stays unreadable without it.
            }
        }
    }

    /** The example couple's letters: "kind|days from now|by|title|text". */
    fun seedDemo(context: Context, seeds: List<String>) {
        val app = context.applicationContext
        val repo = SharedRepo(app)
        val now = System.currentTimeMillis()
        val today = java.time.LocalDate.now(java.time.ZoneId.systemDefault())
        seeds.forEachIndexed { i, line ->
            val (kind, days, by, title, text) = line.split('|', limit = 5)
            val key = "demo-l$i"
            val k = if (kind == "when") Letter.Kind.WHEN else Letter.Kind.DATE
            val openAt = if (k == Letter.Kind.DATE) openAtFor(today.plusDays(days.toLong())) else null
            prefs(app).edit().putString(cacheKey(key), text).apply()
            repo.put("letters/$key", LettersModel.metaJson(by, k, title, openAt, now - (i + 1) * 86_400_000L))
        }
    }

    /** A dated letter opens at the start of its day on the writer's phone. */
    fun openAtFor(day: java.time.LocalDate): Long = day.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
}
