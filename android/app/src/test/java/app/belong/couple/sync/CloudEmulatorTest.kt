package app.belong.couple.sync

import app.belong.couple.core.Role
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Runs pairing, chat and password recovery against the Firebase emulators with the real
 * database rules. Skipped unless the emulators are running:
 *
 *   cd firebase && firebase emulators:exec --project demo-belong --only auth,database "cd ../android && ./gradlew test"
 */
class CloudEmulatorTest {
    private lateinit var config: CloudConfig
    private lateinit var pairing: Pairing
    private lateinit var db: Db

    @Before
    fun setUp() {
        val auth = System.getenv("FIREBASE_AUTH_EMULATOR_HOST")
        val database = System.getenv("FIREBASE_DATABASE_EMULATOR_HOST")
        assumeTrue("Firebase emulators are not running", auth != null && database != null)
        val project = System.getenv("GCLOUD_PROJECT") ?: "demo-belong"
        config = CloudConfig.emulator(
            host = database!!.substringBefore(':'),
            authPort = auth!!.substringAfter(':').toInt(),
            databasePort = database.substringAfter(':').toInt(),
            project = project,
        )
        pairing = Pairing(config)
        db = Db(config)
    }

    private fun expect(reason: Reason, block: () -> Unit) {
        try {
            block()
            fail("Expected $reason")
        } catch (e: CloudException) {
            assertEquals(reason, e.reason)
        }
    }

    private fun message(from: Role, text: String) = JSONObject().put("from", from.key).put("text", text).put("at", Db.serverTime())

    @Test
    fun createJoinAndSignIn() {
        val yulia = pairing.create("Yulia", "sunflower1")
        assertEquals(Role.A, yulia.role)
        assertNull(yulia.partnerName)
        assertEquals(mapOf(Role.A to "Yulia"), pairing.publicInfo(yulia.code)!!.names)

        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        assertEquals(Role.B, igor.role)
        assertEquals("Yulia", igor.partnerName)

        // The code works once.
        expect(Reason.CODE_USED) { pairing.join(yulia.code, "Mallory", "password99") }
        expect(Reason.NO_SUCH_PAIR) { pairing.join("zzzzzzzz", "Igor", "maple-leaf") }

        expect(Reason.WRONG_PASSWORD) { pairing.signIn(yulia.code, Role.A, "maple-leaf") }
        val again = pairing.signIn(yulia.code, Role.A, "sunflower1")
        assertEquals(yulia.session.uid, again.session.uid)
        assertEquals("Igor", again.partnerName)

        pairing.rename(igor, "Igor 🐻", igor.session.idToken)
        assertEquals("Igor 🐻", pairing.publicInfo(yulia.code)!!.names[Role.B])

        // Only members read the pair; anyone with the code sees just the names.
        val stranger = pairing.create("Stranger", "password99")
        expect(Reason.DENIED) { db.get("pairs/${yulia.code}/chat", stranger.session.idToken) }
        expect(Reason.DENIED) { db.get("pairs/${yulia.code}/members") }
    }

    @Test
    fun chatReachesThePartnerAndCannotBeForged() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        val chat = "pairs/${yulia.code}/chat"

        val feed = ChatFeed()
        val arrived = CountDownLatch(1)
        val stream = Db.Stream()
        val listener = Thread {
            try {
                db.listen(chat, igor.session.idToken, "orderBy=%22%24key%22&limitToLast=500", stream) { event, data ->
                    if (event == "put" || event == "patch") {
                        synchronized(feed) { feed.apply(event, data) }
                        if (synchronized(feed) { feed.toList(Role.B) }.any { it.text == "Good morning ☀️" }) arrived.countDown()
                    }
                }
            } catch (e: CloudException) {
                // Closed below.
            }
        }.apply { start() }

        db.put("$chat/k1", message(Role.A, "Good morning ☀️"), yulia.session.idToken)
        assert(arrived.await(10, TimeUnit.SECONDS)) { "Igor didn't receive the message" }
        stream.close()
        listener.join(5_000)
        val received = synchronized(feed) { feed.toList(Role.B) }.single()
        assertEquals(false, received.fromMe)
        assertNotEquals(0L, received.at)

        // Igor can like it but not edit, delete or write as Yulia.
        db.put("$chat/k1/heart", true, igor.session.idToken)
        expect(Reason.DENIED) { db.put("$chat/k1/text", "edited", igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$chat/k2", message(Role.A, "fake"), igor.session.idToken) }
        // Resending the same message is refused, so a lost reply can't create a duplicate.
        expect(Reason.DENIED) { db.put("$chat/k1", message(Role.A, "Good morning ☀️"), yulia.session.idToken) }
        assertEquals(true, (db.get("$chat/k1", yulia.session.idToken) as JSONObject).getBoolean("heart"))
    }

    @Test
    fun todayIsSharedAndEachSeatWritesOnlyItsOwnPart() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        val live = "pairs/${yulia.code}/live"
        fun checkIn(mood: Int, energy: Int) = JSONObject().put("mood", mood).put("energy", energy).put("at", Db.serverTime())
        val increment = JSONObject().put(".sv", JSONObject().put("increment", 1))

        db.put("$live/checkin/a", checkIn(4, 3), yulia.session.idToken)
        expect(Reason.DENIED) { db.put("$live/checkin/a", checkIn(1, 1), igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$live/checkin/b", checkIn(9, 1), igor.session.idToken) }

        // "Thinking of you": the latest tap plus a monthly count that only ever goes up by one.
        db.put("$live/signal/b", JSONObject().put("kind", "think").put("at", Db.serverTime()).put("id", "x1"), igor.session.idToken)
        db.put("$live/count/b/2026-10/think", increment, igor.session.idToken)
        db.put("$live/count/b/2026-10/think", increment, igor.session.idToken)
        expect(Reason.DENIED) { db.put("$live/count/b/2026-10/think", 50, igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$live/count/a/2026-10/think", increment, igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$live/signal/b", JSONObject().put("kind", "spam").put("at", Db.serverTime()).put("id", "x2"), igor.session.idToken) }

        // The plan is shared: Igor adds a task for both, Yulia ticks it off, either may remove it.
        val task = JSONObject().put("title", "Video call at 9 pm").put("owner", "both").put("done", false).put("day", 20_000)
        db.put("$live/tasks/t1", task, igor.session.idToken)
        db.put("$live/tasks/t1", JSONObject(task.toString()).put("done", true), yulia.session.idToken)
        expect(Reason.DENIED) { db.put("$live/tasks/t2", JSONObject(task.toString()).put("owner", "c"), yulia.session.idToken) }

        val tree = JsonTree()
        tree.apply("put", JSONObject().put("path", "/").put("data", db.get(live, yulia.session.idToken)).toString())
        assertEquals(CheckIn(4, 3, LiveModel.checkIn(tree, Role.A)!!.at), LiveModel.checkIn(tree, Role.A))
        assertEquals(2, LiveModel.count(tree, Role.B, "2026-10", LiveModel.THINK))
        assertEquals("x1", LiveModel.signal(tree, Role.B)!!.id)
        val seen = LiveModel.tasks(tree, Role.A).single()
        assertEquals(app.belong.couple.core.Owner.OURS, seen.owner)
        assertEquals(true, seen.done)

        db.delete("$live/tasks/t1", yulia.session.idToken)
        assertNull(db.get("$live/tasks", igor.session.idToken))
        val stranger = pairing.create("Stranger", "password99")
        expect(Reason.DENIED) { db.get(live, stranger.session.idToken) }
        expect(Reason.DENIED) { db.put("$live/tasks/t3", task, stranger.session.idToken) }
    }

    @Test
    fun wishlistsAreSharedButGiftReservationsStaySecret() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        val live = "pairs/${yulia.code}/live"
        val wish = JSONObject().put("title", "Film camera").put("price", "$90").put("link", "https://example.com").put("note", "").put("at", 1)

        db.put("$live/wishes/a/w1", wish, yulia.session.idToken)
        // Only the owner edits their list, and links must be web links.
        expect(Reason.DENIED) { db.put("$live/wishes/a/w2", wish, igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$live/wishes/a/w3", JSONObject(wish.toString()).put("link", "javascript:alert(1)"), yulia.session.idToken) }

        // Igor reserves Yulia's wish. It is stored where only Igor can read it.
        val igorSecret = "pairs/${yulia.code}/secret/b/reserved"
        db.put("$igorSecret/w1", true, igor.session.idToken)
        assertEquals(true, (db.get(igorSecret, igor.session.idToken) as JSONObject).getBoolean("w1"))
        expect(Reason.DENIED) { db.get(igorSecret, yulia.session.idToken) }
        expect(Reason.DENIED) { db.get("pairs/${yulia.code}", yulia.session.idToken) }
        expect(Reason.DENIED) { db.put("$igorSecret/w1", false, yulia.session.idToken) }

        val tree = JsonTree()
        tree.apply("put", JSONObject().put("path", "/").put("data", db.get(live, igor.session.idToken)).toString())
        val seen = LiveModel.wishes(tree, Role.B).single()
        assertEquals(app.belong.couple.core.Owner.PARTNER, seen.owner)
        assertEquals("Film camera", seen.title)

        // Doodles: PNG only, from the owner's seat.
        val png = java.util.Base64.getEncoder().encodeToString(byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10))
        db.put("$live/doodle/b", JSONObject().put("png", png).put("at", Db.serverTime()).put("id", "d1"), igor.session.idToken)
        expect(Reason.DENIED) { db.put("$live/doodle/b", JSONObject().put("png", "PHN2Zz4=").put("at", Db.serverTime()).put("id", "d2"), igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$live/doodle/a", JSONObject().put("png", png).put("at", Db.serverTime()).put("id", "d3"), igor.session.idToken) }
        tree.apply("put", JSONObject().put("path", "/").put("data", db.get(live, yulia.session.idToken)).toString())
        assertEquals("d1", LiveModel.doodle(tree, Role.B)!!.id)
    }

    @Test
    fun partnerHelpsResetAForgottenPassword() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        db.put("pairs/${yulia.code}/chat/k1", message(Role.B, "Hi"), igor.session.idToken)

        // Yulia can't make a help code for herself.
        expect(Reason.DENIED) { pairing.makeHelpCode(yulia.code, Role.A, yulia.session.idToken) }

        val help = pairing.makeHelpCode(yulia.code, Role.A, igor.session.idToken)
        expect(Reason.BAD_HELP_CODE) { pairing.recover(yulia.code, Role.A, "abcdefgh", "new-password") }
        val recovered = pairing.recover(yulia.code, Role.A, help, "new-password")
        assertEquals(Role.A, recovered.role)
        assertEquals("Yulia", recovered.myName)
        assertEquals("Igor", recovered.partnerName)
        assertNotEquals(yulia.gen, recovered.gen)
        assertNotNull(db.get("pairs/${yulia.code}/chat/k1", recovered.session.idToken))

        // The old phone loses access, the code can't be used twice, and the new password works.
        expect(Reason.DENIED) { db.get("pairs/${yulia.code}/chat", yulia.session.idToken) }
        expect(Reason.BAD_HELP_CODE) { pairing.recover(yulia.code, Role.A, help, "another-one") }
        expect(Reason.WRONG_PASSWORD) { pairing.signIn(yulia.code, Role.A, "sunflower1") }
        assertEquals(recovered.session.uid, pairing.signIn(yulia.code, Role.A, "new-password").session.uid)

        // Igor can't take over Yulia's seat with his own help code.
        val own = pairing.makeHelpCode(yulia.code, Role.A, igor.session.idToken)
        expect(Reason.DENIED) {
            val values = JSONObject().put("members/a", igor.session.uid).put("reset/a/used", own)
            db.update("pairs/${yulia.code}", values, igor.session.idToken)
        }
    }
}
