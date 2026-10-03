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
import app.belong.couple.data.Account
import app.belong.couple.data.ChatRepo
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.VoiceNotes
import app.belong.couple.demo.DemoPartner
import app.belong.couple.sync.ChatSync
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
        setPadding(p, ctx.dp(8), p, ctx.dp(96)) // room for the floating "thinking of you" button
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

    private val composerBox = android.widget.FrameLayout(ctx)
    private val sendButton = circleButton(R.drawable.ic_send, R.string.chat_send, ctx.gradient(24f, ctx.col(R.color.us_start), ctx.col(R.color.us_end)), ctx.col(R.color.white)) {
        if (input.text.isNullOrBlank()) startRecording() else send()
    }
    private val recordTimer = ctx.text("0:00", 16f, 700)
    private val tick = object : Runnable {
        override fun run() {
            if (!VoiceNotes.recording) return
            recordTimer.text = VoiceNotes.format(VoiceNotes.elapsed())
            recordTimer.postDelayed(this, 250)
        }
    }

    override val view: View = ctx.column().apply {
        addView(header())
        addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.line)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(1)))
        // The "thinking of you" button floats over the bottom of the conversation with two pulsing rings.
        val stage = android.widget.FrameLayout(ctx)
        stage.addView(scroll, android.widget.FrameLayout.LayoutParams(MATCH, MATCH))
        stage.addView(thinkButton(), android.widget.FrameLayout.LayoutParams(ctx.dp(96), ctx.dp(96), android.view.Gravity.BOTTOM or android.view.Gravity.END).apply {
            setMargins(0, 0, ctx.dp(4), 0)
        })
        addView(stage, LinearLayout.LayoutParams(MATCH, 0, 1f))
        addView(typing)
        addView(composer(), LinearLayout.LayoutParams(MATCH, WRAP))
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

    private fun thinkButton(): View = android.widget.FrameLayout(ctx).apply {
        addView(PulseRings(ctx), android.widget.FrameLayout.LayoutParams(MATCH, MATCH))
        addView(ctx.text(ctx.getString(R.string.chat_think_short), 11f, 800, ctx.col(R.color.white)).apply {
            gravity = android.view.Gravity.CENTER
            setLineSpacing(0f, 0.95f)
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
                intArrayOf(ctx.col(R.color.us_start), ctx.col(R.color.us_end)),
            ).apply { shape = android.graphics.drawable.GradientDrawable.OVAL }
            contentDescription = ctx.getString(R.string.chat_heart)
            elevation = ctx.dp(6).toFloat()
            setOnClickListener { v ->
                haptic(v)
                if (Account.get(ctx).paired) {
                    app.belong.couple.sync.LiveSync.signal(ctx, app.belong.couple.sync.LiveModel.THINK) {}
                } else {
                    store.increment(Counter.TAPS_SENT)
                }
                post(ctx.getString(R.string.chat_heart_text))
            }
            pressable()
        }, android.widget.FrameLayout.LayoutParams(ctx.dp(60), ctx.dp(60), android.view.Gravity.CENTER))
    }

    private fun composer(): View {
        input.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: android.text.Editable?) = styleSend()
        })
        styleSend()
        showComposer()
        return composerBox
    }

    /** With nothing typed the round button records a voice message; with text it sends. */
    private fun styleSend() {
        val voice = input.text.isNullOrBlank()
        sendButton.setImageDrawable(ctx.icon(if (voice) R.drawable.ic_mic else R.drawable.ic_send, ctx.col(R.color.white), 20))
        sendButton.contentDescription = ctx.getString(if (voice) R.string.chat_voice else R.string.chat_send)
    }

    private fun showComposer() {
        composerBox.removeAllViews()
        composerBox.addView(ctx.row(8).apply {
            setPadding(ctx.dp(8), ctx.dp(8), ctx.dp(12), ctx.dp(10))
            addView(circleButton(R.drawable.ic_image, R.string.chat_photo, ctx.rounded(ctx.col(R.color.bg), 24f), ctx.col(R.color.ink2)) { pickPhoto() },
                LinearLayout.LayoutParams(ctx.dp(44), ctx.dp(48)))
            (input.parent as? android.view.ViewGroup)?.removeView(input)
            addView(input, LinearLayout.LayoutParams(0, WRAP, 1f))
            (sendButton.parent as? android.view.ViewGroup)?.removeView(sendButton)
            addView(sendButton, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
        })
    }

    /** While recording: a red dot and the time, cancel on the left, send on the right. */
    private fun showRecording() {
        composerBox.removeAllViews()
        composerBox.addView(ctx.row(12).apply {
            setPadding(ctx.dp(12), ctx.dp(8), ctx.dp(12), ctx.dp(10))
            addView(circleButton(R.drawable.ic_trash, R.string.chat_voice_cancel, ctx.rounded(ctx.col(R.color.bg), 24f), ctx.col(R.color.ink2)) {
                VoiceNotes.cancel(ctx)
                showComposer()
            }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
            addView(View(ctx).apply { background = ctx.rounded(ctx.col(R.color.her), 6f) }, LinearLayout.LayoutParams(ctx.dp(12), ctx.dp(12)))
            addView(recordTimer)
            addView(ctx.text(ctx.getString(R.string.chat_recording), 14f, 500, ctx.col(R.color.ink2)), LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(circleButton(R.drawable.ic_send, R.string.chat_send, ctx.gradient(24f, ctx.col(R.color.us_start), ctx.col(R.color.us_end)), ctx.col(R.color.white)) {
                finishRecording()
            }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
        })
        recordTimer.text = "0:00"
        recordTimer.post(tick)
    }

    private fun startRecording() {
        if (ctx.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), MainActivity.REQUEST_MIC)
            return
        }
        if (!VoiceNotes.start(ctx) { finishRecording() }) {
            Toaster.show(activity, ctx.getString(R.string.chat_voice_failed))
            return
        }
        haptic(sendButton)
        showRecording()
    }

    /** Called by MainActivity after the microphone permission dialog. */
    fun onMicPermission(granted: Boolean) {
        if (granted) startRecording() else Toaster.show(activity, ctx.getString(R.string.chat_voice_denied))
    }

    private fun finishRecording() {
        val result = VoiceNotes.finish(ctx)
        showComposer()
        if (result == null) {
            Toaster.show(activity, ctx.getString(R.string.chat_voice_short))
            return
        }
        val (key, seconds) = result
        postMedia(null, key, seconds)
    }

    private fun pickPhoto() {
        val intent = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(android.content.Intent.CATEGORY_OPENABLE)
        }
        try {
            @Suppress("DEPRECATION")
            activity.startActivityForResult(android.content.Intent.createChooser(intent, ctx.getString(R.string.chat_photo)), MainActivity.REQUEST_CHAT_PHOTO)
        } catch (e: android.content.ActivityNotFoundException) {
            Toaster.show(activity, ctx.getString(R.string.photos_no_gallery))
        }
    }

    /** Called by MainActivity with the picked picture: compressed off the main thread, then sent. */
    fun onPhotoPicked(data: android.content.Intent?) {
        val uri = data?.data ?: return
        val app = ctx.applicationContext
        Thread {
            val key = DayPhotos.prepare(app, uri)
            view.post {
                if (key == null) Toaster.show(activity, ctx.getString(R.string.photos_failed)) else postMedia(key, null, 0)
            }
        }.start()
    }

    private fun postMedia(photo: String?, voice: String?, dur: Int) {
        if (Account.get(ctx).paired) {
            ChatSync.sendMedia(ctx, photo, voice, dur)
        } else {
            repo.send("", photo = photo, voice = voice, dur = dur)
            DemoPartner.onChatMessage(ctx) { showTyping() }
        }
    }

    private fun send() {
        if (post(input.text.toString())) input.setText("")
    }

    /** Sends to the partner's phone when paired; in demo mode the simulated partner answers. */
    private fun post(text: String): Boolean {
        if (Account.get(ctx).paired) return ChatSync.send(ctx, text)
        if (repo.send(text) == null) return false
        DemoPartner.onChatMessage(ctx) { showTyping() }
        return true
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
        val time = if (m.pending) ctx.getString(R.string.chat_pending) else DateFormat.getTimeFormat(ctx).format(Date(m.at))
        val body = ctx.column(2).apply {
            background = shape
            if (m.photo != null) setPadding(ctx.dp(5), ctx.dp(5), ctx.dp(10), ctx.dp(6)) else setPadding(ctx.dp(14), ctx.dp(9), ctx.dp(14), ctx.dp(8))
            m.photo?.let { addView(photoView(m, it), LinearLayout.LayoutParams(ctx.dp(220), ctx.dp(260)).apply { bottomMargin = ctx.dp(4) }) }
            m.voice?.let { addView(voiceView(m, it)) }
            if (m.text.isNotEmpty()) addView(ctx.text(m.text, 15f, 500).apply { maxWidth = (ctx.resources.displayMetrics.widthPixels * 0.72f).toInt() })
            addView(ctx.text(if (m.hearted) "❤️  $time" else time, 11f, 600, ctx.col(R.color.on_tint)).apply {
                gravity = Gravity.END
            }, LinearLayout.LayoutParams(MATCH, WRAP))
            isLongClickable = true
            val what = when {
                m.photo != null -> ctx.getString(R.string.chat_photo_message)
                m.voice != null -> ctx.getString(R.string.chat_voice_message, VoiceNotes.format(m.dur))
                else -> m.text
            }
            contentDescription = if (m.hearted) "$what, $time, ${ctx.getString(R.string.chat_hearted)}" else "$what, $time"
            setOnLongClickListener { v ->
                haptic(v)
                if (Account.get(ctx).paired) ChatSync.toggleHeart(ctx, m) else repo.toggleHeart(m.id)
                true
            }
        }
        return LinearLayout(ctx).apply {
            gravity = if (mine) Gravity.END else Gravity.START
            addView(body, LinearLayout.LayoutParams(WRAP, WRAP))
        }
    }

    private fun photoView(m: ChatMessage, key: String): View = roundedImage(ctx, 16f).apply {
        DayPhotos.load(this, key, thumb = false)
        isClickable = true
        setOnClickListener {
            // All photos in the chat, so you can swipe through them.
            val photos = repo.all().filter { it.photo != null }.map {
                app.belong.couple.core.DayPhoto(it.photo!!, Instant.ofEpochMilli(it.at).atZone(ZoneId.systemDefault()).toLocalDate().toEpochDay(),
                    if (it.fromMe) app.belong.couple.core.Owner.ME else app.belong.couple.core.Owner.PARTNER, it.at, it.text)
            }
            PhotosScreen.viewer(activity, photos, photos.indexOfFirst { it.key == key }.coerceAtLeast(0), canDelete = false)
        }
        setOnLongClickListener { v ->
            haptic(v)
            if (Account.get(ctx).paired) ChatSync.toggleHeart(ctx, m) else repo.toggleHeart(m.id)
            true
        }
    }

    /** A play button, a little waveform that fills as it plays, and the length. */
    private fun voiceView(m: ChatMessage, key: String): View = ctx.row(10).apply {
        val play = ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.CENTER
            background = ctx.rounded(ctx.col(if (m.fromMe) R.color.her else R.color.him), 20f)
        }
        val wave = Waveform(ctx, key.hashCode().toLong(), ctx.col(if (m.fromMe) R.color.her else R.color.him))
        val length = ctx.text(VoiceNotes.format(m.dur), 13f, 700, ctx.col(R.color.on_tint))
        fun draw(progress: Float) {
            val playing = progress >= 0f
            play.setImageDrawable(ctx.icon(if (playing) R.drawable.ic_pause else R.drawable.ic_play, ctx.col(R.color.white), 18))
            play.contentDescription = ctx.getString(if (playing) R.string.chat_voice_pause else R.string.chat_voice_play)
            wave.progress = progress.coerceAtLeast(0f)
            length.text = VoiceNotes.format(if (playing) (m.dur * progress).toInt() else m.dur)
        }
        draw(-1f)
        play.setOnClickListener { VoiceNotes.toggle(ctx, key) { p -> draw(p) } }
        addView(play, LinearLayout.LayoutParams(ctx.dp(40), ctx.dp(40)))
        addView(wave, LinearLayout.LayoutParams(ctx.dp(130), ctx.dp(32)))
        addView(length)
    }

    override fun refresh() {
        title.text = store.partnerDisplay
        val city = store.partnerCity
        subtitle.text = if (store.apart == true) "${city.name(ctx.language())} ${ctx.timeIn(city.zone)}" else ""
        subtitle.visibility = if (subtitle.text.isEmpty()) View.GONE else View.VISIBLE
        avatarHolder.removeAllViews()
        avatarHolder.addView(Avatars.view(ctx, app.belong.couple.core.Owner.PARTNER, 42))

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

/** Bars of a voice message, the same shape every time for the same message; played part in colour. */
private class Waveform(context: android.content.Context, seed: Long, private val color: Int) : View(context) {
    private val bars = java.util.Random(seed).let { r -> FloatArray(28) { 0.25f + r.nextFloat() * 0.75f } }
    private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    var progress = 0f
        set(value) {
            field = value
            invalidate()
        }

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun onDraw(canvas: android.graphics.Canvas) {
        val step = width / bars.size.toFloat()
        val w = step * 0.55f
        bars.forEachIndexed { i, h ->
            paint.color = if (i / bars.size.toFloat() < progress) color else (color and 0x00FFFFFF) or 0x55000000
            val bh = height * h
            val x = i * step
            canvas.drawRoundRect(x, (height - bh) / 2, x + w, (height + bh) / 2, w / 2, w / 2, paint)
        }
    }
}
