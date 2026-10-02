package app.belong.couple.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.belong.couple.core.ChatMessage
import app.belong.couple.data.Account
import app.belong.couple.data.ChatRepo
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import org.json.JSONObject
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Keeps the local chat in step with the pair's chat on the server while the app is open.
 * Messages are saved locally first and marked pending, then sent; the event stream brings back
 * both partners' messages. Pending messages are retried on every reconnect, so sending works offline.
 */
object ChatSync {
    private const val HISTORY = 500

    private val lock = Any()
    private val sender = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val random = SecureRandom()

    @Volatile private var running = false
    @Volatile private var stream: Db.Stream? = null
    @Volatile private var thread: Thread? = null

    /** Starts listening; call from onStart. Does nothing unless the phone is paired. */
    @Synchronized
    fun start(context: Context) {
        val app = context.applicationContext
        if (running || !Account.get(app).paired) return
        running = true
        val worker = Thread({ loop(app) }, "chat-sync").apply { isDaemon = true }
        thread = worker
        worker.start()
    }

    /** Stops listening; call from onStop. */
    @Synchronized
    fun stop() {
        running = false
        stream?.close()
        thread?.interrupt()
        thread = null
    }

    /** Saves the message and sends it when the network allows. */
    fun send(context: Context, text: String): Boolean {
        val app = context.applicationContext
        val body = text.trim().take(2000)
        if (body.isEmpty()) return false
        val now = System.currentTimeMillis()
        val key = ChatFeed.newKey(now, random)
        synchronized(lock) {
            val repo = ChatRepo(app)
            repo.save(repo.all() + ChatMessage(ChatFeed.idFor(key), true, body, now, false, key, pending = true))
        }
        sender.execute { flush(app) }
        return true
    }

    fun toggleHeart(context: Context, message: ChatMessage) {
        val app = context.applicationContext
        if (message.pending || message.key.isEmpty()) return
        val hearted = !message.hearted
        synchronized(lock) {
            val repo = ChatRepo(app)
            repo.save(repo.all().map { if (it.key == message.key) it.copy(hearted = hearted) else it })
        }
        sender.execute {
            val account = Account.get(app)
            val seat = account.seat ?: return@execute
            try {
                Db(account.config).put("pairs/${seat.code}/chat/${message.key}/heart", hearted, account.token())
            } catch (e: CloudException) {
                // The stream puts the server's value back.
            }
        }
    }

    private fun flush(app: Context) {
        val account = Account.get(app)
        val seat = account.seat ?: return
        val db = Db(account.config)
        val pending = synchronized(lock) { ChatRepo(app).all().filter { it.pending } }
        for (m in pending) {
            val path = "pairs/${seat.code}/chat/${m.key}"
            try {
                val value = JSONObject().put("from", seat.role.key).put("text", m.text).put("at", Db.serverTime())
                db.put(path, value, account.token())
            } catch (e: CloudException) {
                if (e.reason != Reason.DENIED) return // offline: retry on the next connect
                // Denied also happens when an earlier attempt got through but its reply was lost.
                val onServer = try { db.get(path, account.token()) } catch (e2: CloudException) { return }
                if (onServer == null) {
                    if (!checkAccess(app)) return
                    continue
                }
            }
            synchronized(lock) {
                val repo = ChatRepo(app)
                repo.save(repo.all().map { if (it.key == m.key) it.copy(pending = false) else it })
            }
        }
    }

    private fun loop(app: Context) {
        var delay = 1_000L
        // A quick stop() and start() leaves the old thread winding down; only the current one keeps going.
        while (running && thread === Thread.currentThread()) {
            val account = Account.get(app)
            val seat = account.seat ?: break
            val feed = ChatFeed()
            try {
                refreshNames(app, seat)
                sender.execute { flush(app) }
                val s = Db.Stream().also { stream = it }
                if (!running) break
                Db(account.config).listen("pairs/${seat.code}/chat", account.token(), "orderBy=%22%24key%22&limitToLast=$HISTORY", s) { event, data ->
                    when (event) {
                        "put", "patch" -> {
                            feed.apply(event, data)
                            merge(app, feed, seat)
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
                    Reason.DENIED -> if (!checkAccess(app)) break
                    Reason.SIGNED_OUT -> {
                        Account.get(app).signOut(lost = true)
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

    /** Puts the server's messages on screen, keeping local ones that are still on their way. */
    private fun merge(app: Context, feed: ChatFeed, seat: Seat) {
        val fromServer = feed.toList(seat.role)
        synchronized(lock) {
            val repo = ChatRepo(app)
            val keys = feed.keys
            val waiting = repo.all().filter { it.pending && it.key !in keys }
            repo.save(fromServer + waiting)
        }
        if (Account.get(app).seat?.partnerName == null && fromServer.any { !it.fromMe }) refreshNames(app, seat)
    }

    /** Picks up the partner's name once they have joined, and any rename. */
    private fun refreshNames(app: Context, seat: Seat) {
        val info = try { Pairing(Account.get(app).config).publicInfo(seat.code) } catch (e: CloudException) { null } ?: return
        val partner = info.names[seat.role.other]?.takeIf { it.isNotBlank() } ?: return
        if (partner != seat.partnerName) {
            Account.get(app).setPartnerName(partner)
            CoupleStore.get(app).partnerName = partner
            DataEvents.changed()
        }
    }

    /**
     * After a denial, checks whether this phone still holds its seat. If the seat moved to another
     * account (the password was reset with a help code), signs out and returns false.
     */
    private fun checkAccess(app: Context): Boolean {
        val account = Account.get(app)
        val seat = account.seat ?: return false
        val info = try { Pairing(account.config).publicInfo(seat.code) } catch (e: CloudException) { return true }
        if (info?.gens?.get(seat.role) == seat.gen) return true
        account.signOut(lost = true)
        main.post { stop() }
        return false
    }
}
