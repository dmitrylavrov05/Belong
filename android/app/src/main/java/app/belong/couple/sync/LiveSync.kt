package app.belong.couple.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import app.belong.couple.R
import app.belong.couple.core.Task
import app.belong.couple.data.Account
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.data.DataEvents
import app.belong.couple.data.TaskRepo
import app.belong.couple.widget.Widgets
import org.json.JSONObject
import java.security.SecureRandom
import java.time.LocalDate
import java.time.YearMonth
import java.util.concurrent.Executors

/**
 * Shares "Today" with the partner: both check-ins, "thinking of you" / "I'm safe" / support taps
 * with this month's counts, and the plan for the day. Local changes are saved first and sent
 * when the network allows; unsent ones are remembered across restarts.
 */
object LiveSync {
    private const val PREFS = "belong_sync"

    private val lock = Any()
    private val sender = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val random = SecureRandom()
    private var tree = JsonTree()

    private val loop = StreamLoop(
        name = "live-sync",
        path = { "pairs/${it.code}/live" },
        onConnect = { app, _ ->
            tree = JsonTree()
            sender.execute { flush(app) }
        },
        onEvent = { app, seat, event, data ->
            tree.apply(event, data)
            merge(app, seat)
        },
    )

    fun start(context: Context) = loop.start(context)

    fun stop() = loop.stop()

    // ---------- Changes made on this phone ----------

    fun checkIn(context: Context, mood: Int, energy: Int) {
        val app = context.applicationContext
        CoupleStore.get(app).setMyCheckIn(mood, energy)
        if (!Account.get(app).paired) return
        prefs(app).edit().putBoolean("checkin_dirty", true).apply()
        sender.execute { flush(app) }
    }

    /** Sends a "think", "safe" or "support" tap. Calls [done] on the main thread with whether it reached the server. */
    fun signal(context: Context, kind: String, done: (Boolean) -> Unit) {
        val app = context.applicationContext
        val account = Account.get(app)
        val seat = account.seat ?: return done(false)
        sender.execute {
            val ok = try {
                val db = Db(account.config)
                val token = account.token()
                val id = ChatFeed.newKey(System.currentTimeMillis(), random)
                db.put("pairs/${seat.code}/live/signal/${seat.role.key}", JSONObject().put("kind", kind).put("at", Db.serverTime()).put("id", id), token)
                db.put("pairs/${seat.code}/live/count/${seat.role.key}/${YearMonth.now()}/$kind", JSONObject().put(".sv", JSONObject().put("increment", 1)), token)
                true
            } catch (e: CloudException) {
                false
            }
            main.post { done(ok) }
        }
    }

    fun taskChanged(context: Context, key: String) = mark(context.applicationContext, key, removed = false)

    fun taskRemoved(context: Context, key: String) = mark(context.applicationContext, key, removed = true)

    private fun mark(app: Context, key: String, removed: Boolean) {
        if (!Account.get(app).paired) return
        synchronized(lock) {
            val p = prefs(app)
            val dirty = p.getStringSet("tasks_dirty", emptySet())!!.toMutableSet()
            val deleted = p.getStringSet("tasks_deleted", emptySet())!!.toMutableSet()
            if (removed) {
                dirty -= key
                deleted += key
            } else {
                dirty += key
            }
            p.edit().putStringSet("tasks_dirty", dirty).putStringSet("tasks_deleted", deleted).apply()
        }
        sender.execute { flush(app) }
    }

    /** Forgets unsent changes, e.g. after signing out. */
    fun reset(context: Context) = prefs(context.applicationContext).edit().clear().apply()

    // ---------- Sending ----------

    private fun flush(app: Context) {
        val account = Account.get(app)
        val seat = account.seat ?: return
        val db = Db(account.config)
        val live = "pairs/${seat.code}/live"
        try {
            val p = prefs(app)
            if (p.getBoolean("checkin_dirty", false)) {
                val store = CoupleStore.get(app)
                val value = JSONObject().put("mood", store.myMood).put("energy", store.myEnergy).put("at", Db.serverTime())
                db.put("$live/checkin/${seat.role.key}", value, account.token())
                p.edit().putBoolean("checkin_dirty", false).apply()
            }
            val (dirty, deleted) = synchronized(lock) {
                p.getStringSet("tasks_dirty", emptySet())!!.toSet() to p.getStringSet("tasks_deleted", emptySet())!!.toSet()
            }
            val local = TaskRepo(app).all().associateBy { it.key }
            for (key in dirty) {
                val task = local[key]
                if (task != null) db.put("$live/tasks/$key", LiveModel.taskJson(task, seat.role), account.token())
                done(app, "tasks_dirty", key)
            }
            for (key in deleted) {
                db.delete("$live/tasks/$key", account.token())
                done(app, "tasks_deleted", key)
            }
        } catch (e: CloudException) {
            if (e.reason == Reason.DENIED) PairAccess.check(app)
            // Otherwise offline: retried on the next connect or change.
        }
    }

    private fun done(app: Context, set: String, key: String) = synchronized(lock) {
        val p = prefs(app)
        p.edit().putStringSet(set, p.getStringSet(set, emptySet())!! - key).apply()
    }

    // ---------- Receiving ----------

    private fun merge(app: Context, seat: Seat) {
        val store = CoupleStore.get(app)
        val p = prefs(app)

        LiveModel.checkIn(tree, seat.role.other)?.let { store.setPartnerCheckIn(it.mood, it.energy, it.at) }
        if (!p.getBoolean("checkin_dirty", false)) {
            LiveModel.checkIn(tree, seat.role)?.let { store.setMyCheckIn(it.mood, it.energy) }
        }

        val month = YearMonth.now()
        val m = month.toString()
        store.setCount(Counter.TAPS_SENT, month, LiveModel.count(tree, seat.role, m, LiveModel.THINK))
        store.setCount(Counter.TAPS_RECEIVED, month, LiveModel.count(tree, seat.role.other, m, LiveModel.THINK))
        store.setCount(Counter.SAFE, month, LiveModel.count(tree, seat.role, m, LiveModel.SAFE))

        LiveModel.signal(tree, seat.role.other)?.let { signal ->
            val seen = p.getString("signal_seen", null)
            if (seen != signal.id) {
                p.edit().putString("signal_seen", signal.id).apply()
                // The first snapshot after pairing or reinstalling only marks what's there as seen.
                if (seen != null && System.currentTimeMillis() - signal.at < 6 * 3600_000L) announce(app, signal.kind, store.partnerDisplay)
            }
        }
        if (p.getString("signal_seen", null) == null) p.edit().putString("signal_seen", "").apply()

        val today = LocalDate.now().toEpochDay()
        val server = LiveModel.tasks(tree, seat.role)
        synchronized(lock) {
            val dirty = p.getStringSet("tasks_dirty", emptySet())!!
            val deleted = p.getStringSet("tasks_deleted", emptySet())!!
            val repo = TaskRepo(app)
            repo.save(LiveModel.mergeTasks(server, repo.all(), dirty, deleted))
        }
        // Finished tasks from earlier days leave the plan; either phone may tidy them up.
        val stale = server.filter { it.done && it.day < today }.map(Task::key)
        if (stale.isNotEmpty()) stale.forEach { taskRemoved(app, it) }

        DataEvents.changed()
        Widgets.updateAll(app)
    }

    private fun announce(app: Context, kind: String, partner: String) {
        val text = when (kind) {
            LiveModel.THINK -> app.getString(R.string.think_back, partner)
            LiveModel.SAFE -> app.getString(R.string.safe_received, partner)
            else -> app.getString(R.string.support_received, partner)
        }
        main.post { Toast.makeText(app, text, Toast.LENGTH_LONG).show() }
    }

    private fun prefs(app: Context) = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
