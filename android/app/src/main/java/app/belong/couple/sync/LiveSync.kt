package app.belong.couple.sync

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import app.belong.couple.R
import app.belong.couple.core.Task
import app.belong.couple.data.Account
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DreamsRepo
import app.belong.couple.data.TaskRepo
import app.belong.couple.data.WishRepo
import app.belong.couple.widget.Widgets
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.time.LocalDate
import java.time.YearMonth
import java.util.Base64
import java.util.concurrent.Executors

/**
 * Shares the couple's everyday things with the partner: both check-ins, "thinking of you" /
 * "I'm safe" / support taps with this month's counts, the plan for the day, both wishlists,
 * secret gift reservations and the latest doodles. Local changes are saved first and sent when
 * the network allows; unsent ones are remembered across restarts.
 */
object LiveSync {
    private const val PREFS = "belong_sync"

    /** Kinds of keyed items with unsent changes; each keeps "<kind>_dirty" and "<kind>_deleted" key sets. */
    private const val TASKS = "tasks"
    private const val WISHES = "wishes"
    private const val RESERVED = "reserved"

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
            sender.execute {
                fetchReservations(app)
                flush(app)
            }
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
                count(db, seat, kind, token)
                true
            } catch (e: CloudException) {
                false
            }
            main.post { done(ok) }
        }
    }

    /** Sends a doodle to the partner's home screen. Calls [done] on the main thread with whether it got there. */
    fun sendDoodle(context: Context, doodle: Bitmap, done: (Boolean) -> Unit) {
        val app = context.applicationContext
        val account = Account.get(app)
        val seat = account.seat ?: return done(false)
        sender.execute {
            val ok = try {
                val png = ByteArrayOutputStream().also { doodle.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
                val value = JSONObject()
                    .put("png", Base64.getEncoder().encodeToString(png))
                    .put("at", Db.serverTime())
                    .put("id", ChatFeed.newKey(System.currentTimeMillis(), random))
                val db = Db(account.config)
                val token = account.token()
                db.put("pairs/${seat.code}/live/doodle/${seat.role.key}", value, token)
                count(db, seat, LiveModel.DOODLE, token)
                true
            } catch (e: CloudException) {
                false
            }
            main.post { done(ok) }
        }
    }

    private fun count(db: Db, seat: Seat, kind: String, token: String) {
        db.put("pairs/${seat.code}/live/count/${seat.role.key}/${YearMonth.now()}/$kind", JSONObject().put(".sv", JSONObject().put("increment", 1)), token)
    }

    fun taskChanged(context: Context, key: String) = mark(context.applicationContext, TASKS, key, removed = false)

    fun taskRemoved(context: Context, key: String) = mark(context.applicationContext, TASKS, key, removed = true)

    fun wishChanged(context: Context, key: String) = mark(context.applicationContext, WISHES, key, removed = false)

    fun wishRemoved(context: Context, key: String) = mark(context.applicationContext, WISHES, key, removed = true)

    /** The local wish holds the new state; it is sent to this seat's private part of the database. */
    fun reservationChanged(context: Context, key: String) = mark(context.applicationContext, RESERVED, key, removed = false)

    private fun mark(app: Context, kind: String, key: String, removed: Boolean) {
        if (!Account.get(app).paired) return
        synchronized(lock) {
            val p = prefs(app)
            val dirty = p.getStringSet("${kind}_dirty", emptySet())!!.toMutableSet()
            val deleted = p.getStringSet("${kind}_deleted", emptySet())!!.toMutableSet()
            if (removed) {
                dirty -= key
                deleted += key
            } else {
                dirty += key
                deleted -= key
            }
            p.edit().putStringSet("${kind}_dirty", dirty).putStringSet("${kind}_deleted", deleted).apply()
        }
        sender.execute { flush(app) }
    }

    private fun unsent(app: Context, kind: String): Pair<Set<String>, Set<String>> = synchronized(lock) {
        val p = prefs(app)
        p.getStringSet("${kind}_dirty", emptySet())!!.toSet() to p.getStringSet("${kind}_deleted", emptySet())!!.toSet()
    }

    private fun sent(app: Context, set: String, key: String) = synchronized(lock) {
        val p = prefs(app)
        p.edit().putStringSet(set, p.getStringSet(set, emptySet())!! - key).apply()
    }

    /** Sends queued changes (e.g. dreams and goals) as soon as possible. */
    fun flushSoon(context: Context) {
        val app = context.applicationContext
        sender.execute { flush(app) }
    }

    /** Forgets unsent changes and what was seen, e.g. after signing out. */
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

            val tasks = TaskRepo(app).all().associateBy { it.key }
            val (dirtyTasks, deletedTasks) = unsent(app, TASKS)
            for (key in dirtyTasks) {
                tasks[key]?.let { db.put("$live/tasks/$key", LiveModel.taskJson(it, seat.role), account.token()) }
                sent(app, "${TASKS}_dirty", key)
            }
            for (key in deletedTasks) {
                db.delete("$live/tasks/$key", account.token())
                sent(app, "${TASKS}_deleted", key)
            }

            val wishes = WishRepo(app).all().associateBy { it.key }
            val mine = "$live/wishes/${seat.role.key}"
            val (dirtyWishes, deletedWishes) = unsent(app, WISHES)
            for (key in dirtyWishes) {
                wishes[key]?.let { db.put("$mine/$key", LiveModel.wishJson(it), account.token()) }
                sent(app, "${WISHES}_dirty", key)
            }
            for (key in deletedWishes) {
                db.delete("$mine/$key", account.token())
                sent(app, "${WISHES}_deleted", key)
            }

            val secret = "pairs/${seat.code}/secret/${seat.role.key}/reserved"
            for (key in unsent(app, RESERVED).first) {
                if (wishes[key]?.reserved == true) db.put("$secret/$key", true, account.token()) else db.delete("$secret/$key", account.token())
                synchronized(lock) {
                    val p2 = prefs(app)
                    val server = p2.getStringSet("reserved_server", emptySet())!!.toMutableSet()
                    if (wishes[key]?.reserved == true) server += key else server -= key
                    p2.edit().putStringSet("reserved_server", server).apply()
                }
                sent(app, "${RESERVED}_dirty", key)
            }
            flushDreams(app, db, live, account)
        } catch (e: CloudException) {
            if (e.reason == Reason.DENIED) PairAccess.check(app)
            // Otherwise offline: retried on the next connect or change.
        }
    }

    /** Sends dream and goal changes in the order they were made. A change the server refuses is dropped. */
    private fun flushDreams(app: Context, db: Db, live: String, account: Account) {
        val repo = DreamsRepo(app)
        for (op in repo.ops()) {
            val path = "$live/${op.optString("path")}"
            try {
                when (op.optString("op")) {
                    "put" -> db.put(path, op.get("value"), account.token())
                    "del" -> db.delete(path, account.token())
                    "add" -> db.put(path, JSONObject().put(".sv", JSONObject().put("increment", op.optLong("value"))), account.token())
                }
            } catch (e: CloudException) {
                if (e.reason != Reason.DENIED) throw e
                if (!PairAccess.check(app)) return
            }
            repo.sent(op)
        }
    }

    /** Reads this seat's reservations once per connection; nobody else can change them. */
    private fun fetchReservations(app: Context) {
        val account = Account.get(app)
        val seat = account.seat ?: return
        try {
            val o = Db(account.config).get("pairs/${seat.code}/secret/${seat.role.key}/reserved", account.token()) as? JSONObject
            val keys = o?.keys()?.asSequence()?.filter { o.optBoolean(it) }?.toSet() ?: emptySet()
            synchronized(lock) { prefs(app).edit().putStringSet("reserved_server", keys).apply() }
        } catch (e: CloudException) {
            // Keep the last known reservations.
        }
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
        store.setCount(
            Counter.DOODLES, month,
            LiveModel.count(tree, seat.role, m, LiveModel.DOODLE) + LiveModel.count(tree, seat.role.other, m, LiveModel.DOODLE),
        )

        LiveModel.signal(tree, seat.role.other)?.let { signal ->
            if (firstSight(p, "signal_seen", signal.id) == false && recent(signal.at)) {
                announce(app, signal.kind, store.partnerDisplay)
            }
        }
        if (p.getString("signal_seen", null) == null) p.edit().putString("signal_seen", "").apply()

        LiveModel.doodle(tree, seat.role.other)?.let { doodle ->
            val seen = firstSight(p, "doodle_seen", doodle.id)
            if (seen != null) {
                try {
                    store.savePartnerDoodlePng(Base64.getDecoder().decode(doodle.png), doodle.at)
                    if (seen == false && recent(doodle.at)) toast(app, app.getString(R.string.doodle_reply, store.partnerDisplay))
                } catch (e: IllegalArgumentException) {
                    // Not valid base64: ignore this doodle.
                }
            }
        }
        if (p.getString("doodle_seen", null) == null) p.edit().putString("doodle_seen", "").apply()

        val today = LocalDate.now().toEpochDay()
        val serverTasks = LiveModel.tasks(tree, seat.role)
        val serverWishes = LiveModel.wishes(tree, seat.role)
        synchronized(lock) {
            val (dirtyTasks, deletedTasks) = unsent(app, TASKS)
            val tasks = TaskRepo(app)
            tasks.save(LiveModel.mergeTasks(serverTasks, tasks.all(), dirtyTasks, deletedTasks))

            val (dirtyWishes, deletedWishes) = unsent(app, WISHES)
            val wishes = WishRepo(app)
            val local = wishes.all()
            val unsentReservations = unsent(app, RESERVED).first.associateWith { key -> local.firstOrNull { it.key == key }?.reserved == true }
            val merged = LiveModel.merge(serverWishes, local, dirtyWishes, deletedWishes) { it.key }
            wishes.save(LiveModel.withReservations(merged, p.getStringSet("reserved_server", emptySet())!!, unsentReservations))
        }
        // Finished tasks from earlier days leave the plan; either phone may tidy them up.
        serverTasks.filter { it.done && it.day < today }.map(Task::key).forEach { taskRemoved(app, it) }

        DreamsRepo(app).setBase(tree.obj("dreams"), tree.obj("goals"))

        DataEvents.changed()
        Widgets.updateAll(app)
    }

    /**
     * Records [id] as the latest seen under [pref]. Returns null if it was already seen, true if this is
     * the first snapshot after pairing or reinstalling (nothing to announce), false if it's new.
     */
    private fun firstSight(p: android.content.SharedPreferences, pref: String, id: String): Boolean? {
        val seen = p.getString(pref, null)
        if (seen == id) return null
        p.edit().putString(pref, id).apply()
        return seen == null
    }

    private fun recent(at: Long) = System.currentTimeMillis() - at < 6 * 3600_000L

    private fun announce(app: Context, kind: String, partner: String) = toast(
        app,
        when (kind) {
            LiveModel.THINK -> app.getString(R.string.think_back, partner)
            LiveModel.SAFE -> app.getString(R.string.safe_received, partner)
            else -> app.getString(R.string.support_received, partner)
        },
    )

    private fun toast(app: Context, text: String) = main.post { Toast.makeText(app, text, Toast.LENGTH_LONG).show() }

    private fun prefs(app: Context) = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
