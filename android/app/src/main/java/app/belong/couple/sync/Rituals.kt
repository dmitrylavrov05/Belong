package app.belong.couple.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.belong.couple.R
import app.belong.couple.core.DailyQuestions
import app.belong.couple.core.QuizModel
import app.belong.couple.core.seatKey
import app.belong.couple.data.Account
import app.belong.couple.data.SharedRepo
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
