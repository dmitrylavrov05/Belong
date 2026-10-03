package app.belong.couple.ui

import android.graphics.Bitmap
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import app.belong.couple.R
import app.belong.couple.core.LettersModel
import app.belong.couple.core.MoviesModel
import app.belong.couple.core.PhotosModel
import app.belong.couple.core.Recap
import app.belong.couple.core.ReportModel
import app.belong.couple.core.TogetherModel
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import java.text.NumberFormat
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors

/**
 * "Belong Wrapped": your year as a row of story cards, like Spotify's — taps, photos, the happiest
 * month, the film of the year, dreams that came true, words you wrote, and days together. Cards
 * without anything to say are left out.
 */
object Wrapped {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun show(activity: MainActivity, year: Int = LocalDate.now().year) {
        Toaster.show(activity, activity.getString(R.string.wrapped_making))
        worker.execute {
            val slides = try {
                build(activity, year)
            } catch (e: Exception) {
                emptyList()
            }
            main.post { if (!activity.isFinishing) StoryViewer.show(activity, slides) }
        }
    }

    /** Draws the cards; call off the main thread (photos may be fetched). */
    fun build(a: MainActivity, year: Int): List<Bitmap> {
        val store = CoupleStore.get(a)
        val repo = SharedRepo(a)
        val root = repo.root()
        val me = store.myName
        val partner = store.partnerDisplay
        val nf = NumberFormat.getIntegerInstance(a.locale())
        val now = YearMonth.now()
        val months = (1..12).map { YearMonth.of(year, it) }.filter { it <= now }
        val stats = months.map { store.stats(month = it) }
        val h = ReportModel.year(root, repo.me, year)
        val slides = mutableListOf<Bitmap>()
        var bg = 0
        fun canvas() = StoryKit.canvas(StoryKit.BACKGROUNDS[bg++ % StoryKit.BACKGROUNDS.size])

        // 1. The cover.
        canvas().let { (bmp, c) ->
            StoryKit.mark(c, 360f)
            var y = StoryKit.text(c, a, a.getString(R.string.wrapped_kicker), 44f, 700, StoryKit.INK2, 560f)
            y = StoryKit.big(c, a, a.getString(R.string.wrapped_title, year), y + 30f, 190f)
            y = StoryKit.text(c, a, a.getString(R.string.couple_line, me, partner), 56f, 700, StoryKit.INK, y + 40f)
            StoryKit.text(c, a, a.getString(R.string.wrapped_cover_text), 40f, 500, StoryKit.INK2, y + 60f, 820)
            StoryKit.footer(c, a)
            slides += bmp
        }

        // 2. "Thinking of you".
        val sent = stats.sumOf { it.tapsSent }
        val received = stats.sumOf { it.tapsReceived }
        if (sent + received > 0) canvas().let { (bmp, c) ->
            var y = StoryKit.text(c, a, "💗", 140f, 400, StoryKit.INK, 470f)
            y = StoryKit.text(c, a, a.getString(R.string.wrapped_taps_title), 52f, 700, StoryKit.INK, y + 30f, 860)
            y = StoryKit.big(c, a, nf.format(sent + received), y + 30f)
            y = StoryKit.text(c, a, a.getString(R.string.wrapped_taps_text), 44f, 600, StoryKit.INK2, y + 10f, 860)
            StoryKit.statRow(c, a, y + 90f, "🌸", me, nf.format(sent))
            StoryKit.statRow(c, a, y + 240f, "💙", partner, nf.format(received))
            StoryKit.footer(c, a)
            slides += bmp
        }

        // 3. Photos of the day.
        val photos = PhotosModel.inYear(PhotosModel.photos(root, repo.me), year)
        if (photos.isNotEmpty()) canvas().let { (bmp, c) ->
            var y = StoryKit.text(c, a, a.getString(R.string.wrapped_photos_title), 52f, 700, StoryKit.INK, 420f, 860)
            y = StoryKit.big(c, a, nf.format(photos.size), y + 20f)
            y = StoryKit.text(c, a, a.resources.getQuantityString(R.plurals.wrapped_photo_days, h.photoDays, h.photoDays), 44f, 600, StoryKit.INK2, y + 10f, 860)
            val pics = ReportModel.collage(photos, 3).mapNotNull { DayPhotos.bitmap(a, it.key, thumb = false) }
            val w = 300f
            val total = pics.size * w + (pics.size - 1) * 24f
            pics.forEachIndexed { i, p ->
                val left = (StoryKit.W - total) / 2f + i * (w + 24f)
                StoryKit.polaroid(c, p, RectF(left, y + 110f, left + w, y + 110f + 370f), listOf(-6f, 2f, 7f)[i % 3])
            }
            StoryKit.footer(c, a)
            slides += bmp
        }

        // 4. The happiest month.
        val moods = months.associateWith { store.moodsIn(it) }.filterValues { it.size >= 3 }
        moods.maxByOrNull { it.value.average() }?.let { (month, values) ->
            canvas().let { (bmp, c) ->
                var y = StoryKit.text(c, a, Recap.emojiForAverage(values.average()), 150f, 400, StoryKit.INK, 620f)
                y = StoryKit.text(c, a, a.getString(R.string.wrapped_mood_title), 52f, 700, StoryKit.INK, y + 30f, 860)
                val name = DateTimeFormatter.ofPattern("LLLL", a.locale()).format(month).replaceFirstChar { it.titlecase(a.locale()) }
                y = StoryKit.big(c, a, name, y + 30f, 170f)
                StoryKit.text(c, a, a.getString(R.string.wrapped_mood_text), 42f, 600, StoryKit.INK2, y + 20f, 860)
                StoryKit.footer(c, a)
                slides += bmp
            }
        }

        // 5. Films.
        val watched = MoviesModel.watched(MoviesModel.movies(root, repo.me)).filter { m ->
            m.watchedAt?.let { java.time.Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).year == year } == true
        }
        if (watched.isNotEmpty()) canvas().let { (bmp, c) ->
            var y = StoryKit.text(c, a, "🍿", 140f, 400, StoryKit.INK, 540f)
            y = StoryKit.text(c, a, a.getString(R.string.wrapped_movies_title), 52f, 700, StoryKit.INK, y + 30f, 860)
            y = StoryKit.big(c, a, nf.format(watched.size), y + 20f)
            val best = watched.maxByOrNull { MoviesModel.together(it) ?: ((it.myRating ?: 0) + (it.partnerRating ?: 0)) / 2.0 }
            if (best != null) {
                y = StoryKit.text(c, a, a.getString(R.string.wrapped_movie_of_year), 42f, 600, StoryKit.INK2, y + 40f)
                y = StoryKit.text(c, a, "🎬 " + best.title, 64f, 800, StoryKit.INK, y + 16f, 900)
                MoviesModel.together(best)?.let { avg -> StoryKit.text(c, a, "⭐ " + String.format(a.locale(), "%.1f", avg), 52f, 700, StoryKit.INK2, y + 16f) }
            }
            StoryKit.footer(c, a)
            slides += bmp
        }

        // 6. Dreams and goals.
        val cameTrue = h.dreams + h.goals
        if (cameTrue.isNotEmpty()) canvas().let { (bmp, c) ->
            var y = StoryKit.text(c, a, "✨", 140f, 400, StoryKit.INK, 580f)
            y = StoryKit.text(c, a, a.getString(R.string.wrapped_dreams_title), 52f, 700, StoryKit.INK, y + 30f, 860)
            y = StoryKit.big(c, a, nf.format(cameTrue.size), y + 20f)
            cameTrue.take(4).forEach { y = StoryKit.text(c, a, it, 46f, 700, StoryKit.INK, y + 24f, 900) }
            StoryKit.footer(c, a)
            slides += bmp
        }

        // 7. Words for each other.
        val letters = LettersModel.letters(root, repo.me).count { java.time.Instant.ofEpochMilli(it.at).atZone(ZoneId.systemDefault()).year == year }
        if (h.questions + h.thanks + letters + h.talks > 0) canvas().let { (bmp, c) ->
            var y = StoryKit.text(c, a, "💌", 140f, 400, StoryKit.INK, 520f)
            y = StoryKit.text(c, a, a.getString(R.string.wrapped_words_title), 52f, 700, StoryKit.INK, y + 30f, 860)
            var top = y + 80f
            listOf(
                Triple("💬", a.getString(R.string.stat_questions), h.questions),
                Triple("🌙", a.getString(R.string.stat_thanks), h.thanks),
                Triple("💌", a.getString(R.string.wrapped_letters), letters),
                Triple("🤍", a.getString(R.string.stat_talks), h.talks),
            ).filter { it.third > 0 }.forEach { (e, label, n) ->
                StoryKit.statRow(c, a, top, e, label, nf.format(n))
                top += 150f
            }
            StoryKit.footer(c, a)
            slides += bmp
        }

        // 8. Together.
        canvas().let { (bmp, c) ->
            StoryKit.mark(c, 360f)
            var y = 640f
            TogetherModel.since(root)?.let { since ->
                val days = (LocalDate.now(ZoneId.systemDefault()).toEpochDay() - since).toInt()
                y = StoryKit.text(c, a, a.getString(R.string.wrapped_together_title), 52f, 700, StoryKit.INK, y, 860)
                y = StoryKit.big(c, a, nf.format(days), y + 20f)
                y = StoryKit.text(c, a, a.resources.getQuantityString(R.plurals.days_word, days), 52f, 700, StoryKit.INK2, y)
            }
            y = StoryKit.text(c, a, a.getString(R.string.wrapped_outro, year), 56f, 800, StoryKit.INK, y + 80f, 860)
            StoryKit.text(c, a, a.getString(R.string.couple_line, me, partner), 44f, 600, StoryKit.INK2, y + 30f)
            StoryKit.footer(c, a)
            slides += bmp
        }
        return slides
    }
}
