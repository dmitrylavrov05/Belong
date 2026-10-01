package app.belong.couple.ui

import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.text.format.DateFormat
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.ChatMessage
import app.belong.couple.data.ChatRepo
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.data.DataEvents
import app.belong.couple.demo.DemoPartner
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Date

class ChatScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = ChatRepo(ctx)

    private val title = ctx.text("", 18f, 800)
    private val subtitle = ctx.text("", 13f, 500, ctx.col(R.color.ink2))
    private val avatarHolder = LinearLayout(ctx)
    private val messages = ctx.column(6).apply {
        val p = ctx.dp(16)
        setPadding(p, ctx.dp(8), p, ctx.dp(8))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(messages)
    }
    private val typing = ctx.text("", 13f, 500, ctx.col(R.color.ink2)).apply {
        setPadding(ctx.dp(20), 0, ctx.dp(20), ctx.dp(4))
        visibility = View.GONE
    }
    private val input = EditText(ctx).apply {
        hint = ctx.getString(R.string.chat_hint)
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        imeOptions = EditorInfo.IME_ACTION_SEND
        maxLines = 4
        typeface = Fonts.get(ctx, 500)
        setTextColor(ctx.col(R.color.ink))
        setHintTextColor(ctx.col(R.color.ink2))
        background = ctx.rounded(ctx.col(R.color.surface), 22f, ctx.col(R.color.line))
        setPadding(ctx.dp(16), ctx.dp(10), ctx.dp(16), ctx.dp(10))
        minHeight = ctx.dp(48)
        setOnEditorActionListener { _, action, event ->
            if (action == EditorInfo.IME_ACTION_SEND || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)) {
                send()
                true
            } else false
        }
    }

    override val view: View = ctx.column().apply {
        addView(header())
        addView(scroll, LinearLayout.LayoutParams(MATCH, 0, 1f))
        addView(typing)
        addView(composer())
    }

    init {
        DataEvents.follow(view) { refresh() }
    }

    private fun header(): View = ctx.row(12).apply {
        setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(10))
        addView(avatarHolder)
        val texts = ctx.column(1)
        texts.addView(title)
        texts.addView(subtitle)
        addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
    }

    private fun circleButton(iconRes: Int, label: Int, background: android.graphics.drawable.Drawable, tint: Int, onClick: () -> Unit) =
        ImageView(ctx).apply {
            setImageDrawable(ctx.icon(iconRes, tint, 20))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = ctx.getString(label)
            this.background = ctx.ripple(background, 24f)
            setOnClickListener { onClick() }
        }

    private fun composer(): View = ctx.row(8).apply {
        setPadding(ctx.dp(12), ctx.dp(6), ctx.dp(12), ctx.dp(10))
        addView(circleButton(R.drawable.ic_heart, R.string.chat_heart, ctx.rounded(ctx.col(R.color.her_tint), 24f), ctx.col(R.color.on_tint)) {
            haptic(view)
            store.increment(Counter.TAPS_SENT)
            repo.send(ctx.getString(R.string.chat_heart_text))
            DemoPartner.onChatMessage(ctx) { showTyping() }
        }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
        addView(input, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(circleButton(R.drawable.ic_send, R.string.chat_send, ctx.gradient(24f, ctx.col(R.color.us_start), ctx.col(R.color.us_end)), ctx.col(R.color.white)) {
            send()
        }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
    }

    private fun send() {
        val text = input.text.toString()
        if (repo.send(text) == null) return
        input.setText("")
        DemoPartner.onChatMessage(ctx) { showTyping() }
    }

    private fun showTyping() {
        typing.text = ctx.getString(R.string.chat_typing, store.partnerDisplay)
        typing.visibility = View.VISIBLE
    }

    private fun bubble(m: ChatMessage): View {
        val mine = m.fromMe
        val r = ctx.dp(20).toFloat()
        val small = ctx.dp(6).toFloat()
        val shape = GradientDrawable().apply {
            setColor(ctx.col(if (mine) R.color.her_tint else R.color.him_tint))
            cornerRadii = if (mine) floatArrayOf(r, r, r, r, small, small, r, r) else floatArrayOf(r, r, r, r, r, r, small, small)
        }
        val time = DateFormat.getTimeFormat(ctx).format(Date(m.at))
        val body = ctx.column(2).apply {
            background = shape
            setPadding(ctx.dp(14), ctx.dp(9), ctx.dp(14), ctx.dp(8))
            addView(ctx.text(m.text, 15f, 500).apply { maxWidth = (ctx.resources.displayMetrics.widthPixels * 0.72f).toInt() })
            addView(ctx.text(if (m.hearted) "❤️  $time" else time, 11f, 600, ctx.col(R.color.on_tint)).apply {
                gravity = Gravity.END
            }, LinearLayout.LayoutParams(MATCH, WRAP))
            isLongClickable = true
            contentDescription = if (m.hearted) "${m.text}, $time, ${ctx.getString(R.string.chat_hearted)}" else "${m.text}, $time"
            setOnLongClickListener { v ->
                haptic(v)
                repo.toggleHeart(m.id)
                true
            }
        }
        return LinearLayout(ctx).apply {
            gravity = if (mine) Gravity.END else Gravity.START
            addView(body, LinearLayout.LayoutParams(WRAP, WRAP))
        }
    }

    override fun refresh() {
        title.text = store.partnerDisplay
        val city = store.partnerCity
        subtitle.text = "${city.name(ctx.language())} ${ctx.timeIn(city.zone)}"
        avatarHolder.removeAllViews()
        avatarHolder.addView(ctx.avatar(store.partnerDisplay, ctx.col(R.color.us_end), 42))

        val all = repo.all()
        if (all.lastOrNull()?.fromMe == false) typing.visibility = View.GONE
        messages.removeAllViews()
        var day: LocalDate? = null
        val zone = ZoneId.systemDefault()
        for (m in all) {
            val d = Instant.ofEpochMilli(m.at).atZone(zone).toLocalDate()
            if (d != day) {
                day = d
                messages.addView(ctx.text(ctx.formatDayHeader(d), 12f, 700, ctx.col(R.color.ink2)).apply {
                    gravity = Gravity.CENTER
                    setPadding(0, ctx.dp(10), 0, ctx.dp(4))
                }, LinearLayout.LayoutParams(MATCH, WRAP))
            }
            messages.addView(bubble(m), LinearLayout.LayoutParams(MATCH, WRAP))
        }
        scroll.post { scroll.scrollTo(0, messages.bottom) }
    }
}
