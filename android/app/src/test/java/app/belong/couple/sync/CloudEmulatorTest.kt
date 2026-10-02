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
