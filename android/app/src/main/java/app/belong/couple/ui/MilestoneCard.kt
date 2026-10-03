package app.belong.couple.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import app.belong.couple.R
import app.belong.couple.core.Milestone
import app.belong.couple.core.TodayModel
import app.belong.couple.core.TogetherModel
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.Executors

/** "1000 days together": a story card on your cover photo for round numbers and anniversaries. */
object MilestoneCard {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** Shows the card for [milestone], or for today's count when it's null. */
    fun show(a: MainActivity, milestone: Milestone? = null) {
        val since = TogetherModel.since(SharedRepo(a).root())
        if (since == null) {
            Toaster.show(a, a.getString(R.string.us_set_since))
            return
        }
        val today = LocalDate.now(ZoneId.systemDefault()).toEpochDay()
        val m = milestone ?: Milestone((today - since).toInt(), null, today)
        worker.execute {
            val bmp = render(a, m, since)
            main.post { if (!a.isFinishing) StoryViewer.show(a, listOf(bmp), autoAdvance = false) }
        }
    }

    fun render(a: MainActivity, m: Milestone, since: Long): Bitmap {
        val store = CoupleStore.get(a)
        val cover = TodayModel.cover(SharedRepo(a).root())?.let { DayPhotos.bitmap(a, it, thumb = false) }
        val (bmp, c) = StoryKit.canvas(StoryKit.BACKGROUNDS[0])
        val onPhoto = cover != null
        if (cover != null) {
            StoryKit.photo(c, cover, RectF(0f, 0f, StoryKit.W.toFloat(), StoryKit.H.toFloat()), 0f)
            c.drawRect(0f, 0f, StoryKit.W.toFloat(), StoryKit.H.toFloat(), Paint().apply {
                shader = LinearGradient(0f, 0f, 0f, StoryKit.H.toFloat(), intArrayOf(0x33000000, 0x22000000, 0xCC000000.toInt()), floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP)
            })
        } else {
            StoryKit.mark(c, 420f)
        }
        val ink = if (onPhoto) 0xFFFFFFFF.toInt() else StoryKit.INK
        val ink2 = if (onPhoto) 0xE6FFFFFF.toInt() else StoryKit.INK2
        val nf = NumberFormat.getIntegerInstance(a.locale())
        var y = if (onPhoto) 1020f else 640f
        y = StoryKit.text(c, a, if (m.years != null) "🎉" else "💞", 110f, 400, ink, y)
        if (m.years != null) {
            y = drawBig(c, a, nf.format(m.years), y + 10f, onPhoto)
            y = StoryKit.text(c, a, a.resources.getQuantityString(R.plurals.milestone_years_label, m.years), 64f, 800, ink, y)
        } else {
            y = drawBig(c, a, nf.format(m.days), y + 10f, onPhoto)
            y = StoryKit.text(c, a, a.resources.getQuantityString(R.plurals.milestone_days_label, m.days), 64f, 800, ink, y)
        }
        y = StoryKit.text(c, a, a.getString(R.string.couple_line, store.myName, store.partnerDisplay), 50f, 700, ink2, y + 30f)
        StoryKit.text(c, a, a.getString(R.string.milestone_since, a.formatLongDate(LocalDate.ofEpochDay(since))), 38f, 600, ink2, y + 16f)
        StoryKit.text(c, a, a.getString(R.string.story_footer), 38f, 700, ink2, StoryKit.H - 130f)
        return bmp
    }

    private fun drawBig(c: Canvas, a: MainActivity, value: String, top: Float, white: Boolean): Float {
        if (!white) return StoryKit.big(c, a, value, top, 260f)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Fonts.get(a, 800)
            textSize = 260f
            textAlign = Paint.Align.CENTER
            color = 0xFFFFFFFF.toInt()
            setShadowLayer(30f, 0f, 6f, 0x55000000)
        }
        val baseline = top + p.textSize * 0.82f
        c.drawText(value, StoryKit.W / 2f, baseline, p)
        return baseline + p.textSize * 0.12f
    }
}
