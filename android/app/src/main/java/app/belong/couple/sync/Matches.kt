package app.belong.couple.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.belong.couple.core.Ideas
import app.belong.couple.data.Account
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * "Matches": each partner secretly answers yes / no / maybe to date and life ideas; they only see
 * the ideas both said yes to. On the server a yes is votes/{seat}/{idea} = true, which the partner
 * may read only for an idea they said yes to themselves; no and maybe stay in the seat's private
 * secret/{seat}/decided. So a missing answer never tells which one it was.
 */
object Matches {
    const val YES = "yes"
    const val NO = "no"
    const val MAYBE = "maybe"

    private const val PREFS = "belong_matches"

    /** The demo partner's yeses (idea positions), so the example couple has a few matches. */
    private val DEMO_PARTNER_YES = setOf(0, 2, 3, 5, 7, 10, 12, 15, 18, 21)

    private val sender = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** My answers by idea key. */
    fun answers(context: Context): Map<String, String> {
        val o = json(context, "answers")
        return o.keys().asSequence().associateWith { o.optString(it) }
    }

    fun answer(context: Context, idea: String, value: String) {
        val app = context.applicationContext
        val answers = json(app, "answers").put(idea, value)
        val unsent = json(app, "unsent").put(idea, value)
        prefs(app).edit().putString("answers", answers.toString()).putString("unsent", unsent.toString()).apply()
        sender.execute { flush(app) }
    }

    /** Ideas we both said yes to, as last checked. */
    fun matches(context: Context): Set<String> = prefs(context).getStringSet("matches", emptySet())!!.toSet()

    fun unseen(context: Context): Set<String> = matches(context) - prefs(context).getStringSet("seen", emptySet())!!

    fun markSeen(context: Context) = prefs(context).edit().putStringSet("seen", matches(context)).apply()

    /**
     * Sends my answers and checks which of my yeses the partner shares. Calls [done] on the main
     * thread with the matches (unchanged if offline).
     */
    fun refresh(context: Context, done: (Set<String>) -> Unit) {
        val app = context.applicationContext
        sender.execute {
            flush(app)
            val account = Account.get(app)
            val seat = account.seat
            val mine = answers(app).filterValues { it == YES }.keys
            val found = if (!account.paired || seat == null) {
                mine.filter { key -> Ideas.index(key) in DEMO_PARTNER_YES }.toSet()
            } else try {
                restoreFromServer(app, seat)
                val db = Db(account.config)
                val token = account.token()
                answers(app).filterValues { it == YES }.keys.filter { key ->
                    db.get("pairs/${seat.code}/votes/${seat.role.other.key}/$key", token) == true
                }.toSet()
            } catch (e: CloudException) {
                matches(app)
            }
            prefs(app).edit().putStringSet("matches", found).apply()
            main.post { done(found) }
        }
    }

    /** Right after a yes: is it a match already? Calls [done] on the main thread. */
    fun check(context: Context, idea: String, done: (Boolean) -> Unit) {
        val app = context.applicationContext
        sender.execute {
            flush(app)
            val account = Account.get(app)
            val seat = account.seat
            val match = if (!account.paired || seat == null) {
                Ideas.index(idea) in DEMO_PARTNER_YES
            } else try {
                Db(account.config).get("pairs/${seat.code}/votes/${seat.role.other.key}/$idea", account.token()) == true
            } catch (e: CloudException) {
                false
            }
            if (match) {
                val p = prefs(app)
                p.edit()
                    .putStringSet("matches", matches(app) + idea)
                    .putStringSet("seen", p.getStringSet("seen", emptySet())!! + idea) // shown right away
                    .apply()
            }
            main.post { done(match) }
        }
    }

    /** On a new phone (no local answers yet), picks up the answers already on the server. */
    private fun restoreFromServer(app: Context, seat: Seat) {
        if (json(app, "answers").length() > 0) return
        val account = Account.get(app)
        val db = Db(account.config)
        val token = account.token()
        val restored = JSONObject()
        (db.get("pairs/${seat.code}/votes/${seat.role.key}", token) as? JSONObject)?.let { o -> o.keys().forEach { restored.put(it, YES) } }
        (db.get("pairs/${seat.code}/secret/${seat.role.key}/decided", token) as? JSONObject)?.let { o -> o.keys().forEach { restored.put(it, o.optString(it)) } }
        prefs(app).edit().putString("answers", restored.toString()).apply()
    }

    private fun flush(app: Context) {
        val account = Account.get(app)
        val seat = account.seat ?: return
        if (!account.paired) return
        val db = Db(account.config)
        val unsent = json(app, "unsent")
        for (idea in unsent.keys().asSequence().toList()) {
            val value = unsent.optString(idea)
            try {
                val token = account.token()
                val yes = "pairs/${seat.code}/votes/${seat.role.key}/$idea"
                val other = "pairs/${seat.code}/secret/${seat.role.key}/decided/$idea"
                if (value == YES) {
                    db.put(yes, true, token)
                    db.delete(other, token)
                } else {
                    db.put(other, value, token)
                    db.delete(yes, token)
                }
            } catch (e: CloudException) {
                if (e.reason != Reason.DENIED) return
            }
            val left = json(app, "unsent")
            if (left.optString(idea) == value) left.remove(idea)
            prefs(app).edit().putString("unsent", left.toString()).apply()
        }
    }

    fun reset(context: Context) = prefs(context.applicationContext).edit().clear().apply()

    private fun json(context: Context, key: String): JSONObject = try {
        JSONObject(prefs(context).getString(key, "{}")!!)
    } catch (e: org.json.JSONException) {
        JSONObject()
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
