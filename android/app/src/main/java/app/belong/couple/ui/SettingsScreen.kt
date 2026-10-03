package app.belong.couple.ui

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.content.Intent
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.Cities
import app.belong.couple.core.Owner
import app.belong.couple.core.ProfileModel
import app.belong.couple.core.TogetherModel
import app.belong.couple.core.seatKey
import app.belong.couple.data.Account
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Pairing
import java.time.LocalDate
import java.time.ZoneId

/**
 * Settings: your avatar and name, your partner's name and pet name, how you live (together or
 * apart, since when, cities, the next meeting), the app's language and Today, the pair, and credits.
 * Every change is saved at once.
 */
class SettingsScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = SharedRepo(ctx)
    private val body = ctx.column(10).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(8), side, ctx.dp(32))
    }
    private val scroll = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }
    override val view: View = scroll

    init {
        DataEvents.follow(view) { if (view.isShown) refresh() }
    }

    private val mySeat: String get() = seatKey(repo.me, mine = true)

    override fun refresh() {
        val y = scroll.scrollY
        body.removeAllViews()
        body.addView(ctx.text(ctx.getString(R.string.settings_title), 28f, 700))
        body.addView(header().lp(top = 8))

        section(R.string.settings_section_me)
        group(
            row("🖼", ctx.getString(R.string.settings_avatar), null) { avatarSheet() },
            row("✍️", ctx.getString(R.string.settings_my_name), store.myName) {
                editName(ctx.getString(R.string.settings_my_name), store.myName) { name ->
                    store.myName = name
                    renameOnServer(name)
                }
            },
        )

        section(R.string.settings_section_partner)
        group(
            row("💙", ctx.getString(R.string.settings_partner_name), store.partnerName) {
                editName(ctx.getString(R.string.settings_partner_name), store.partnerName) { store.partnerName = it }
            },
            row("🥰", ctx.getString(R.string.settings_nickname_row), store.partnerNickname.ifEmpty { ctx.getString(R.string.settings_none) }) { nicknameSheet() },
        )

        section(R.string.settings_section_us)
        val apart = store.apart == true
        val since = TogetherModel.since(repo.root())
        val rows = mutableListOf(
            custom(ctx.segmented(listOf("🏡 " + ctx.getString(R.string.mode_together), "✈️ " + ctx.getString(R.string.mode_apart)), if (apart) 1 else 0) {
                if ((it == 1) != apart) {
                    store.setApart(it == 1)
                    activity.refreshAll()
                }
            }),
            row("💞", ctx.getString(R.string.settings_since), since?.let { shortDate(LocalDate.ofEpochDay(it)) } ?: ctx.getString(R.string.settings_none)) { pickSince(since) },
        )
        if (apart) {
            rows += row("📍", ctx.getString(R.string.settings_my_city), store.myCity.name(ctx.language())) { pickCity(true) }
            rows += row("🗺", ctx.getString(R.string.settings_partner_city), store.partnerCity.name(ctx.language())) { pickCity(false) }
            rows += row("📅", ctx.getString(R.string.settings_meeting), shortDate(store.meetingDate)) { pickMeeting() }
        }
        group(*rows.toTypedArray())

        section(R.string.settings_section_app)
        group(
            row("🌐", ctx.getString(R.string.settings_language), Language.current(ctx).let { if (it.isEmpty()) ctx.getString(R.string.language_system) else Language.nameOf(it) }) { languageSheet() },
            row("🏠", ctx.getString(R.string.home_customize), null) { activity.openCustomize() },
            row("📱", ctx.getString(R.string.widgets_title), null) { WidgetsSheet.show(activity) },
        )

        if (Account.get(ctx).available) {
            section(R.string.settings_section_pair)
            group(row("🔗", ctx.getString(R.string.pair_title), null) { PairDialog.show(activity) })
            if (!Account.get(ctx).paired) body.addView(ctx.text(ctx.getString(R.string.settings_demo), 13f, 500, ctx.col(R.color.ink2)).lp(top = 4))
        }

        section(R.string.settings_section_about)
        group(
            row("💗", ctx.getString(R.string.settings_version), version()) {},
            row("📜", ctx.getString(R.string.settings_licenses), null) { licenses() },
        )
        scroll.post { scroll.scrollTo(0, y) }
    }

    // ---------- Building blocks ----------

    /** Both avatars side by side on the pair gradient; tap yours to change it. */
    private fun header(): View = ctx.card(paddingDp = 20, spacingDp = 10, background = ctx.gradient(28f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))).apply {
        gravity = Gravity.CENTER_HORIZONTAL
        val pair = FrameLayout(ctx)
        val mine = Avatars.view(ctx, Owner.ME, 84).apply {
            contentDescription = ctx.getString(R.string.settings_avatar)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            setOnClickListener { avatarSheet() }
        }
        val theirs = Avatars.view(ctx, Owner.PARTNER, 84)
        pair.addView(theirs, FrameLayout.LayoutParams(ctx.dp(84), ctx.dp(84)).apply { leftMargin = ctx.dp(64) })
        pair.addView(FrameLayout(ctx).apply {
            background = ctx.rounded(ctx.col(R.color.surface), 46f)
            setPadding(ctx.dp(4), ctx.dp(4), ctx.dp(4), ctx.dp(4))
            addView(mine)
        }, FrameLayout.LayoutParams(ctx.dp(92), ctx.dp(92)).apply { topMargin = -ctx.dp(4) })
        // A small pencil on my avatar.
        pair.addView(ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_plus, ctx.col(R.color.white), 14))
            scaleType = ImageView.ScaleType.CENTER
            background = ctx.gradient(999f, ctx.col(R.color.us_start), ctx.col(R.color.us_end))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, FrameLayout.LayoutParams(ctx.dp(26), ctx.dp(26)).apply { leftMargin = ctx.dp(62); topMargin = ctx.dp(60) })
        addView(pair, LinearLayout.LayoutParams(ctx.dp(148), ctx.dp(92)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        addView(ctx.text(ctx.getString(R.string.couple_line, store.myName, store.partnerDisplay), 20f, 800, ctx.col(R.color.on_tint)).apply { gravity = Gravity.CENTER })
        TogetherModel.since(repo.root())?.let { since ->
            val days = (LocalDate.now(ZoneId.systemDefault()).toEpochDay() - since).toInt()
            addView(ctx.text(ctx.getString(R.string.home_together, ctx.resources.getQuantityString(R.plurals.days, days, days)), 14f, 600, ctx.col(R.color.on_tint)).apply { gravity = Gravity.CENTER })
        }
    }

    private fun section(title: Int) {
        body.addView(ctx.text(ctx.getString(title), 13f, 700, ctx.col(R.color.ink2)).apply {
            isAllCaps = true
            letterSpacing = 0.06f
            setPadding(ctx.dp(4), 0, 0, 0)
        }.lp(top = 18))
    }

    /** Rows in one card, with thin lines between them. */
    private fun group(vararg rows: View) {
        body.addView(ctx.card(paddingDp = 6, spacingDp = 0).apply {
            rows.forEachIndexed { i, r ->
                if (i > 0) addView(View(ctx).apply { setBackgroundColor(ctx.col(R.color.sunk)) }, LinearLayout.LayoutParams(MATCH, ctx.dp(1)).apply { marginStart = ctx.dp(58) })
                addView(r)
            }
        })
    }

    private fun custom(v: View): View = FrameLayout(ctx).apply {
        setPadding(ctx.dp(8), ctx.dp(8), ctx.dp(8), ctx.dp(8))
        addView(v)
    }

    private fun row(emoji: String, title: String, value: String?, onClick: () -> Unit): View = ctx.row(12).apply {
        minimumHeight = ctx.dp(56)
        setPadding(ctx.dp(10), ctx.dp(6), ctx.dp(10), ctx.dp(6))
        addView(ctx.text(emoji, 18f).apply {
            gravity = Gravity.CENTER
            background = ctx.gradient(12f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
        }, LinearLayout.LayoutParams(ctx.dp(36), ctx.dp(36)))
        addView(ctx.text(title, 16f, 600), LinearLayout.LayoutParams(0, WRAP, 1f))
        if (value != null) addView(ctx.text(value, 15f, 500, ctx.col(R.color.ink2)).apply {
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            maxWidth = ctx.dp(140)
        })
        addView(ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_chevron, ctx.col(R.color.ink2), 16))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        contentDescription = listOfNotNull(title, value).joinToString(", ")
        background = ctx.ripple(ctx.rounded(ctx.col(R.color.surface), 16f), 16f)
        setOnClickListener { onClick() }
    }

    private fun field(value: String, hint: String = ""): EditText = EditText(ctx).apply {
        setText(value)
        this.hint = hint
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        filters = arrayOf(InputFilter.LengthFilter(24))
        maxLines = 1
        typeface = Fonts.get(ctx, 600)
        textSize = 18f
        setTextColor(ctx.col(R.color.ink))
        setHintTextColor(ctx.col(R.color.ink2))
        background = ctx.rounded(ctx.col(R.color.bg), 16f, ctx.col(R.color.line))
        setPadding(ctx.dp(16), ctx.dp(12), ctx.dp(16), ctx.dp(12))
        minHeight = ctx.dp(52)
        setSelection(text.length)
    }

    // ---------- Editing ----------

    private fun editName(title: String, current: String, save: (String) -> Unit) {
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(title, 22f, 700))
            val input = field(current)
            sheet.addView(input)
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.settings_save)) {
                val name = input.text.toString().trim()
                if (name.isEmpty()) {
                    input.error = ctx.getString(R.string.wish_title_required)
                    return@primaryButton
                }
                save(name)
                dialog.dismiss()
                activity.refreshAll()
            }.lp(top = 8))
            input.requestFocus()
        }
    }

    private fun nicknameSheet() {
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.settings_nickname), 22f, 700))
            sheet.addView(ctx.text(ctx.getString(R.string.settings_nickname_note), 14f, 500, ctx.col(R.color.ink2)))
            val input = field(store.partnerNickname, ctx.getString(R.string.settings_nickname_hint))
            sheet.addView(input)
            val ideas = ctx.row(6)
            ctx.resources.getStringArray(R.array.nickname_ideas).forEach { idea ->
                ideas.addView(ctx.chip(idea, idea == input.text.toString()) { input.setText(idea) })
            }
            sheet.addView(HorizontalScrollView(ctx).apply {
                isHorizontalScrollBarEnabled = false
                addView(ideas)
            })
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.settings_save)) {
                store.partnerNickname = input.text.toString().trim()
                dialog.dismiss()
                activity.refreshAll()
            }.lp(top = 8))
            if (store.partnerNickname.isNotEmpty()) sheet.addView(ctx.textButton(ctx.getString(R.string.settings_nickname_clear)) {
                store.partnerNickname = ""
                dialog.dismiss()
                activity.refreshAll()
            })
        }
    }

    /** A photo from the gallery, or an emoji on a colour; both phones see it. */
    private fun avatarSheet() {
        val current = ProfileModel.profile(repo.root(), mySeat)
        var emoji = current.emoji ?: Avatars.EMOJI.first()
        var color = current.color
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.settings_avatar), 22f, 700))
            val preview = FrameLayout(ctx)
            fun drawPreview() {
                preview.removeAllViews()
                preview.addView(Avatars.view(ctx, null, emoji, color, store.myName, R.color.her, 88), FrameLayout.LayoutParams(ctx.dp(88), ctx.dp(88), Gravity.CENTER))
            }
            drawPreview()
            sheet.addView(preview, LinearLayout.LayoutParams(MATCH, ctx.dp(96)))
            sheet.addView(ctx.primaryButton(ctx.getString(R.string.settings_avatar_photo), R.drawable.ic_image) {
                dialog.dismiss()
                pickPhoto()
            })
            sheet.addView(ctx.text(ctx.getString(R.string.settings_avatar_emoji), 14f, 700, ctx.col(R.color.ink2)).lp(top = 6))
            val emojis = ctx.row(6)
            val colors = ctx.row(8)
            fun drawChoices() {
                emojis.removeAllViews()
                Avatars.EMOJI.forEach { e ->
                    emojis.addView(ctx.text(e, 24f).apply {
                        gravity = Gravity.CENTER
                        val on = e == emoji
                        background = ctx.ripple(ctx.rounded(ctx.col(if (on) R.color.her_tint else R.color.sunk), 22f, if (on) ctx.col(R.color.her) else null, 2f), 22f)
                        isSelected = on
                        setOnClickListener {
                            emoji = e
                            drawPreview()
                            drawChoices()
                        }
                    }, LinearLayout.LayoutParams(ctx.dp(46), ctx.dp(46)))
                }
                colors.removeAllViews()
                Avatars.GRADIENTS.forEachIndexed { i, (a, b) ->
                    colors.addView(View(ctx).apply {
                        background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, intArrayOf(a, b)).apply {
                            shape = android.graphics.drawable.GradientDrawable.OVAL
                            if (i == color) setStroke(ctx.dp(3), ctx.col(R.color.ink))
                        }
                        contentDescription = ctx.getString(R.string.settings_avatar_color, i + 1)
                        isSelected = i == color
                        setOnClickListener {
                            color = i
                            drawPreview()
                            drawChoices()
                        }
                    }, LinearLayout.LayoutParams(ctx.dp(40), ctx.dp(40)))
                }
            }
            drawChoices()
            sheet.addView(HorizontalScrollView(ctx).apply {
                isHorizontalScrollBarEnabled = false
                addView(emojis)
            })
            sheet.addView(HorizontalScrollView(ctx).apply {
                isHorizontalScrollBarEnabled = false
                addView(colors)
            })
            sheet.addView(ctx.secondaryButton(ctx.getString(R.string.settings_avatar_use_emoji)) {
                repo.delete("profile/$mySeat/photo")
                repo.put("profile/$mySeat/emoji", emoji)
                repo.put("profile/$mySeat/color", color)
                dialog.dismiss()
            }.lp(top = 4))
            if (current.photo != null || current.emoji != null) sheet.addView(ctx.textButton(ctx.getString(R.string.settings_avatar_remove)) {
                repo.delete("profile/$mySeat")
                dialog.dismiss()
            })
        }
    }

    private fun pickPhoto() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        try {
            @Suppress("DEPRECATION")
            activity.startActivityForResult(Intent.createChooser(intent, ctx.getString(R.string.settings_avatar_photo)), MainActivity.REQUEST_AVATAR)
        } catch (e: android.content.ActivityNotFoundException) {
            Toaster.show(activity, ctx.getString(R.string.photos_no_gallery))
        }
    }

    /** Called by MainActivity with the picked photo. */
    fun onAvatarPicked(data: Intent?) {
        val uri = data?.data ?: return
        DayPhotos.setPhoto(ctx, uri, "profile/$mySeat/photo") { ok ->
            if (ok) repo.delete("profile/$mySeat/emoji") else Toaster.show(activity, ctx.getString(R.string.photos_failed))
        }
    }

    private fun pickSince(current: Long?) {
        val date = LocalDate.ofEpochDay(current ?: (LocalDate.now().toEpochDay() - 365))
        DatePickerDialog(activity, { _, y, m, d ->
            repo.put("couple/since", LocalDate.of(y, m + 1, d).toEpochDay())
        }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
            datePicker.maxDate = System.currentTimeMillis()
        }.show()
    }

    private fun pickMeeting() {
        val date = store.meetingDate
        DatePickerDialog(activity, { _, y, m, d ->
            store.meetingDate = LocalDate.of(y, m + 1, d)
            activity.refreshAll()
        }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
            datePicker.minDate = System.currentTimeMillis() - 1_000
        }.show()
    }

    private fun pickCity(mine: Boolean) {
        val names = Cities.all.map { it.name(ctx.language()) }.toTypedArray()
        val selected = Cities.all.indexOfFirst { it.id == if (mine) store.myCityId else store.partnerCityId }
        AlertDialog.Builder(activity)
            .setTitle(if (mine) R.string.settings_my_city else R.string.settings_partner_city)
            .setSingleChoiceItems(names, selected) { dialog, which ->
                if (mine) store.myCityId = Cities.all[which].id else store.partnerCityId = Cities.all[which].id
                dialog.dismiss()
                activity.refreshAll()
            }
            .show()
    }

    private fun languageSheet() {
        activity.bottomSheet { sheet, dialog ->
            sheet.addView(ctx.text(ctx.getString(R.string.settings_language), 22f, 700))
            val current = Language.current(ctx)
            Language.choices.forEach { tag ->
                val label = if (tag.isEmpty()) ctx.getString(R.string.language_system) else Language.nameOf(tag)
                sheet.addView(ctx.row(12).apply {
                    minimumHeight = ctx.dp(52)
                    setPadding(ctx.dp(12), 0, ctx.dp(12), 0)
                    addView(ctx.text(label, 17f, if (tag == current) 700 else 500), LinearLayout.LayoutParams(0, WRAP, 1f))
                    if (tag == current) addView(ImageView(ctx).apply { setImageDrawable(ctx.icon(R.drawable.ic_check, ctx.col(R.color.her), 20)) })
                    background = ctx.ripple(ctx.rounded(if (tag == current) ctx.col(R.color.her_tint) else ctx.col(R.color.surface), 14f), 14f)
                    setOnClickListener {
                        dialog.dismiss()
                        if (tag != current) Language.set(activity, tag)
                    }
                })
            }
        }
    }

    private fun shortDate(date: LocalDate): String =
        java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM).withLocale(ctx.locale()).format(date)

    private fun version(): String = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
    } catch (e: Exception) {
        ""
    }

    private fun licenses() {
        AlertDialog.Builder(activity)
            .setTitle(R.string.settings_licenses)
            .setMessage(ctx.getString(R.string.settings_licenses_text))
            .setPositiveButton(R.string.pair_close, null)
            .show()
    }

    /** The partner and the sign-in screen see the name stored with the pair. */
    private fun renameOnServer(name: String) {
        val account = Account.get(ctx)
        val seat = account.seat ?: return
        if (name == seat.myName) return
        account.setMyName(name)
        Thread {
            try {
                Pairing(account.config).rename(seat, name.take(24), account.token())
            } catch (e: CloudException) {
                // Offline: the name stays local for now.
                account.setMyName(seat.myName)
            }
        }.start()
    }
}

/** Placing a home-screen widget: the four kinds, one tap each. */
object WidgetsSheet {
    fun show(activity: MainActivity) {
        val ctx = activity
        activity.bottomSheet { sheet, _ ->
            sheet.addView(ctx.text(ctx.getString(R.string.widgets_title), 22f, 700))
            sheet.addView(ctx.text(ctx.getString(R.string.widgets_text), 14f, 500, ctx.col(R.color.ink2)))
            listOf(
                R.string.add_widget_mood to app.belong.couple.widget.MoodWidget::class.java,
                R.string.add_widget_countdown to app.belong.couple.widget.CountdownWidget::class.java,
                R.string.add_widget_doodle to app.belong.couple.widget.DoodleWidget::class.java,
                R.string.add_widget_tasks to app.belong.couple.widget.TasksWidget::class.java,
            ).forEach { (label, cls) ->
                sheet.addView(ctx.secondaryButton("+ " + ctx.getString(label), null) {
                    if (!app.belong.couple.widget.Widgets.requestPin(ctx, cls)) Toaster.show(activity, ctx.getString(R.string.widget_pin_unsupported))
                })
            }
        }
    }
}
