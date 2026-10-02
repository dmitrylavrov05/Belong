package app.belong.couple.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.belong.couple.R
import app.belong.couple.core.Movie
import app.belong.couple.core.MovieTaste
import app.belong.couple.core.MoviesModel
import app.belong.couple.core.Suggestion
import app.belong.couple.core.Title
import app.belong.couple.data.SharedRepo
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * The TMDB API (https://developer.themoviedb.org): search, popular and top-rated lists, genres and
 * "people who liked this also liked". Titles and descriptions come in the app's language.
 */
class Tmdb(private val apiKey: String, private val language: String) {

    val ready: Boolean get() = apiKey.isNotBlank()

    fun search(query: String, page: Int = 1): List<Title> =
        parseList(get("/search/multi", "query=" + URLEncoder.encode(query.trim(), "UTF-8") + "&include_adult=false&page=$page"), null)

    fun recommendations(t: Title): List<Title> = parseList(get("/${kind(t.series)}/${t.id}/recommendations", "page=1"), t.series)

    fun trending(page: Int = 1): List<Title> = parseList(get("/trending/all/week", "page=$page"), null)

    fun topRated(series: Boolean, page: Int = 1): List<Title> = parseList(get("/${kind(series)}/top_rated", "page=$page"), series)

    /** Well-liked titles in any of [genres], most popular first. */
    fun discover(series: Boolean, genres: List<Int>, page: Int = 1): List<Title> = parseList(
        get("/discover/${kind(series)}", "with_genres=${genres.joinToString("%7C")}&sort_by=popularity.desc&vote_count.gte=200&vote_average.gte=6.5&include_adult=false&page=$page"),
        series,
    )

    fun details(id: Int, series: Boolean): Title? = try {
        parseTitle(JSONObject(get("/${kind(series)}/$id", "")), series)
    } catch (e: JSONException) {
        null
    }

    private fun kind(series: Boolean) = if (series) "tv" else "movie"

    private fun get(path: String, query: String): String {
        val url = "$API$path?api_key=$apiKey&language=$language" + if (query.isEmpty()) "" else "&$query"
        return transport(url)
    }

    companion object {
        private const val API = "https://api.themoviedb.org/3"
        private const val IMAGES = "https://image.tmdb.org/t/p/"

        /** Fetches a URL; replaced in tests and previews. */
        @Volatile var transport: (String) -> String = ::fetch

        fun forApp(context: Context): Tmdb {
            val lang = when (context.resources.configuration.locales[0].language) {
                "ru" -> "ru-RU"
                "uk" -> "uk-UA"
                else -> "en-US"
            }
            return Tmdb(context.getString(R.string.tmdb_api_key).trim(), lang)
        }

        /** A poster at [width] px (92, 154, 185, 342, 500). */
        fun poster(path: String, width: Int = 342): String = "${IMAGES}w$width$path"

        val home = "https://www.themoviedb.org"

        private fun fetch(url: String): String {
            val conn = try {
                URL(url).openConnection() as HttpURLConnection
            } catch (e: IOException) {
                throw CloudException(Reason.NETWORK, "TMDB", e)
            }
            try {
                conn.connectTimeout = 10_000
                conn.readTimeout = 15_000
                conn.setRequestProperty("Accept", "application/json")
                val code = conn.responseCode
                if (code == 429) throw CloudException(Reason.TOO_MANY_ATTEMPTS, "TMDB limit")
                if (code == 401) throw CloudException(Reason.DENIED, "TMDB key")
                if (code !in 200..299) throw CloudException(Reason.NETWORK, "TMDB $code")
                return conn.inputStream.bufferedReader().use { it.readText() }
            } catch (e: IOException) {
                throw CloudException(Reason.NETWORK, "TMDB", e)
            } finally {
                conn.disconnect()
            }
        }

        /** Films and series from a list response; people and anything without a name are skipped. */
        fun parseList(body: String, series: Boolean?): List<Title> = try {
            val results = JSONObject(body).optJSONArray("results") ?: JSONArray()
            (0 until results.length()).mapNotNull { i ->
                val o = results.optJSONObject(i) ?: return@mapNotNull null
                val isSeries = when (o.optString("media_type")) {
                    "tv" -> true
                    "movie" -> false
                    "" -> series ?: return@mapNotNull null
                    else -> return@mapNotNull null
                }
                parseTitle(o, isSeries)
            }
        } catch (e: JSONException) {
            emptyList()
        }

        fun parseTitle(o: JSONObject, series: Boolean): Title? {
            val id = o.optInt("id")
            val name = (if (series) o.optString("name") else o.optString("title")).ifEmpty { o.optString("original_title").ifEmpty { o.optString("original_name") } }
            if (id <= 0 || name.isEmpty() || o.optBoolean("adult")) return null
            val date = if (series) o.optString("first_air_date") else o.optString("release_date")
            val genres = o.optJSONArray("genre_ids")?.let { a -> (0 until a.length()).map { a.optInt(it) } }
                ?: o.optJSONArray("genres")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optInt("id") } }
                ?: emptyList()
            return Title(
                id = id,
                series = series,
                name = name,
                year = date.take(4).toIntOrNull(),
                overview = o.optString("overview"),
                poster = o.optString("poster_path").takeIf { it.startsWith("/") && it != "null" },
                genres = genres.filter { it > 0 },
                rating = o.optDouble("vote_average", 0.0).takeUnless { it.isNaN() } ?: 0.0,
                votes = o.optInt("vote_count"),
            )
        }
    }
}

/**
 * Suggestions for the pair: "more like this" for titles either of you gave 4–5 stars, well-liked
 * titles in genres you both enjoy and, while there's little to go on, what's popular this week.
 * Results are kept for a few hours so the list doesn't jump around.
 */
object MovieSuggestions {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private const val KEEP_MS = 6 * 3_600_000L

    @Volatile private var cache: Pair<String, List<MovieTaste.Candidate>>? = null
    @Volatile private var cachedAt = 0L

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("belong_movies", Context.MODE_PRIVATE)

    /** Titles this phone said "not interested" to. */
    fun hidden(context: Context): Set<String> = prefs(context).getStringSet("hidden", emptySet())!!

    fun hide(context: Context, key: String) {
        val p = prefs(context)
        p.edit().putStringSet("hidden", p.getStringSet("hidden", emptySet())!! + key).apply()
    }

    /** Suggestions, best first; null when TMDB can't be reached. Calls back on the main thread. */
    fun load(context: Context, done: (List<Suggestion>?) -> Unit) {
        val app = context.applicationContext
        val repo = SharedRepo(app)
        val movies = MoviesModel.movies(repo.root(), repo.me)
        val tmdb = Tmdb.forApp(app)
        val exclude = movies.mapNotNull { it.tmdbKey }.toSet() + hidden(app)
        worker.execute {
            val result = try {
                MovieTaste.suggest(candidates(tmdb, movies), MoviesModel.watched(movies), exclude)
            } catch (e: CloudException) {
                null
            }
            main.post { done(result) }
        }
    }

    /** Forget cached candidates, e.g. after new stars. */
    fun invalidate() {
        cache = null
    }

    private fun candidates(tmdb: Tmdb, movies: List<Movie>): List<MovieTaste.Candidate> {
        val watched = MoviesModel.watched(movies).filter { it.tmdb != null }
        val liked = watched.filter { maxOf(it.myRating ?: 0, it.partnerRating ?: 0) >= 4 }
            .sortedWith(compareByDescending<Movie> { (it.myRating ?: 0) + (it.partnerRating ?: 0) }.thenByDescending { it.watchedAt ?: 0 })
            .take(6)
        val genres = MovieTaste.topShared(watched, 3)
        val signature = liked.joinToString { it.tmdbKey + ":" + it.myRating + it.partnerRating } + "|" + genres
        cache?.let { (sig, list) -> if (sig == signature && System.currentTimeMillis() - cachedAt < KEEP_MS) return list }

        val found = LinkedHashMap<String, Pair<Title, MutableSet<String>>>()
        fun add(titles: List<Title>, source: String?) = titles.forEach { t ->
            val entry = found.getOrPut(t.key) { t to mutableSetOf() }
            source?.let { entry.second += it }
        }
        var reached = false
        var lastError: CloudException? = null
        fun attempt(block: () -> Unit) = try {
            block()
            reached = true
        } catch (e: CloudException) {
            lastError = e
        }
        liked.forEach { m ->
            val t = Title(m.tmdb!!, m.series, m.title, m.year, "", m.poster, m.genreIds, 0.0, 0)
            attempt { add(tmdb.recommendations(t), m.tmdbKey) }
        }
        if (genres.isNotEmpty()) {
            attempt { add(tmdb.discover(false, genres), null) }
            MovieTaste.forSeries(genres).takeIf { it.isNotEmpty() }?.let { tv -> attempt { add(tmdb.discover(true, tv), null) } }
        }
        if (found.size < 30) {
            attempt { add(tmdb.trending(), null) }
            attempt { add(tmdb.topRated(false), null) }
        }
        if (!reached) throw lastError ?: CloudException(Reason.NETWORK, "TMDB")
        val list = found.values.map { (t, sources) -> MovieTaste.Candidate(t, sources) }
        cache = signature to list
        cachedAt = System.currentTimeMillis()
        return list
    }
}
