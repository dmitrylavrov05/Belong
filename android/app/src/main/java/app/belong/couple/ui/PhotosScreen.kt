package app.belong.couple.ui

import android.app.AlertDialog
import android.app.Dialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.DayPhoto
import app.belong.couple.core.Owner
import app.belong.couple.core.PhotosModel
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import java.time.LocalDate

/**
 * "Our photos": every day each of you can add a few photos. They're grouped by day here and come
 * back in the month and year reports.
 */
class PhotosScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private var filter = 0
    private val body = ctx.column().apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(20), side, ctx.dp(104))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = FrameLayout(ctx).apply {
        addView(scroll, FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.fab(ctx.getString(R.string.photos_add)) { pick(activity) },
            FrameLayout.LayoutParams(ctx.dp(56), ctx.dp(56), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, ctx.dp(20), ctx.dp(20)) })
    }

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val all = PhotosModel.photos(repo.root(), repo.me)
        body.addView(ctx.text(ctx.getString(R.string.photos_title), 28f, 700))
        body.addView(ctx.text(
            if (all.isEmpty()) ctx.getString(R.string.photos_subtitle_empty) else ctx.resources.getQuantityString(R.plurals.photos_count, all.size, all.size),
            15f, 500, ctx.col(R.color.ink2),
        ).lp(top = 4))
        body.addView(todayCard(all).lp(top = 16))
        if (all.isNotEmpty()) {
            body.addView(ctx.segmented(listOf(ctx.getString(R.string.photos_all), store.myName, store.partnerDisplay), filter) {
                filter = it
                refresh()
            }.lp(top = 20))
        }
        val shown = when (filter) {
            1 -> all.filter { it.by == Owner.ME }
            2 -> all.filter { it.by == Owner.PARTNER }
            else -> all
        }
        shown.groupBy { it.day }.forEach { (day, photos) ->
            body.addView(ctx.text(ctx.formatDayHeader(LocalDate.ofEpochDay(day)), 15f, 700).lp(top = 20))
            body.addView(grid(activity, photos, 3).lp(top = 8))
        }
        scroll.post { scroll.scrollTo(0, y) }
    }

    /** Today: how many photos each of you added, and a button for yours. */
    private fun todayCard(all: List<DayPhoto>): View = ctx.card(paddingDp = 16, spacingDp = 10).apply {
        val today = DayPhotos.today()
        val mine = all.count { it.day == today && it.by == Owner.ME }
        val theirs = all.count { it.day == today && it.by == Owner.PARTNER }
        addView(ctx.text(ctx.getString(R.string.photos_today), 17f, 700))
        addView(ctx.text(
            when {
                mine == 0 && theirs == 0 -> ctx.getString(R.string.photos_today_none)
                mine == 0 -> ctx.getString(R.string.photos_today_partner, store.partnerDisplay)
                else -> ctx.getString(R.string.photos_today_mine, mine, PhotosModel.PER_DAY)
            },
            14f, 500, ctx.col(R.color.ink2),
        ))
        if (mine < PhotosModel.PER_DAY) addView(ctx.primaryButton(ctx.getString(R.string.photos_add), R.drawable.ic_plus) { pick(activity) })
    }

    companion object {
        /** Opens the gallery; the result comes back through [MainActivity.onActivityResult]. */
        fun pick(activity: MainActivity) {
            if (DayPhotos.mineOn(activity, DayPhotos.today()) >= PhotosModel.PER_DAY) {
                Toaster.show(activity, activity.getString(R.string.photos_limit, PhotosModel.PER_DAY))
                return
            }
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            try {
                @Suppress("DEPRECATION")
                activity.startActivityForResult(Intent.createChooser(intent, activity.getString(R.string.photos_add)), MainActivity.REQUEST_DAY_PHOTOS)
            } catch (e: android.content.ActivityNotFoundException) {
                Toaster.show(activity, activity.getString(R.string.photos_no_gallery))
            }
        }

        /** The picked photos: a caption for them, then they're added to today. */
        fun picked(activity: MainActivity, data: Intent?) {
            val uris = buildList<Uri> {
                data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { add(it) } }
                if (isEmpty()) data?.data?.let { add(it) }
            }
            if (uris.isEmpty()) return
            val ctx = activity
            val room = PhotosModel.PER_DAY - DayPhotos.mineOn(ctx, DayPhotos.today())
            activity.bottomSheet { sheet, dialog ->
                sheet.addView(ctx.text(ctx.resources.getQuantityString(R.plurals.photos_adding, minOf(uris.size, room), minOf(uris.size, room)), 22f, 700))
                if (uris.size > room) sheet.addView(ctx.text(ctx.getString(R.string.photos_limit, PhotosModel.PER_DAY), 14f, 500, ctx.col(R.color.ink2)))
                val caption = android.widget.EditText(ctx).apply {
                    hint = ctx.getString(R.string.photos_caption)
                    inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    filters = arrayOf(android.text.InputFilter.LengthFilter(200))
                    typeface = Fonts.get(ctx, 500)
                    setTextColor(ctx.col(R.color.ink))
                    setHintTextColor(ctx.col(R.color.ink2))
                    background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
                    setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
                    minHeight = ctx.dp(52)
                }
                sheet.addView(caption)
                sheet.addView(ctx.primaryButton(ctx.getString(R.string.photos_save)) { button ->
                    button.isEnabled = false
                    DayPhotos.add(ctx, uris, caption.text.toString().trim()) { added ->
                        if (dialog.isShowing) dialog.dismiss()
                        Toaster.show(activity, if (added > 0) ctx.resources.getQuantityString(R.plurals.photos_added, added, added) else ctx.getString(R.string.photos_failed))
                    }
                }.lp(top = 8))
            }
        }

        /** Square thumbnails, [columns] to a row, each with a dot for whose photo it is. */
        fun grid(activity: MainActivity, photos: List<DayPhoto>, columns: Int): View = activity.column(6).apply {
            photos.chunked(columns).forEach { chunk ->
                val row = activity.row(6)
                chunk.forEach { p -> row.addView(tile(activity, p, photos), LinearLayout.LayoutParams(0, WRAP, 1f)) }
                repeat(columns - chunk.size) { row.addView(View(activity), LinearLayout.LayoutParams(0, 1, 1f)) }
                addView(row)
            }
        }

        private fun tile(activity: MainActivity, p: DayPhoto, all: List<DayPhoto>): View = object : FrameLayout(activity) {
            override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = super.onMeasure(widthMeasureSpec, widthMeasureSpec)
        }.apply {
            addView(roundedImage(activity, 14f).also { DayPhotos.load(it, p.key, thumb = true) }, FrameLayout.LayoutParams(MATCH, MATCH))
            addView(activity.ownerDot(activity.col(if (p.by == Owner.ME) R.color.her else R.color.him), 10).apply {
                background = activity.rounded(activity.col(if (p.by == Owner.ME) R.color.her else R.color.him), 6f, Color.WHITE, 2f)
            }, FrameLayout.LayoutParams(activity.dp(12), activity.dp(12), Gravity.TOP or Gravity.END).apply { setMargins(0, activity.dp(6), activity.dp(6), 0) })
            contentDescription = p.caption.ifEmpty { activity.formatLongDate(LocalDate.ofEpochDay(p.day)) }
            isClickable = true
            setOnClickListener { viewer(activity, all, all.indexOf(p)) }
        }

        /** Full screen, swipe or tap the sides to go through the photos; your own can be deleted. */
        fun viewer(activity: MainActivity, photos: List<DayPhoto>, start: Int, canDelete: Boolean = true) {
            val store = CoupleStore.get(activity)
            val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
            val stage = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
            var index = start
            val image = ImageView(activity).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
            val caption = activity.text("", 16f, 600, Color.WHITE)
            val meta = activity.text("", 13f, 500, 0xCCFFFFFF.toInt())
            val delete = ImageView(activity).apply {
                setImageDrawable(activity.icon(R.drawable.ic_trash, Color.WHITE, 22))
                scaleType = ImageView.ScaleType.CENTER
                contentDescription = activity.getString(R.string.photos_delete)
                background = activity.ripple(activity.rounded(0x33FFFFFF, 22f), 22f)
            }
            fun show() {
                val p = photos[index]
                DayPhotos.load(image, p.key, thumb = false)
                caption.text = p.caption
                caption.visibility = if (p.caption.isEmpty()) View.GONE else View.VISIBLE
                val who = if (p.by == Owner.ME) store.myName else store.partnerDisplay
                meta.text = "$who · ${activity.formatLongDate(LocalDate.ofEpochDay(p.day))} · ${index + 1}/${photos.size}"
                delete.visibility = if (canDelete && p.by == Owner.ME) View.VISIBLE else View.GONE
            }
            stage.addView(image, FrameLayout.LayoutParams(MATCH, MATCH))
            var downX = 0f
            image.setOnTouchListener { v, e ->
                when (e.action) {
                    android.view.MotionEvent.ACTION_DOWN -> downX = e.x
                    android.view.MotionEvent.ACTION_UP -> {
                        val dx = e.x - downX
                        val next = when {
                            dx < -v.width / 6f -> 1
                            dx > v.width / 6f -> -1
                            e.x > v.width * 0.66f -> 1
                            e.x < v.width * 0.33f -> -1
                            else -> 0
                        }
                        if (next != 0 && index + next in photos.indices) {
                            index += next
                            show()
                        }
                    }
                }
                true
            }
            val top = activity.row(8).apply { setPadding(activity.dp(12), activity.dp(12), activity.dp(12), 0) }
            top.addView(ImageView(activity).apply {
                setImageDrawable(activity.icon(R.drawable.ic_close, Color.WHITE, 22))
                scaleType = ImageView.ScaleType.CENTER
                contentDescription = activity.getString(R.string.pair_close)
                background = activity.ripple(activity.rounded(0x33FFFFFF, 22f), 22f)
                setOnClickListener { dialog.dismiss() }
            }, LinearLayout.LayoutParams(activity.dp(44), activity.dp(44)))
            top.addView(View(activity), LinearLayout.LayoutParams(0, 1, 1f))
            top.addView(delete, LinearLayout.LayoutParams(activity.dp(44), activity.dp(44)))
            delete.setOnClickListener {
                val p = photos[index]
                AlertDialog.Builder(activity).setTitle(R.string.photos_delete)
                    .setPositiveButton(R.string.delete) { _, _ ->
                        DayPhotos.delete(activity, p.key, p.day)
                        dialog.dismiss()
                    }
                    .setNegativeButton(R.string.settings_cancel, null).show()
            }
            stage.addView(top, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.TOP))
            val bottom = activity.column(4).apply {
                setPadding(activity.dp(20), activity.dp(32), activity.dp(20), activity.dp(28))
                background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xAA000000.toInt(), 0))
                addView(caption)
                addView(meta)
            }
            stage.addView(bottom, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM))
            show()
            dialog.setContentView(stage)
            dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            dialog.show()
        }
    }
}
