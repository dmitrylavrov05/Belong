package app.belong.couple.ui

import android.app.Dialog
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.FeelingsModel
import app.belong.couple.core.FeelingsNote
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.SharedRepo
import app.belong.couple.sync.Feelings
import java.time.Instant
import java.time.ZoneId

/**
 * After a quarrel: each of you writes down what happened, what you feel, what you need and what
 * you'd ask for. Your partner's note opens only once you've written yours.
 */
class FeelingsScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private val body = ctx.column(12).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(8), side, ctx.dp(28))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = scroll

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        body.addView(ctx.text(ctx.getString(R.string.feelings_title), 28f, 700))
        body.addView(ctx.text(ctx.getString(R.string.feelings_intro), 15f, 500, ctx.col(R.color.ink2)))
        body.addView(ctx.primaryButton(ctx.getString(R.string.feelings_write), R.drawable.ic_plus) { write(activity, null) }.lp(top = 4))
        val notes = FeelingsModel.notes(repo.root(), repo.me)
        if (notes.isEmpty()) body.addView(ctx.text(ctx.getString(R.string.feelings_empty), 15f, 500, ctx.col(R.color.ink2)).lp(top = 12))
        notes.forEach { body.addView(noteCard(it)) }
        body.addView(ctx.text(ctx.getString(R.string.feelings_tips), 13f, 500, ctx.col(R.color.ink2)).apply {
            background = ctx.rounded(ctx.col(R.color.sunk), 16f)
            setPadding(ctx.dp(14), ctx.dp(12), ctx.dp(14), ctx.dp(12))
        }.lp(top = 12))
        scroll.post { scroll.scrollTo(0, y) }
    }

    private fun noteCard(n: FeelingsNote): View = ctx.card(paddingDp = 16, spacingDp = 4).apply {
        addView(ctx.text(title(ctx, n), 17f, 700))
        val (status, color) = when {
            n.mineWritten && n.partnerWritten -> ctx.getString(R.string.feelings_both) to R.color.ok_ink
            n.partnerWritten -> ctx.getString(R.string.feelings_partner_wrote, store.partnerDisplay) to R.color.her
            else -> ctx.getString(R.string.feelings_waiting, store.partnerDisplay) to R.color.ink2
        }
        addView(ctx.text(status, 14f, 600, ctx.col(color)))
        isClickable = true
        background = ctx.ripple(background, 24f)
        setOnClickListener { if (n.mineWritten) read(activity, n) else write(activity, n) }
    }

    companion object {
        fun title(ctx: MainActivity, n: FeelingsNote): String {
            val date = ctx.formatLongDate(Instant.ofEpochMilli(n.at).atZone(ZoneId.systemDefault()).toLocalDate())
            return if (n.title.isNotBlank()) "${n.title} · $date" else ctx.getString(R.string.feelings_untitled, date)
        }

        private fun field(ctx: MainActivity, hint: Int, max: Int, lines: Int): EditText = EditText(ctx).apply {
            this.hint = ctx.getString(hint)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
                if (lines > 1) android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE else 0
            filters = arrayOf(android.text.InputFilter.LengthFilter(max))
            typeface = Fonts.get(ctx, 500)
            setTextColor(ctx.col(R.color.ink))
            setHintTextColor(ctx.col(R.color.ink2))
            background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
            setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
            minHeight = ctx.dp(52)
            minLines = lines
            gravity = Gravity.TOP or Gravity.START
        }

        /** A full-screen page with a close button; [build] fills the column. */
        private fun page(ctx: MainActivity, build: (LinearLayout, Dialog) -> Unit): Dialog {
            val dialog = Dialog(ctx, R.style.Theme_Belong)
            val col = ctx.column(12).apply { setPadding(ctx.dp(20), ctx.dp(12), ctx.dp(20), ctx.dp(28)) }
            col.addView(ImageView(ctx).apply {
                setImageDrawable(ctx.icon(R.drawable.ic_close, ctx.col(R.color.ink), 22))
                scaleType = ImageView.ScaleType.CENTER
                contentDescription = ctx.getString(R.string.pair_close)
                background = ctx.ripple(ctx.rounded(ctx.col(R.color.bg), 22f), 22f)
                setOnClickListener { dialog.dismiss() }
            }, LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(44)))
            build(col, dialog)
            dialog.setContentView(ScrollView(ctx).apply {
                setBackgroundColor(ctx.col(R.color.bg))
                isFillViewport = true
                addView(col)
            })
            dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            @Suppress("DEPRECATION")
            dialog.window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            dialog.show()
            return dialog
        }

        /** My side: a new note when [existing] is null, otherwise my answer to the partner's. */
        fun write(ctx: MainActivity, existing: FeelingsNote?) {
            val store = CoupleStore.get(ctx)
            page(ctx) { col, dialog ->
                col.addView(ctx.text(ctx.getString(if (existing == null) R.string.feelings_write else R.string.feelings_answer), 26f, 700))
                col.addView(ctx.text(
                    if (existing == null) ctx.getString(R.string.feelings_write_hint, store.partnerDisplay) else ctx.getString(R.string.feelings_partner_wrote, store.partnerDisplay),
                    15f, 500, ctx.col(R.color.ink2),
                ))
                val title = if (existing == null) field(ctx, R.string.feelings_field_title, 80, 1).also { col.addView(it) } else null
                fun labelled(label: Int, hint: Int): EditText {
                    col.addView(ctx.text(ctx.getString(label), 15f, 700).lp(top = 8))
                    return field(ctx, hint, 1000, 3).also { col.addView(it) }
                }
                val what = labelled(R.string.feelings_what, R.string.feelings_what_hint)
                val feel = labelled(R.string.feelings_feel, R.string.feelings_feel_hint)
                val need = labelled(R.string.feelings_need, R.string.feelings_need_hint)
                val ask = labelled(R.string.feelings_ask, R.string.feelings_ask_hint)
                col.addView(ctx.primaryButton(ctx.getString(R.string.feelings_save)) { button ->
                    val note = Feelings.Note(what.text.toString().trim(), feel.text.toString().trim(), need.text.toString().trim(), ask.text.toString().trim())
                    if (note.feel.isEmpty()) {
                        feel.error = ctx.getString(R.string.feelings_feel_required)
                        feel.requestFocus()
                        return@primaryButton
                    }
                    button.isEnabled = false
                    val key = existing?.key ?: DreamsScreen.newKey()
                    Feelings.write(ctx, key, if (existing == null) title?.text.toString().trim() else null, note) { ok ->
                        button.isEnabled = true
                        if (!ok) {
                            Toaster.show(ctx, ctx.getString(R.string.pair_error_network))
                            return@write
                        }
                        dialog.dismiss()
                        Toaster.show(ctx, ctx.getString(R.string.feelings_sent))
                        if (existing != null) read(ctx, existing.copy(mineWritten = true))
                    }
                }.lp(top = 12))
                feel.post { (title ?: what).requestFocus() }
            }
        }

        /** Both sides, mine first; the partner's once it's written. */
        fun read(ctx: MainActivity, n: FeelingsNote) {
            val store = CoupleStore.get(ctx)
            page(ctx) { col, dialog ->
                col.addView(ctx.text(title(ctx, n), 24f, 700))
                Feelings.mine(ctx, n.key)?.let { col.addView(side(ctx, store.myName, it, R.color.her_tint)) }
                val theirs = ctx.column()
                col.addView(theirs)
                theirs.addView(ctx.text(ctx.getString(R.string.feelings_waiting, store.partnerDisplay), 15f, 500, ctx.col(R.color.ink2)).lp(top = 8))
                if (n.partnerWritten) Feelings.partner(ctx, n.key) { note ->
                    if (!dialog.isShowing || note == null) return@partner
                    theirs.removeAllViews()
                    theirs.addView(side(ctx, store.partnerDisplay, note, R.color.him_tint))
                    theirs.addView(ctx.text(ctx.getString(R.string.feelings_after), 15f, 600, ctx.col(R.color.ink2)).apply { gravity = Gravity.CENTER }.lp(top = 16))
                }
            }
        }

        private fun side(ctx: MainActivity, name: String, note: Feelings.Note, tint: Int): View = ctx.card(paddingDp = 16, spacingDp = 6, background = ctx.rounded(ctx.col(tint), 24f)).apply {
            addView(ctx.text(name, 18f, 800, ctx.col(R.color.on_tint)))
            listOf(
                R.string.feelings_what to note.what,
                R.string.feelings_feel to note.feel,
                R.string.feelings_need to note.need,
                R.string.feelings_ask to note.ask,
            ).filter { it.second.isNotBlank() }.forEach { (label, text) ->
                addView(ctx.text(ctx.getString(label), 13f, 700, ctx.col(R.color.on_tint)).lp(top = 6))
                addView(ctx.text(text, 16f, 500, ctx.col(R.color.ink)))
            }
        }.lp(top = 12)
    }
}
