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
