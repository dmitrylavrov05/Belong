package app.belong.couple.ui

import android.content.Intent
import android.graphics.Color
import android.graphics.Outline
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.core.Picture
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Reason
import app.belong.couple.sync.Unsplash
import java.util.concurrent.Executors

/**
 * Photo suggestions for a dream: a row of Unsplash photos for the dream's title, refreshed as the
 * title changes, with "no photo" first. The chosen photo's credit is shown below the row.
 */
class PhotoPicker(private val activity: android.app.Activity, initial: Picture?) {
    private val ctx = activity
    private val unsplash = Unsplash(ctx.getString(R.string.unsplash_access_key).trim())
    private val main = Handler(Looper.getMainLooper())
    private var pending: Runnable? = null
    private var lastQuery = ""
    private var results: List<Picture> = emptyList()

    var picked: Picture? = initial
        private set

    private val row = ctx.row(8)
    private val status = ctx.text("", 13f, 500, ctx.col(R.color.ink2))
    private val credit = ctx.text("", 12f, 500, ctx.col(R.color.ink2))

    val view: View = ctx.column(8).apply {
        addView(HorizontalScrollView(ctx).apply {
            isHorizontalScrollBarEnabled = false
            addView(row)
        })
        addView(status)
        addView(credit)
    }

    init {
        setStatus(ctx.getString(if (unsplash.ready) R.string.photo_hint else R.string.photo_unavailable))
        render()
    }

    private fun setStatus(text: String) {
        status.text = text
        status.visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
    }

    /** Looks for photos for [query] after a short pause, so typing doesn't fire a search per letter. */
    fun search(query: String) {
        val q = query.trim()
        if (!unsplash.ready || q.length < 3 || q == lastQuery) return
        pending?.let { main.removeCallbacks(it) }
        pending = Runnable {
            lastQuery = q
            setStatus(ctx.getString(R.string.photo_searching))
            pool.execute {
                val found = try {
                    Result.success(unsplash.search(q))
                } catch (e: CloudException) {
                    Result.failure(e)
                }
                main.post {
                    found.onSuccess {
                        results = it
                        setStatus(if (it.isEmpty()) ctx.getString(R.string.photo_none_found) else "")
                    }.onFailure {
                        setStatus(ctx.getString(
                            if ((it as CloudException).reason == Reason.TOO_MANY_ATTEMPTS) R.string.photo_limit else R.string.photo_offline,
                        ))
                    }
                    render()
                }
            }
        }.also { main.postDelayed(it, 700) }
    }

    /** Call when the dream is saved with this photo: Unsplash counts the download. */
    fun confirm() {
        val p = picked ?: return
        if (p.source == "unsplash") pool.execute { unsplash.trackDownload(p) }
    }

    private fun render() {
        row.removeAllViews()
        row.addView(tile(null))
        // A photo picked earlier (or shared from Pinterest) stays first even if it isn't in the results.
        picked?.takeIf { p -> results.none { it.url == p.url } }?.let { row.addView(tile(it)) }
        results.forEach { row.addView(tile(it)) }
        val p = picked
        credit.visibility = if (p == null) View.GONE else View.VISIBLE
        if (p != null) {
            credit.text = if (p.source == "unsplash") ctx.getString(R.string.photo_credit_unsplash, p.by) else ctx.getString(R.string.photo_credit_web, p.by)
            credit.setOnClickListener { open(p.link) }
        }
    }

    private fun tile(picture: Picture?): View {
        val selected = picture?.url == picked?.url
        val frame = FrameLayout(ctx).apply {
            val pad = ctx.dp(3)
            setPadding(pad, pad, pad, pad)
            background = ctx.rounded(if (selected) ctx.col(R.color.her) else Color.TRANSPARENT, 18f)
            contentDescription = picture?.let { ctx.getString(R.string.photo_by, it.by) } ?: ctx.getString(R.string.photo_no_photo)
            isSelected = selected
            setOnClickListener {
                picked = picture
                render()
            }
        }
        if (picture == null) {
            frame.addView(TextView(ctx).apply {
                text = ctx.getString(R.string.photo_no_photo)
                textSize = 12f
                typeface = Fonts.get(ctx, 600)
                setTextColor(ctx.col(R.color.ink2))
                gravity = Gravity.CENTER
                background = ctx.rounded(ctx.col(R.color.sunk), 15f)
            }, FrameLayout.LayoutParams(MATCH, MATCH))
        } else {
            frame.addView(roundedImage(ctx, 15f).also { RemoteImage.load(it, picture.thumb, ctx.dp(96)) }, FrameLayout.LayoutParams(MATCH, MATCH))
        }
        frame.layoutParams = LinearLayout.LayoutParams(ctx.dp(96), ctx.dp(96))
        return frame
    }

    private fun open(url: String) {
        if (!url.startsWith("https://")) return
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: android.content.ActivityNotFoundException) {
            // No browser: nothing to do.
        }
    }

    companion object {
        private val pool = Executors.newSingleThreadExecutor()
    }
}

/** An ImageView that crops to fill and clips to rounded corners. */
fun roundedImage(ctx: android.content.Context, radiusDp: Float): ImageView = ImageView(ctx).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    setBackgroundColor(ctx.col(R.color.sunk))
    val r = ctx.dp(radiusDp).toFloat()
    outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) = outline.setRoundRect(0, 0, view.width, view.height, r)
    }
    clipToOutline = true
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
}
