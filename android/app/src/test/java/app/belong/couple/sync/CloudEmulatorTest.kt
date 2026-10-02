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
    fun dreamsAndGoalsAreSharedAndMatchesRevealOnlyMutualYes() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        val pair = "pairs/${yulia.code}"
        val increment = { n: Long -> JSONObject().put(".sv", JSONObject().put("increment", n)) }

        db.put("$pair/live/dreams/d1", app.belong.couple.core.DreamsModel.dreamJson("Japan", "🌸", app.belong.couple.core.DreamCategory.TRAVEL, app.belong.couple.core.Owner.OURS, 1, Role.A), yulia.session.idToken)
        expect(Reason.DENIED) { db.put("$pair/live/dreams/d2", JSONObject().put("title", "x").put("emoji", "✨").put("cat", "cars").put("owner", "a").put("at", 1), igor.session.idToken) }
        val photo = app.belong.couple.core.Picture("https://images.unsplash.com/p", "https://images.unsplash.com/t", "Aiko", "https://unsplash.com/@aiko", "unsplash").toJson()
        db.put("$pair/live/dreams/d1/photo", photo, igor.session.idToken)
        expect(Reason.DENIED) { db.put("$pair/live/dreams/d1/photo", JSONObject(photo.toString()).put("url", "http://evil.example/x.jpg"), igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$pair/live/dreams/d1/photo", JSONObject(photo.toString()).put("src", "gallery"), igor.session.idToken) }

        // A goal both edit; each adds to the savings only for themselves, and only upwards.
        db.put("$pair/live/goals/g1", JSONObject().put("title", "Japan").put("emoji", "🌸").put("at", 1).put("target", 400000).put("unit", "₴"), igor.session.idToken)
        db.put("$pair/live/goals/g1/saved/a", increment(1000), yulia.session.idToken)
        db.put("$pair/live/goals/g1/saved/a", increment(500), yulia.session.idToken)
        db.put("$pair/live/goals/g1/saved/b", increment(700), igor.session.idToken)
        expect(Reason.DENIED) { db.put("$pair/live/goals/g1/saved/a", increment(1), igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$pair/live/goals/g1/saved/a", increment(-100), yulia.session.idToken) }
        db.put("$pair/live/goals/g1/steps/s1", app.belong.couple.core.DreamsModel.stepJson("Tickets", app.belong.couple.core.Owner.ME, 2, Role.B), igor.session.idToken)
        db.put("$pair/live/goals/g1/steps/s1/done", true, yulia.session.idToken)

        val live = JSONObject(db.get("$pair/live", yulia.session.idToken).toString())
        val goal = app.belong.couple.core.DreamsModel.goal(live, "g1", Role.A)!!
        assertEquals(1500L, goal.savedMine)
        assertEquals(700L, goal.savedPartner)
        assertEquals(app.belong.couple.core.Owner.PARTNER, goal.steps.single().who)
        assertEquals(1, goal.stepsDone)

        // Matches: Yulia says yes to i01 and i02, Igor to i01 and i03.
        db.put("$pair/votes/a/i01", true, yulia.session.idToken)
        db.put("$pair/votes/a/i02", true, yulia.session.idToken)
        db.put("$pair/secret/a/decided/i03", "no", yulia.session.idToken)
        db.put("$pair/votes/b/i01", true, igor.session.idToken)
        db.put("$pair/votes/b/i03", true, igor.session.idToken)
        expect(Reason.DENIED) { db.put("$pair/votes/b/i02", false, igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$pair/votes/b/x1", true, igor.session.idToken) }

        assertEquals(true, db.get("$pair/votes/a/i01", igor.session.idToken)) // mutual yes
        assertNull(db.get("$pair/votes/a/i03", igor.session.idToken)) // Yulia's "no" looks like no answer
        expect(Reason.DENIED) { db.get("$pair/votes/a/i02", igor.session.idToken) } // Igor didn't say yes to it
        expect(Reason.DENIED) { db.get("$pair/votes/a", igor.session.idToken) } // no peeking at the whole list
        expect(Reason.DENIED) { db.get("$pair/secret/a/decided", igor.session.idToken) }
        assertEquals(setOf("i01", "i02"), (db.get("$pair/votes/a", yulia.session.idToken) as JSONObject).keys().asSequence().toSet())
    }

    @Test
    fun dailyAnswersAndQuizStayHiddenUntilYouAnswerToo() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        val pair = "pairs/${yulia.code}"
        val answer = { text: String -> JSONObject().put("text", text).put("at", Db.serverTime()) }

        // Question of the day: Igor answers first; Yulia can't read it until she answers too.
        db.put("$pair/answers/20730/b", answer("The rainy evening in Lviv"), igor.session.idToken)
        expect(Reason.DENIED) { db.get("$pair/answers/20730/b", yulia.session.idToken) }
        expect(Reason.DENIED) { db.put("$pair/answers/20730/b", answer("Changed by Yulia"), yulia.session.idToken) }
        db.put("$pair/answers/20730/a", answer("Our first trip"), yulia.session.idToken)
        assertEquals("The rainy evening in Lviv", (db.get("$pair/answers/20730/b", yulia.session.idToken) as JSONObject).getString("text"))
        assertEquals("Our first trip", (db.get("$pair/answers/20730/a", igor.session.idToken) as JSONObject).getString("text"))
        expect(Reason.DENIED) { db.get("$pair/answers/20730", yulia.session.idToken) }

        // Quiz: a round is readable to the partner only after they finish theirs.
        val round = "2961"
        val entry = { done: Boolean -> JSONObject().put("self", JSONObject().put("q0", 1).put("q1", 3)).put("guess", JSONObject().put("q0", 2)).put("done", done) }
        db.put("$pair/quiz/$round/a", entry(true), yulia.session.idToken)
        expect(Reason.DENIED) { db.get("$pair/quiz/$round/a", igor.session.idToken) }
        db.put("$pair/quiz/$round/b", entry(false), igor.session.idToken)
        expect(Reason.DENIED) { db.get("$pair/quiz/$round/a", igor.session.idToken) } // still playing
        db.put("$pair/quiz/$round/b/done", true, igor.session.idToken)
        assertEquals(3, (db.get("$pair/quiz/$round/a", igor.session.idToken) as JSONObject).getJSONObject("self").getInt("q1"))
        expect(Reason.DENIED) { db.put("$pair/quiz/$round/b/self/q2", 7, igor.session.idToken) }
        expect(Reason.DENIED) { db.put("$pair/quiz/$round/b/self/x", 1, igor.session.idToken) }

        // Shared everyday things: shopping, the evening note (own seat only), flags, memories.
        db.put("$pair/live/shopping/s1", JSONObject().put("title", "Milk").put("by", "b").put("done", false).put("at", 1), igor.session.idToken)
        db.put("$pair/live/shopping/s1/done", true, yulia.session.idToken)
        db.put("$pair/live/thanks/20730/a", JSONObject().put("text", "Thank you for the call").put("at", 1), yulia.session.idToken)
        expect(Reason.DENIED) { db.put("$pair/live/thanks/20730/a", JSONObject().put("text", "Fake").put("at", 1), igor.session.idToken) }
        db.put("$pair/live/flags/question/20730/b", true, igor.session.idToken)
        expect(Reason.DENIED) { db.put("$pair/live/flags/question/20730/a", true, igor.session.idToken) }
        db.put("$pair/live/couple/since", 19770, igor.session.idToken)
        db.put("$pair/live/moments/m1", JSONObject().put("title", "First evening").put("text", "").put("day", 20365).put("at", 1), yulia.session.idToken)
        expect(Reason.DENIED) { db.put("$pair/live/moments/m2", JSONObject().put("title", "x").put("day", "soon").put("at", 1), yulia.session.idToken) }
        val live = JSONObject(db.get("$pair/live", igor.session.idToken).toString())
        assertEquals(19770L, app.belong.couple.core.TogetherModel.since(live))
        assertEquals(true, app.belong.couple.core.TogetherModel.shopping(live, Role.B).single().done)
    }

    @Test
    fun calendarPhotosAndFeelingsFollowTheirRules() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        val pair = "pairs/${yulia.code}"
        val y = yulia.session.idToken
        val i = igor.session.idToken

        // Living together or apart, and important dates both can edit.
        db.put("$pair/live/couple/apart", false, i)
        expect(Reason.DENIED) { db.put("$pair/live/couple/apart", "yes", y) }
        db.put("$pair/live/couple/meeting", 20740, y)
        db.put("$pair/live/dates/d1", JSONObject().put("title", "Yulia’s birthday").put("emoji", "🎂").put("day", 11760).put("yearly", true).put("at", 1), i)
        db.put("$pair/live/dates/d1/title", "Yulia’s birthday 🎉", y)
        expect(Reason.DENIED) { db.put("$pair/live/dates/d2", JSONObject().put("title", "No day").put("at", 1), y) }

        // Photos of the day: only the author writes or deletes them, and the picture can't be swapped.
        val jpeg = "/9j/" + "A".repeat(100)
        val meta = { by: String -> JSONObject().put("by", by).put("at", 1).put("caption", "Coffee") }
        db.put("$pair/photo_data/p1", JSONObject().put("by", "a").put("thumb", jpeg).put("full", jpeg), y)
        db.put("$pair/live/photos/20730/p1", meta("a"), y)
        assertEquals(jpeg, db.get("$pair/photo_data/p1/thumb", i))
        expect(Reason.DENIED) { db.put("$pair/photo_data/p2", JSONObject().put("by", "a").put("thumb", jpeg).put("full", jpeg), i) }
        expect(Reason.DENIED) { db.put("$pair/photo_data/p3", JSONObject().put("by", "b").put("thumb", "not a jpeg").put("full", jpeg), i) }
        expect(Reason.DENIED) { db.put("$pair/photo_data/p1", JSONObject().put("by", "a").put("thumb", jpeg).put("full", jpeg + "B"), y) }
        expect(Reason.DENIED) { db.put("$pair/live/photos/20730/p1/caption", "Changed by Igor", i) }
        expect(Reason.DENIED) { db.put("$pair/live/photos/20730/p1", meta("b"), y) }
        expect(Reason.DENIED) { db.delete("$pair/live/photos/20730/p1", i) }
        expect(Reason.DENIED) { db.delete("$pair/photo_data/p1", i) }
        db.put("$pair/live/photos/20730/p1/caption", "Morning coffee", y)
        db.delete("$pair/live/photos/20730/p1", y)
        db.delete("$pair/photo_data/p1", y)

        // Feelings: each note opens to the partner only after they've written their own.
        val note = { feel: String -> JSONObject().put("what", "").put("feel", feel).put("need", "").put("ask", "").put("at", Db.serverTime()) }
        db.put("$pair/feelings/f1/b", note("Hurt, but I love you"), i)
        db.put("$pair/live/feelings/f1", JSONObject().put("by", "b").put("at", 1).put("title", "").put("wrote", JSONObject().put("b", true)), i)
        expect(Reason.DENIED) { db.get("$pair/feelings/f1/b", y) }
        expect(Reason.DENIED) { db.put("$pair/feelings/f1/b", note("Forged"), y) }
        expect(Reason.DENIED) { db.put("$pair/feelings/f1/a", JSONObject().put("what", "No feelings").put("at", 1), y) }
        db.put("$pair/feelings/f1/a", note("Sorry, I was tired"), y)
        db.put("$pair/live/feelings/f1/wrote/a", true, y)
        assertEquals("Hurt, but I love you", (db.get("$pair/feelings/f1/b", y) as JSONObject).getString("feel"))
        assertEquals("Sorry, I was tired", (db.get("$pair/feelings/f1/a", i) as JSONObject).getString("feel"))

        val live = JSONObject(db.get("$pair/live", y).toString())
        assertEquals(false, app.belong.couple.core.CalendarModel.apart(live))
        assertEquals("Yulia’s birthday 🎉", app.belong.couple.core.CalendarModel.dates(live).single().title)
        assertEquals(true, app.belong.couple.core.FeelingsModel.notes(live, Role.A).single().partnerWritten)
    }

    @Test
    fun chatMediaLettersAndMoviesFollowTheirRules() {
        val yulia = pairing.create("Yulia", "sunflower1")
        val igor = pairing.join(yulia.code, "Igor", "maple-leaf")
        val pair = "pairs/${yulia.code}"
        val y = yulia.session.idToken
        val i = igor.session.idToken
        val jpeg = "/9j/" + "A".repeat(100)

        // Chat photos and voice messages: the media must be uploaded by the sender first.
        expect(Reason.DENIED) { db.put("$pair/chat/c1", JSONObject().put("from", "a").put("photo", "p1").put("at", Db.serverTime()), y) }
        db.put("$pair/photo_data/p1", JSONObject().put("by", "a").put("thumb", jpeg).put("full", jpeg), y)
        db.put("$pair/chat/c1", JSONObject().put("from", "a").put("photo", "p1").put("at", Db.serverTime()), y)
        expect(Reason.DENIED) { db.put("$pair/chat/c2", JSONObject().put("from", "b").put("photo", "p1").put("at", Db.serverTime()), i) }
        expect(Reason.DENIED) { db.put("$pair/chat/c1/photo", "p2", y) }
        db.put("$pair/chat/c1/heart", true, i)
        db.put("$pair/voice_data/v1", JSONObject().put("by", "b").put("data", "AAAAGGZ0eXBtcDQy").put("dur", 4), i)
        expect(Reason.DENIED) { db.put("$pair/voice_data/v1", JSONObject().put("by", "b").put("data", "changed").put("dur", 4), i) }
        expect(Reason.DENIED) { db.put("$pair/voice_data/v2", JSONObject().put("by", "a").put("data", "x").put("dur", 4), i) }
        db.put("$pair/chat/c3", JSONObject().put("from", "b").put("voice", "v1").put("dur", 4).put("at", Db.serverTime()), i)
        expect(Reason.DENIED) { db.put("$pair/chat/c4", JSONObject().put("from", "b").put("at", Db.serverTime()), i) }
        assertEquals("AAAAGGZ0eXBtcDQy", db.get("$pair/voice_data/v1/data", y))

        // Letters: the text opens to the partner on its day; "when…" letters at any time.
        val now = System.currentTimeMillis()
        val letter = { text: String -> JSONObject().put("by", "a").put("text", text).put("at", Db.serverTime()) }
        db.put("$pair/letters/sealed", letter("Happy anniversary"), y)
        db.put("$pair/live/letters/sealed", JSONObject().put("by", "a").put("at", 1).put("kind", "date").put("openAt", now + 86_400_000L).put("title", "Open on our anniversary"), y)
        expect(Reason.DENIED) { db.get("$pair/letters/sealed", i) }
        assertEquals("Happy anniversary", (db.get("$pair/letters/sealed", y) as JSONObject).getString("text"))
        expect(Reason.DENIED) { db.put("$pair/live/letters/sealed/openAt", now - 1000, i) }
        expect(Reason.DENIED) { db.put("$pair/letters/sealed", letter("Edited"), y) }
        db.put("$pair/live/letters/sealed/openAt", now - 1000, y)
        assertEquals("Happy anniversary", (db.get("$pair/letters/sealed", i) as JSONObject).getString("text"))
        db.put("$pair/live/letters/sealed/opened", true, i)
        db.put("$pair/letters/sad", letter("I'm here"), y)
        expect(Reason.DENIED) { db.get("$pair/letters/sad", i) } // no envelope yet
        expect(Reason.DENIED) { db.put("$pair/live/letters/sad", JSONObject().put("by", "a").put("at", 1).put("kind", "date").put("title", "No date"), y) }
        db.put("$pair/live/letters/sad", JSONObject().put("by", "a").put("at", 1).put("kind", "when").put("title", "Open when you're sad"), y)
        assertEquals("I'm here", (db.get("$pair/letters/sad", i) as JSONObject).getString("text"))
        expect(Reason.DENIED) { db.put("$pair/letters/fake", JSONObject().put("by", "a").put("text", "Forged").put("at", 1), i) }

        // Films: both edit the list, each rates only for themselves.
        db.put("$pair/live/movies/m1", JSONObject().put("title", "Past Lives").put("kind", "movie").put("by", "b").put("at", 1).put("watched", false), i)
        db.put("$pair/live/movies/m1/watched", true, y)
        db.put("$pair/live/movies/m1/rate/a", 5, y)
        expect(Reason.DENIED) { db.put("$pair/live/movies/m1/rate/b", 1, y) }
        expect(Reason.DENIED) { db.put("$pair/live/movies/m1/rate/b", 6, i) }
        db.put("$pair/live/movies/m1/rate/b", 4, i)
        db.put("$pair/live/movies/m1/title", "Past Lives (2023)", y)
        expect(Reason.DENIED) { db.put("$pair/live/movies/m2", JSONObject().put("title", "x").put("kind", "cartoon").put("by", "a").put("at", 1), y) }
        db.put("$pair/live/movies/m1/tmdb", 666277, y)
        db.put("$pair/live/movies/m1/poster", "/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg", i)
        db.put("$pair/live/movies/m1/genres", "18,10749", y)
        db.put("$pair/live/movies/m1/year", 2023, y)
        expect(Reason.DENIED) { db.put("$pair/live/movies/m1/poster", "https://evil.example/x.jpg", y) }
        expect(Reason.DENIED) { db.put("$pair/live/movies/m1/genres", "drama", y) }

        val live = JSONObject(db.get("$pair/live", y).toString())
        val movie = app.belong.couple.core.MoviesModel.movies(live, Role.A).single()
        assertEquals(5, movie.myRating)
        assertEquals(4, movie.partnerRating)
        assertEquals("m666277", movie.tmdbKey)
        assertEquals(listOf(18, 10749), movie.genreIds)
        assertEquals(true, app.belong.couple.core.LettersModel.letters(live, Role.B).first { it.key == "sealed" }.opened)
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
