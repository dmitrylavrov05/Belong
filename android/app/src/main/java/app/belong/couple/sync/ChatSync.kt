package app.belong.couple.sync

import android.content.Context
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
    private val random = SecureRandom()
    private var feed = ChatFeed()

    private val loop = StreamLoop(
        name = "chat-sync",
        path = { "pairs/${it.code}/chat" },
        query = "orderBy=%22%24key%22&limitToLast=$HISTORY",
        onConnect = { app, seat ->
            feed = ChatFeed()
            refreshNames(app, seat)
            sender.execute { flush(app) }
        },
        onEvent = { app, seat, event, data ->
            feed.apply(event, data)
            merge(app, feed, seat)
        },
    )

    /** Starts listening; does nothing unless the phone is paired. */
    fun start(context: Context) = loop.start(context)

    fun stop() = loop.stop()

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
                    if (!PairAccess.check(app)) return
                    continue
                }
            }
            synchronized(lock) {
                val repo = ChatRepo(app)
                repo.save(repo.all().map { if (it.key == m.key) it.copy(pending = false) else it })
            }
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
}
