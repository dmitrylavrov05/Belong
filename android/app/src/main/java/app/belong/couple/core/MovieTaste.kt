package app.belong.couple.core

/** A film or series from TMDB. [poster] is the image path ("/abc.jpg"); [genres] are TMDB genre ids. */
data class Title(
    val id: Int,
    val series: Boolean,
    val name: String,
    val year: Int?,
    val overview: String,
    val poster: String?,
    val genres: List<Int>,
    val rating: Double,
    val votes: Int,
) {
    /** The same key for a title on both phones and in the pair's list: "m157336" or "t1399". */
    val key: String get() = (if (series) "t" else "m") + id
}

/** A suggestion for the two of you, with why it was picked. */
data class Suggestion(val title: Title, val score: Double, val reason: Reason) {
    sealed class Reason {
        /** Similar to [name], which [who] liked: both, or one of you. */
        data class Like(val name: String, val who: Owner) : Reason()
        /** In a genre you both rate highly. */
        data class Genre(val genre: Int) : Reason()
        /** Simply well loved: for a start, before there's much to go on. */
        object Popular : Reason()
    }
}

/**
 * Taste of the pair from your stars. Each watched title moves its genres up (4–5 stars) or down
 * (1–2 stars) for whoever rated it; a suggestion scores by how well it fits the one of you it fits
 * least, so the top of the list is what you'd both enjoy, not what one of you loves and the other can't stand.
 */
object MovieTaste {
    /** TV genres folded into their film counterparts, so a liked series and a liked film count together. */
    private val SAME = mapOf(10759 to listOf(28, 12), 10765 to listOf(878, 14), 10768 to listOf(10752, 36), 10762 to listOf(10751, 16))

    fun normalize(genres: List<Int>): List<Int> = genres.flatMap { SAME[it] ?: listOf(it) }.distinct()

    /** Film genres as TMDB's series genres; those series don't have (thriller, romance, horror…) are dropped. */
    fun forSeries(genres: List<Int>): List<Int> = genres.mapNotNull { g ->
        when (g) {
            28, 12 -> 10759
            878, 14 -> 10765
            10752 -> 10768
            53, 10749, 27, 36, 10402, 10770 -> null
            else -> g
        }
    }.distinct()

    /** Genre → how much this person likes it, from about −2 to +2. Titles without genres don't count. */
    fun affinity(rated: List<Pair<List<Int>, Int>>): Map<Int, Double> {
        val sum = HashMap<Int, Double>()
        val count = HashMap<Int, Int>()
        for ((genres, stars) in rated) {
            val g = normalize(genres)
            if (g.isEmpty()) continue
            val w = (stars - 3).toDouble()
            for (id in g) {
                sum[id] = (sum[id] ?: 0.0) + w
                count[id] = (count[id] ?: 0) + 1
            }
        }
        // Two imaginary neutral ratings per genre keep one lucky film from deciding everything.
        return sum.mapValues { (id, s) -> s / (count.getValue(id) + 2) }
    }

    /** How well [title] fits one person: their genre taste, a nudge for well-rated titles, and liked titles that led to it. */
    fun fit(title: Title, affinity: Map<Int, Double>, likedSources: Int): Double {
        val g = normalize(title.genres)
        val genreFit = if (g.isEmpty()) 0.0 else g.sumOf { affinity[it] ?: 0.0 } / g.size
        val quality = (title.rating - 6.5).coerceIn(-2.0, 2.0) * 0.25
        return genreFit + quality + minOf(likedSources, 2) * 0.6
    }

    /** A candidate and the watched titles (by key) whose recommendations it came from. */
    data class Candidate(val title: Title, val sources: Set<String>)

    /**
     * The suggestions for the pair, best first: candidates minus what's already listed or hidden,
     * scored for both of you. [watched] are the pair's titles with TMDB data and each person's stars.
     */
    fun suggest(
        candidates: List<Candidate>,
        watched: List<Movie>,
        exclude: Set<String>,
    ): List<Suggestion> {
        val mine = affinity(watched.mapNotNull { m -> m.myRating?.let { m.genreIds to it } })
        val theirs = affinity(watched.mapNotNull { m -> m.partnerRating?.let { m.genreIds to it } })
        val byKey = watched.filter { it.tmdbKey != null }.associateBy { it.tmdbKey!! }
        val seen = HashSet<String>()
        return candidates.mapNotNull { c ->
            val t = c.title
            if (t.key in exclude || !seen.add(t.key) || t.votes < 50) return@mapNotNull null
            val sources = c.sources.mapNotNull { byKey[it] }
            val iLiked = sources.filter { (it.myRating ?: 0) >= 4 }
            val theyLiked = sources.filter { (it.partnerRating ?: 0) >= 4 }
            val a = fit(t, mine, iLiked.size)
            val b = fit(t, theirs, theyLiked.size)
            val score = minOf(a, b) * 0.6 + (a + b) / 2 * 0.4
            val both = iLiked.firstOrNull { it in theyLiked }
            val reason = when {
                both != null -> Suggestion.Reason.Like(both.title, Owner.OURS)
                iLiked.isNotEmpty() && theyLiked.isNotEmpty() -> Suggestion.Reason.Like(iLiked.first().title, Owner.OURS)
                iLiked.isNotEmpty() -> Suggestion.Reason.Like(iLiked.first().title, Owner.ME)
                theyLiked.isNotEmpty() -> Suggestion.Reason.Like(theyLiked.first().title, Owner.PARTNER)
                else -> sharedGenre(normalize(t.genres), mine, theirs)?.let { Suggestion.Reason.Genre(it) } ?: Suggestion.Reason.Popular
            }
            Suggestion(t, score, reason)
        }.sortedByDescending { it.score }
    }

    /** The genre of [genres] you both like best, if you both like it at all. */
    private fun sharedGenre(genres: List<Int>, mine: Map<Int, Double>, theirs: Map<Int, Double>): Int? =
        genres.filter { (mine[it] ?: 0.0) > 0 && (theirs[it] ?: 0.0) > 0 }.maxByOrNull { minOf(mine[it]!!, theirs[it]!!) }

    /** Genres you both like, best first: for "more like this" searches. */
    fun topShared(watched: List<Movie>, count: Int): List<Int> {
        val mine = affinity(watched.mapNotNull { m -> m.myRating?.let { m.genreIds to it } })
        val theirs = affinity(watched.mapNotNull { m -> m.partnerRating?.let { m.genreIds to it } })
        val keys = if (theirs.isEmpty()) mine.keys else mine.keys + theirs.keys
        return keys.map { it to minOf(mine[it] ?: if (mine.isEmpty()) 0.0 else -1.0, theirs[it] ?: if (theirs.isEmpty()) mine[it] ?: 0.0 else -1.0) }
            .filter { it.second > 0 }
            .sortedByDescending { it.second }
            .take(count)
            .map { it.first }
    }
}
