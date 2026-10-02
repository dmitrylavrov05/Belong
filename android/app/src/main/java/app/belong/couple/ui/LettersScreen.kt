package app.belong.couple.ui

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.Dialog
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.Letter
import app.belong.couple.core.LettersModel
import app.belong.couple.core.Owner
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.SharedRepo
import app.belong.couple.sync.Letters
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * "Open when…": letters to each other that open on a chosen day ("on our anniversary") or when the
 * moment comes ("when you're sad"). Sealed letters can't be read before their day, even by the database.
 */
class LettersScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private val body = ctx.column(12).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(8), side, ctx.dp(104))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = FrameLayout(ctx).apply {
        addView(scroll, FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.fab(ctx.getString(R.string.letters_write)) { write(activity) },
            FrameLayout.LayoutParams(ctx.dp(56), ctx.dp(56), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, ctx.dp(20), ctx.dp(20)) })
    }

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        val now = System.currentTimeMillis()
        val letters = LettersModel.letters(repo.root(), repo.me)
        body.addView(ctx.text(ctx.getString(R.string.letters_title), 28f, 700))
        body.addView(ctx.text(ctx.getString(R.string.letters_intro, store.partnerDisplay), 15f, 500, ctx.col(R.color.ink2)))

        body.addView(ctx.text(ctx.getString(R.string.letters_for_me), 20f, 700).lp(top = 16))
        val forMe = LettersModel.forMe(letters, now)
        if (forMe.isEmpty()) body.addView(ctx.text(ctx.getString(R.string.letters_for_me_empty, store.partnerDisplay), 15f, 500, ctx.col(R.color.ink2)))
        forMe.forEach { body.addView(envelope(it, now)) }

        body.addView(ctx.text(ctx.getString(R.string.letters_from_me), 20f, 700).lp(top = 20))
        val fromMe = LettersModel.fromMe(letters)
        if (fromMe.isEmpty()) body.addView(ctx.text(ctx.getString(R.string.letters_from_me_empty), 15f, 500, ctx.col(R.color.ink2)))
        fromMe.forEach { body.addView(sentRow(it, now)) }
        body.addView(ctx.secondaryButton(ctx.getString(R.string.letters_write), R.drawable.ic_plus) { write(activity) }.lp(top = 8))
        scroll.post { scroll.scrollTo(0, y) }
    }

    /** A letter for me: a bright envelope when it can be opened, a quiet sealed one otherwise. */
    private fun envelope(l: Letter, now: Long): View {
        val open = l.canOpen(now)
        val bg = if (open && !l.opened) ctx.gradient(24f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint)) else ctx.rounded(ctx.col(R.color.surface), 24f)
        return ctx.card(paddingDp = 16, spacingDp = 0, background = bg).apply {
            val row = ctx.row(14)
            row.addView(ctx.text(if (!open) "🔒" else if (l.opened) "📖" else "💌", 26f).apply {
                gravity = Gravity.CENTER
                background = ctx.rounded(ctx.col(if (open) R.color.surface else R.color.sunk), 16f)
            }, LinearLayout.LayoutParams(ctx.dp(52), ctx.dp(52)))
            val texts = ctx.column(2)
            texts.addView(ctx.text(l.title, 16f, 700, ctx.col(if (open) R.color.ink else R.color.ink2)))
            texts.addView(ctx.text(status(ctx, l, now, forMe = true), 13f, 600, ctx.col(if (open && !l.opened) R.color.her else R.color.ink2)))
            row.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(row)
            isClickable = true
            background = ctx.ripple(background, 24f)
            setOnClickListener {
                if (open) read(activity, l) else Toaster.show(activity, ctx.getString(R.string.letters_sealed_toast, untilText(ctx, l, now)))
            }
        }
    }

    private fun sentRow(l: Letter, now: Long): View = ctx.card(paddingDp = 16, spacingDp = 2).apply {
        addView(ctx.text(l.title, 16f, 700))
        addView(ctx.text(status(ctx, l, now, forMe = false), 13f, 600, ctx.col(if (l.opened) R.color.ok_ink else R.color.ink2)))
        isClickable = true
        background = ctx.ripple(background, 24f)
        setOnClickListener { read(activity, l) }
        setOnLongClickListener {
            AlertDialog.Builder(activity).setTitle(R.string.letters_delete).setMessage(l.title)
                .setPositiveButton(R.string.delete) { _, _ -> Letters.delete(ctx, l.key) }
                .setNegativeButton(R.string.settings_cancel, null).show()
            true
        }
    }

    companion object {
        private fun day(at: Long): LocalDate = Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalDate()

        /** "in 12 days · 14 February" for a sealed letter. */
        fun untilText(ctx: MainActivity, l: Letter, now: Long): String {
            val openAt = l.openAt ?: return ""
            val days = ChronoUnit.DAYS.between(day(now), day(openAt)).toInt().coerceAtLeast(1)
            return ctx.resources.getQuantityString(R.plurals.letters_in_days, days, days) + " · " + ctx.formatLongDate(day(openAt))
        }

        fun status(ctx: MainActivity, l: Letter, now: Long, forMe: Boolean): String = when {
            !forMe && l.opened -> ctx.getString(R.string.letters_read_by, CoupleStore.get(ctx).partnerDisplay)
            !l.canOpen(now) -> ctx.getString(R.string.letters_opens, untilText(ctx, l, now))
            !forMe -> ctx.getString(if (l.kind == Letter.Kind.WHEN) R.string.letters_waiting_moment else R.string.letters_can_open_now)
            l.opened -> ctx.getString(R.string.letters_opened)
            else -> ctx.getString(R.string.letters_open_now)
        }

        private fun page(ctx: MainActivity, paper: Boolean, build: (LinearLayout, Dialog) -> Unit): Dialog {
            val dialog = Dialog(ctx, R.style.Theme_Belong)
            val col = ctx.column(12).apply { setPadding(ctx.dp(20), ctx.dp(12), ctx.dp(20), ctx.dp(28)) }
            col.addView(ImageView(ctx).apply {
                setImageDrawable(ctx.icon(R.drawable.ic_close, ctx.col(R.color.ink), 22))
                scaleType = ImageView.ScaleType.CENTER
                contentDescription = ctx.getString(R.string.pair_close)
                background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 22f), 22f)
                setOnClickListener { dialog.dismiss() }
            }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
            build(col, dialog)
            dialog.setContentView(ScrollView(ctx).apply {
                background = if (paper) GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(ctx.col(R.color.her_tint), ctx.col(R.color.bg), ctx.col(R.color.him_tint)))
                else android.graphics.drawable.ColorDrawable(ctx.col(R.color.bg))
                isFillViewport = true
                addView(col)
            })
            dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            @Suppress("DEPRECATION")
            dialog.window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            dialog.show()
            return dialog
        }

        /** Opens a letter: the envelope, then the text on paper, signed by whoever wrote it. */
        fun read(ctx: MainActivity, l: Letter) {
            val store = CoupleStore.get(ctx)
            page(ctx, paper = true) { col, dialog ->
                val envelope = ctx.text("💌", 72f).apply { gravity = Gravity.CENTER }
                col.addView(envelope, LinearLayout.LayoutParams(MATCH, ctx.dp(120)))
                col.addView(ctx.text(l.title, 24f, 800).apply { gravity = Gravity.CENTER })
                val from = if (l.by == Owner.ME) store.myName else store.partnerDisplay
                col.addView(ctx.text(ctx.getString(R.string.letters_from, from, ctx.formatLongDate(day(l.at))), 14f, 600, ctx.col(R.color.ink2)).apply { gravity = Gravity.CENTER })
                val paper = ctx.card(paddingDp = 22, spacingDp = 14, background = ctx.rounded(ctx.col(R.color.surface), 28f))
                val text = ctx.text(ctx.getString(R.string.letters_loading), 18f, 500).apply { setLineSpacing(0f, 1.3f) }
                paper.addView(text)
                paper.addView(ctx.text("— $from", 17f, 700, ctx.col(if (l.by == Owner.ME) R.color.her else R.color.him)).apply { gravity = Gravity.END })
                paper.alpha = 0f
                paper.translationY = ctx.dp(40).toFloat()
                col.addView(paper.lp(top = 8))
                envelope.scaleX = 0.6f
                envelope.scaleY = 0.6f
                envelope.animate().scaleX(1f).scaleY(1f).setDuration(380).withEndAction {
                    paper.animate().alpha(1f).translationY(0f).setDuration(420).start()
                }.start()
                Letters.text(ctx, l.key) { t ->
                    if (!dialog.isShowing) return@text
                    text.text = t ?: ctx.getString(R.string.letters_unavailable)
                    if (t != null && l.by == Owner.PARTNER && !l.opened) Letters.markOpened(ctx, l.key)
                }
            }
        }

        private val WHEN = listOf(R.string.letters_when_sad, R.string.letters_when_miss, R.string.letters_when_sleep, R.string.letters_when_quarrel, R.string.letters_when_proud, R.string.letters_when_doubt)

        /** Writing a letter: when it opens, then the letter itself. */
        fun write(ctx: MainActivity) {
            val store = CoupleStore.get(ctx)
            var dated = true
            var openDay = LocalDate.now().plusDays(7)
            var whenText = ctx.getString(WHEN.first())
            page(ctx, paper = false) { col, dialog ->
                col.addView(ctx.text(ctx.getString(R.string.letters_write), 26f, 700))
                col.addView(ctx.text(ctx.getString(R.string.letters_write_hint, store.partnerDisplay), 15f, 500, ctx.col(R.color.ink2)))
                col.addView(ctx.text(ctx.getString(R.string.letters_when_title), 15f, 700).lp(top = 8))
                val options = FrameLayout(ctx)
                val title = EditText(ctx).apply {
                    inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                    filters = arrayOf(android.text.InputFilter.LengthFilter(80))
                    typeface = Fonts.get(ctx, 600)
                    setTextColor(ctx.col(R.color.ink))
                    setHintTextColor(ctx.col(R.color.ink2))
                    background = ctx.rounded(ctx.col(R.color.surface), 16f, ctx.col(R.color.line))
                    setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
                    minHeight = ctx.dp(52)
                }
                fun defaultTitle() = if (dated) ctx.getString(R.string.letters_open_on, ctx.formatLongDate(openDay)) else whenText
                var lastDefault = defaultTitle()
                fun updateTitle() {
                    val current = title.text.toString()
                    if (current.isEmpty() || current == lastDefault) {
                        lastDefault = defaultTitle()
                        title.setText(lastDefault)
                    } else {
                        lastDefault = defaultTitle()
                    }
                }
                fun drawOptions() {
                    options.removeAllViews()
                    val box = ctx.column(10)
                    box.addView(ctx.segmented(listOf(ctx.getString(R.string.letters_kind_date), ctx.getString(R.string.letters_kind_when)), if (dated) 0 else 1) {
                        dated = it == 0
                        drawOptions()
                        updateTitle()
                    })
                    if (dated) {
                        box.addView(ctx.secondaryButton(ctx.formatLongDate(openDay), R.drawable.ic_calendar) {
                            DatePickerDialog(ctx, { _, y, m, d ->
                                openDay = LocalDate.of(y, m + 1, d)
                                drawOptions()
                                updateTitle()
                            }, openDay.year, openDay.monthValue - 1, openDay.dayOfMonth).apply {
                                datePicker.minDate = System.currentTimeMillis() + 86_400_000L
                            }.show()
                        })
                    } else {
                        val chips = ctx.column(8)
                        WHEN.chunked(2).forEach { pair ->
                            val row = ctx.row(8)
                            pair.forEach { res ->
                                val label = ctx.getString(res)
                                row.addView(ctx.chip(label, label == whenText) {
                                    whenText = label
                                    drawOptions()
                                    updateTitle()
                                }, LinearLayout.LayoutParams(0, WRAP, 1f))
                            }
                            chips.addView(row)
                        }
                        box.addView(chips)
                    }
                    options.addView(box)
                }
                drawOptions()
                col.addView(options)
                col.addView(ctx.text(ctx.getString(R.string.letters_field_title), 15f, 700).lp(top = 8))
                title.setText(lastDefault)
                col.addView(title)
                val text = EditText(ctx).apply {
                    hint = ctx.getString(R.string.letters_field_text, store.partnerDisplay)
                    inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
                    filters = arrayOf(android.text.InputFilter.LengthFilter(5000))
                    typeface = Fonts.get(ctx, 500)
                    textSize = 17f
                    setTextColor(ctx.col(R.color.ink))
                    setHintTextColor(ctx.col(R.color.ink2))
                    background = ctx.rounded(ctx.col(R.color.surface), 20f, ctx.col(R.color.line))
                    setPadding(ctx.dp(18), ctx.dp(16), ctx.dp(18), ctx.dp(16))
                    minLines = 8
                    gravity = Gravity.TOP or Gravity.START
                }
                col.addView(text.lp(top = 8))
                col.addView(ctx.text(ctx.getString(R.string.letters_sealed_note), 13f, 500, ctx.col(R.color.ink2)))
                col.addView(ctx.primaryButton(ctx.getString(R.string.letters_seal), R.drawable.ic_send) { button ->
                    val body = text.text.toString().trim()
                    if (body.isEmpty()) {
                        text.error = ctx.getString(R.string.letters_text_required)
                        text.requestFocus()
                        return@primaryButton
                    }
                    val t = title.text.toString().trim().ifEmpty { defaultTitle() }
                    button.isEnabled = false
                    Letters.write(ctx, if (dated) Letter.Kind.DATE else Letter.Kind.WHEN, t, if (dated) Letters.openAtFor(openDay) else null, body) { ok ->
                        button.isEnabled = true
                        if (!ok) {
                            Toaster.show(ctx, ctx.getString(R.string.pair_error_network))
                            return@write
                        }
                        dialog.dismiss()
                        Toaster.show(ctx, ctx.getString(R.string.letters_sent, store.partnerDisplay))
                    }
                }.lp(top = 8))
            }
        }
    }
}
