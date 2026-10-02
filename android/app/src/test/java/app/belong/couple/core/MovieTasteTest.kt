package app.belong.couple.core

import app.belong.couple.sync.Tmdb
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MovieTasteTest {
    private val DRAMA = 18
    private val ROMANCE = 10749
    private val HORROR = 27
    private val COMEDY = 35

    private fun watched(id: Int, genres: List<Int>, mine: Int?, theirs: Int?) =
        Movie("k$id", "Film $id", false, Owner.ME, 0, true, id.toLong(), mine, theirs, tmdb = id, genreIds = genres)

    private fun title(id: Int, genres: List<Int>, rating: Double = 7.0, series: Boolean = false) =
        Title(id, series, "T$id", 2020, "", null, genres, rating, 1000)

    @Test
    fun affinityFollowsStarsAndIsDampened() {
        val a = MovieTaste.affinity(listOf(listOf(DRAMA, ROMANCE) to 5, listOf(HORROR) to 1))
        assertEquals(2.0 / 3, a[DRAMA]!!, 1e-9)
        assertEquals(-2.0 / 3, a[HORROR]!!, 1e-9)
        assertNull(a[COMEDY])
        // TV "Sci-Fi & Fantasy" counts as both film genres.
        assertEquals(listOf(878, 14), MovieTaste.normalize(listOf(10765)))
    }

    @Test
    fun suggestionsFavourWhatBothLikeOverWhatOneLoves() {
        val history = listOf(
            watched(1, listOf(DRAMA, ROMANCE), 5, 5),
            watched(2, listOf(HORROR), 5, 1),
            watched(3, listOf(COMEDY), 2, 4),
        )
        val candidates = listOf(
            MovieTaste.Candidate(title(10, listOf(HORROR)), setOf("m2")),
            MovieTaste.Candidate(title(11, listOf(ROMANCE, DRAMA)), setOf("m1")),
            MovieTaste.Candidate(title(12, listOf(COMEDY)), emptySet()),
            MovieTaste.Candidate(title(13, listOf(DRAMA)), emptySet()),
        )
        val list = MovieTaste.suggest(candidates, history, exclude = setOf("m13"))
        assertEquals(listOf(11, 12, 10), list.map { it.title.id })
        val top = list.first().reason as Suggestion.Reason.Like
        assertEquals("Film 1", top.name)
        assertEquals(Owner.OURS, top.who)
        assertEquals(Owner.ME, (list.last().reason as Suggestion.Reason.Like).who)
    }

    @Test
    fun withoutStarsPopularTitlesStillComeThrough() {
        val list = MovieTaste.suggest(listOf(MovieTaste.Candidate(title(5, listOf(DRAMA), 8.5), emptySet()), MovieTaste.Candidate(title(6, listOf(DRAMA), 6.0), emptySet())), emptyList(), emptySet())
        assertEquals(listOf(5, 6), list.map { it.title.id })
        assertTrue(list.all { it.reason == Suggestion.Reason.Popular })
    }

    @Test
    fun sharedGenresOnlyWhereBothAgree() {
        val history = listOf(watched(1, listOf(DRAMA, ROMANCE), 5, 4), watched(2, listOf(HORROR), 5, 1))
        assertEquals(listOf(DRAMA, ROMANCE).toSet(), MovieTaste.topShared(history, 3).toSet())
    }

    @Test
    fun parsesTmdbListsAndDetails() {
        val body = """{"results":[
            {"media_type":"movie","id":76,"title":"Перед рассветом","release_date":"1995-01-27","poster_path":"/a.jpg","genre_ids":[18,10749],"vote_average":7.7,"vote_count":3500,"overview":"Поезд"},
            {"media_type":"tv","id":136315,"name":"Медведь","first_air_date":"2022-06-23","poster_path":null,"genre_ids":[18,35],"vote_average":8.2,"vote_count":900},
            {"media_type":"person","id":1,"name":"Someone"}
        ]}"""
        val list = Tmdb.parseList(body, null)
        assertEquals(listOf("m76", "t136315"), list.map { it.key })
        assertEquals(1995, list[0].year)
        assertEquals("/a.jpg", list[0].poster)
        assertNull(list[1].poster)
        val details = Tmdb.parseTitle(org.json.JSONObject("""{"id":157336,"title":"Интерстеллар","genres":[{"id":12,"name":"x"},{"id":878,"name":"y"}],"release_date":"2014-11-05"}"""), false)!!
        assertEquals(listOf(12, 878), details.genres)
        assertEquals(emptyList<Title>(), Tmdb.parseList("not json", false))
    }
}
