package app.belong.couple.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.belong.couple.data.Account

/**
 * Listens to one part of the pair's data while the app is open and reconnects with growing pauses.
 * Refreshes the sign-in token when the server asks for it, and signs out if the seat moved to another phone.
 */
class StreamLoop(
    private val name: String,
    private val path: (Seat) -> String,
    private val query: String = "",
    private val onConnect: (Context, Seat) -> Unit = { _, _ -> },
    private val onEvent: (Context, Seat, event: String, data: String) -> Unit,
) {
    @Volatile private var running = false
    @Volatile private var stream: Db.Stream? = null
    @Volatile private var thread: Thread? = null

    @Synchronized
    fun start(context: Context) {
        val app = context.applicationContext
        if (running || !Account.get(app).paired) return
        running = true
        val worker = Thread({ loop(app) }, name).apply { isDaemon = true }
        thread = worker
        worker.start()
    }

    @Synchronized
    fun stop() {
        running = false
        stream?.close()
        thread?.interrupt()
        thread = null
    }

    private fun loop(app: Context) {
        var delay = 1_000L
        // A quick stop() and start() leaves the old thread winding down; only the current one keeps going.
        while (running && thread === Thread.currentThread()) {
            val account = Account.get(app)
            val seat = account.seat ?: break
            try {
                onConnect(app, seat)
                val s = Db.Stream().also { stream = it }
                if (!running) break
                Db(account.config).listen(path(seat), account.token(), query, s) { event, data ->
                    when (event) {
                        "put", "patch" -> {
                            onEvent(app, seat, event, data)
                            delay = 1_000L
                        }
                        "auth_revoked" -> {
                            account.expireToken()
                            s.close()
                        }
                        "cancel" -> throw CloudException(Reason.DENIED)
                    }
                }
            } catch (e: CloudException) {
                when (e.reason) {
                    Reason.DENIED -> if (!PairAccess.check(app)) break
                    Reason.SIGNED_OUT -> {
                        PairAccess.lose(app)
                        break
                    }
                    else -> Unit
                }
            } catch (e: org.json.JSONException) {
                // A malformed event: reconnect and get a fresh snapshot.
            }
            if (!running) break
            try {
                Thread.sleep(delay)
            } catch (e: InterruptedException) {
                break
            }
            delay = (delay * 2).coerceAtMost(60_000L)
        }
    }
}

/** What happens when the server stops accepting this phone. */
object PairAccess {
    private val main = Handler(Looper.getMainLooper())

    /**
     * After a denial, checks whether this phone still holds its seat. If the seat moved to another
     * account (the password was reset with a help code), signs out and returns false.
     */
    fun check(app: Context): Boolean {
        val account = Account.get(app)
        val seat = account.seat ?: return false
        val info = try { Pairing(account.config).publicInfo(seat.code) } catch (e: CloudException) { return true }
        if (info?.gens?.get(seat.role) == seat.gen) return true
        lose(app)
        return false
    }

    fun lose(app: Context) {
        LiveSync.reset(app)
        Account.get(app).signOut(lost = true)
        main.post { PairSync.stop() }
    }
}

/** Starts and stops everything that syncs with the partner; call from the activity's onStart and onStop. */
object PairSync {
    fun start(context: Context) {
        ChatSync.start(context)
        LiveSync.start(context)
    }

    fun stop() {
        ChatSync.stop()
        LiveSync.stop()
    }
}
