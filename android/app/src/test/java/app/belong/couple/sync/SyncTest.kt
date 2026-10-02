package app.belong.couple.sync

import app.belong.couple.core.PairCode
import app.belong.couple.core.Role
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

class PairCodeTest {
    @Test
    fun codesUseTheAlphabetAndParseBack() {
        val random = Random(7)
        repeat(200) {
            val code = PairCode.generate(random)
            assertEquals(8, code.length)
            assertEquals(code, PairCode.parse(PairCode.format(code)))
            assertEquals(code, PairCode.parse(" ${PairCode.format(code).lowercase()} "))
        }
    }

    @Test
    fun parseRejectsLookAlikesAndWrongLength() {
        assertEquals("k7m3q9xp", PairCode.parse("K7M3-Q9XP"))
        assertNull(PairCode.parse("K7M3-Q9X"))
        assertNull(PairCode.parse("K7M3-Q9XPA"))
        assertNull(PairCode.parse("K7M3-Q9X0")) // zero
        assertNull(PairCode.parse("K7M3-Q9XO")) // letter O
        assertNull(PairCode.parse("K7M3-Q9X1"))
        assertNull(PairCode.parse(""))
    }

    @Test
    fun emailNamesTheSeatAndGeneration() {
        assertEquals("k7m3q9xp.b.2@pair.belong.app", PairCode.email("k7m3q9xp", Role.B, 2))
        assertEquals(Role.A, Role.B.other)
        assertEquals(Role.B, Role.of("b"))
        assertNull(Role.of("c"))
    }

    @Test
    fun passwordNeedsEightCharacters() {
        assertFalse(PairCode.passwordOk("1234567"))
        assertFalse(PairCode.passwordOk("        "))
        assertTrue(PairCode.passwordOk("12345678"))
    }
}

class AuthErrorTest {
    @Test
    fun firebaseErrorsMapToReasons() {
        assertEquals(Reason.ACCOUNT_EXISTS, AuthApi.reasonFor("EMAIL_EXISTS", 400))
        assertEquals(Reason.WRONG_PASSWORD, AuthApi.reasonFor("INVALID_LOGIN_CREDENTIALS", 400))
        assertEquals(Reason.WRONG_PASSWORD, AuthApi.reasonFor("INVALID_PASSWORD", 400))
        assertEquals(Reason.TOO_MANY_ATTEMPTS, AuthApi.reasonFor("TOO_MANY_ATTEMPTS_TRY_LATER : Access disabled", 400))
        assertEquals(Reason.WEAK_PASSWORD, AuthApi.reasonFor("WEAK_PASSWORD : Password should be at least 6 characters", 400))
        assertEquals(Reason.SIGNED_OUT, AuthApi.reasonFor("TOKEN_EXPIRED", 400))
        assertEquals(Reason.NETWORK, AuthApi.reasonFor("", 503))
        assertEquals(Reason.OTHER, AuthApi.reasonFor("SOMETHING_NEW", 400))
    }
}

class ChatFeedTest {
    private fun put(feed: ChatFeed, path: String, data: String) = feed.apply("put", """{"path":"$path","data":$data}""")

    @Test
    fun snapshotThenChangesFromBothSides() {
        val feed = ChatFeed()
        put(feed, "/", """{"k2":{"from":"b","text":"hi","at":20},"k1":{"from":"a","text":"hello","at":10}}""")
        var list = feed.toList(Role.A)
        assertEquals(listOf("hello", "hi"), list.map { it.text })
        assertEquals(listOf(true, false), list.map { it.fromMe })
        assertEquals(listOf(false, true), feed.toList(Role.B).map { it.fromMe })

        put(feed, "/k3", """{"from":"b","text":"new","at":30}""")
        put(feed, "/k1/heart", "true")
        list = feed.toList(Role.A)
        assertEquals(3, list.size)
        assertTrue(list.first().hearted)
        assertEquals("k3", list.last().key)

        put(feed, "/k2", "null")
        assertEquals(listOf("hello", "new"), feed.toList(Role.A).map { it.text })
        put(feed, "/k1/heart", "null")
        assertFalse(feed.toList(Role.A).first().hearted)
    }

    @Test
    fun patchMergesAndEmptySnapshotClears() {
        val feed = ChatFeed()
        put(feed, "/", "null")
        assertTrue(feed.toList(Role.A).isEmpty())
        feed.apply("patch", """{"path":"/","data":{"k1":{"from":"a","text":"x","at":1},"k2":{"from":"b","text":"y","at":2}}}""")
        assertEquals(2, feed.toList(Role.A).size)
        feed.apply("patch", """{"path":"/k1","data":{"heart":true}}""")
        assertTrue(feed.toList(Role.A).first().hearted)
        put(feed, "/", "null")
        assertTrue(feed.keys.isEmpty())
    }

    @Test
    fun incompleteMessagesAreHiddenAndIdsAreStable() {
        val feed = ChatFeed()
        put(feed, "/k1/heart", "true") // a heart for a message we don't have yet
        put(feed, "/k2", """{"heart":true}""")
        assertTrue(feed.toList(Role.A).isEmpty())
        assertEquals(ChatFeed.idFor("abc"), ChatFeed.idFor("abc"))
        assertNotEquals(ChatFeed.idFor("abc"), ChatFeed.idFor("abd"))
    }

    @Test
    fun newKeysSortByTime() {
        val random = Random(1)
        val earlier = ChatFeed.newKey(1_790_000_000_000, random)
        val later = ChatFeed.newKey(1_790_000_000_001, random)
        assertTrue(earlier < later)
        assertEquals(17, earlier.length)
        assertTrue(earlier.all { it.isLetterOrDigit() })
    }
}

class LiveModelTest {
    private fun tree(json: String) = JsonTree().apply { apply("put", """{"path":"/","data":$json}""") }

    @Test
    fun treeAppliesNestedPutsAndPatches() {
        val t = tree("""{"checkin":{"a":{"mood":4,"energy":3,"at":5}}}""")
        t.apply("put", """{"path":"/checkin/b","data":{"mood":2,"energy":1,"at":6}}""")
        t.apply("patch", """{"path":"/count/a/2026-10","data":{"think":3}}""")
        t.apply("put", """{"path":"/checkin/a/mood","data":5}""")
        assertEquals(CheckIn(5, 3, 5), LiveModel.checkIn(t, Role.A))
        assertEquals(CheckIn(2, 1, 6), LiveModel.checkIn(t, Role.B))
        assertEquals(3, LiveModel.count(t, Role.A, "2026-10", LiveModel.THINK))
        assertEquals(0, LiveModel.count(t, Role.B, "2026-10", LiveModel.THINK))
        t.apply("put", """{"path":"/checkin/b","data":null}""")
        assertNull(LiveModel.checkIn(t, Role.B))
        t.apply("put", """{"path":"/","data":null}""")
        assertNull(LiveModel.checkIn(t, Role.A))
    }

    @Test
    fun tasksAreMineOursOrThePartnersFromEachSide() {
        val t = tree("""{"tasks":{"k1":{"title":"Tickets","owner":"a","done":false,"day":10},"k2":{"title":"Call","owner":"both","done":true,"day":10},"k3":{"title":"x"}}}""")
        val forA = LiveModel.tasks(t, Role.A).associateBy { it.key }
        val forB = LiveModel.tasks(t, Role.B).associateBy { it.key }
        assertEquals(setOf("k1", "k2"), forA.keys)
        assertEquals(app.belong.couple.core.Owner.ME, forA["k1"]!!.owner)
        assertEquals(app.belong.couple.core.Owner.PARTNER, forB["k1"]!!.owner)
        assertEquals(app.belong.couple.core.Owner.OURS, forB["k2"]!!.owner)
        // Written back from either phone, the task still belongs to seat "a".
        assertEquals("a", LiveModel.taskJson(forA["k1"]!!, Role.A).getString("owner"))
        assertEquals("a", LiveModel.taskJson(forB["k1"]!!, Role.B).getString("owner"))
        assertEquals("both", LiveModel.taskJson(forB["k2"]!!, Role.B).getString("owner"))
    }

    @Test
    fun unsentLocalEditsWinOverTheServer() {
        val server = listOf(task("k1", "Server"), task("k2", "Gone"), task("k3", "Kept"))
        val local = listOf(task("k1", "Edited here"), task("k4", "New here"), task("k3", "Old local"))
        val merged = LiveModel.mergeTasks(server, local, dirty = setOf("k1", "k4"), deleted = setOf("k2"))
        assertEquals(listOf("Edited here", "Kept", "New here"), merged.map { it.title })
    }

    private fun task(key: String, title: String) =
        app.belong.couple.core.Task(ChatFeed.idFor(key), title, app.belong.couple.core.Owner.ME, false, 1, key)

    @Test
    fun wishesComeFromBothListsAndReservationsAreLocalOnly() {
        val t = tree("""{"wishes":{"a":{"w1":{"title":"Camera","price":"$90","link":"","note":"","at":5}},"b":{"w2":{"title":"Sweater","at":6},"w3":{"title":"","at":7}}}}""")
        val forA = LiveModel.wishes(t, Role.A).associateBy { it.key }
        assertEquals(setOf("w1", "w2"), forA.keys)
        assertEquals(app.belong.couple.core.Owner.ME, forA["w1"]!!.owner)
        assertEquals(app.belong.couple.core.Owner.PARTNER, forA["w2"]!!.owner)
        assertEquals("Camera", LiveModel.wishJson(forA["w1"]!!).getString("title"))

        val marked = LiveModel.withReservations(forA.values.toList(), server = setOf("w2", "w1"), unsent = emptyMap()).associateBy { it.key }
        assertTrue(marked["w2"]!!.reserved)
        assertFalse(marked["w1"]!!.reserved) // my own wishes never show reservations
        val undone = LiveModel.withReservations(forA.values.toList(), server = setOf("w2"), unsent = mapOf("w2" to false))
        assertFalse(undone.single { it.key == "w2" }.reserved)
    }

    @Test
    fun doodleNeedsPngAndId() {
        assertEquals("d1", LiveModel.doodle(tree("""{"doodle":{"b":{"png":"iVBOR","at":3,"id":"d1"}}}"""), Role.B)!!.id)
        assertNull(LiveModel.doodle(tree("""{"doodle":{"b":{"png":"","at":3,"id":"d1"}}}"""), Role.B))
        assertNull(LiveModel.doodle(tree("""{"doodle":{"b":{"png":"iVBOR","at":3,"id":"d1"}}}"""), Role.A))
    }
}

class DreamsModelTest {
    private fun root(json: String) = org.json.JSONObject(json)

    @Test
    fun dreamsAreMineOursOrThePartnersFromEachSeat() {
        val r = root("""{"dreams":{"d1":{"title":"Japan","emoji":"🌸","cat":"travel","owner":"both","at":2,"goal":"g1"},"d2":{"title":"Corgi","emoji":"🐶","cat":"family","owner":"b","at":3},"d3":{"title":""}}}""")
        val forA = app.belong.couple.core.DreamsModel.dreams(r, Role.A)
        assertEquals(listOf("Corgi", "Japan"), forA.map { it.title }) // newest first
        assertEquals(app.belong.couple.core.Owner.PARTNER, forA[0].owner)
        assertEquals(app.belong.couple.core.Owner.OURS, forA[1].owner)
        assertEquals("g1", forA[1].goalKey)
        assertEquals(app.belong.couple.core.Owner.ME, app.belong.couple.core.DreamsModel.dreams(r, Role.B)[0].owner)
        // The demo couple is stored as me / ours / partner.
        val demo = root("""{"dreams":{"x":{"title":"Salsa","emoji":"💃","cat":"fun","owner":"me","at":1}}}""")
        assertEquals(app.belong.couple.core.Owner.ME, app.belong.couple.core.DreamsModel.dreams(demo, null).single().owner)
    }

    @Test
    fun goalProgressAveragesSavingsAndSteps() {
        val r = root("""{"goals":{"g1":{"title":"Japan","emoji":"🌸","at":0,"target":400,"unit":"₴",
            "saved":{"a":100,"b":100},
            "steps":{"s1":{"title":"Visa","who":"b","done":true,"at":1},"s2":{"title":"Tickets","who":"a","done":false,"at":2,"due":20000}}}}}""")
        val g = app.belong.couple.core.DreamsModel.goal(r, "g1", Role.A)!!
        assertEquals(200L, g.saved)
        assertEquals(100L, g.savedMine)
        assertEquals(50, g.progress) // savings 50%, steps 50%
        assertEquals(listOf("Visa", "Tickets"), g.steps.map { it.title })
        assertEquals(app.belong.couple.core.Owner.PARTNER, g.steps[0].who)
        assertEquals(20000L, g.steps[1].due)
        // At 200 saved in 10 days, the other 200 take 10 more.
        assertEquals(10L, app.belong.couple.core.DreamsModel.daysToTarget(g, 10 * 86_400_000L))
        assertNull(app.belong.couple.core.DreamsModel.daysToTarget(g.copy(savedMine = 300), 10 * 86_400_000L))
        assertEquals(100, g.copy(done = true).progress)
    }

    @Test
    fun queuedChangesApplyOverTheServerCopy() {
        val tree = JsonTree(root("""{"goals":{"g1":{"title":"Japan","saved":{"a":100}}}}"""))
        app.belong.couple.data.DreamsRepo.apply(tree, root("""{"op":"add","path":"goals/g1/saved/a","value":50}"""))
        app.belong.couple.data.DreamsRepo.apply(tree, root("""{"op":"add","path":"goals/g1/saved/b","value":20}"""))
        app.belong.couple.data.DreamsRepo.apply(tree, root("""{"op":"put","path":"dreams/d9","value":{"title":"Dog"}}"""))
        app.belong.couple.data.DreamsRepo.apply(tree, root("""{"op":"del","path":"goals/g1/title"}"""))
        assertEquals(150L, tree.obj("goals", "g1", "saved")!!.getLong("a"))
        assertEquals(20L, tree.obj("goals", "g1", "saved")!!.getLong("b"))
        assertEquals("Dog", tree.obj("dreams", "d9")!!.getString("title"))
        assertFalse(tree.obj("goals", "g1")!!.has("title"))
        assertEquals("i07", app.belong.couple.core.Ideas.key(6))
        assertEquals(6, app.belong.couple.core.Ideas.index("i07"))
    }
}
