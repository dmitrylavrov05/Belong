package app.belong.couple.ui

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.Links
import app.belong.couple.core.Owner
import app.belong.couple.core.WishItem
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.WishRepo

/** Each partner's wishlist. You edit yours; on your partner's you can quietly reserve a gift. */
class WishlistScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val store = CoupleStore.get(ctx)
    private val repo = WishRepo(ctx)
    private var showing = Owner.ME

    private val body = ctx.column(14).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(28))
    }
    override val view: View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }

    init {
        DataEvents.follow(view) { refresh() }
    }

    override fun refresh() {
        body.removeAllViews()
        body.addView(ctx.text(ctx.getString(R.string.wish_title), 28f, 800).apply { letterSpacing = -0.02f })
        body.addView(ctx.segmented(listOf(ctx.getString(R.string.wish_mine), store.partnerDisplay), if (showing == Owner.ME) 0 else 1) {
            showing = if (it == 0) Owner.ME else Owner.PARTNER
            refresh()
        })

        val items = repo.of(showing)
        if (showing == Owner.ME) {
            body.addView(ctx.secondaryButton(ctx.getString(R.string.wish_add), R.drawable.ic_plus) { edit(null) })
            if (items.isNotEmpty()) body.addView(ctx.text(ctx.getString(R.string.wish_tap_hint), 13f, 500, ctx.col(R.color.ink2)))
        }
        if (items.isEmpty()) {
            body.addView(ctx.text(
                ctx.getString(if (showing == Owner.ME) R.string.wish_empty_mine else R.string.wish_empty_partner),
                15f, 500, ctx.col(R.color.ink2),
            ).lp(top = 12))
        }
        items.forEach { body.addView(card(it)) }
    }

    private fun card(item: WishItem): View = ctx.card(spacingDp = 8).apply {
        addView(ctx.text(item.title, 17f, 700))
        if (item.price.isNotBlank()) addView(ctx.text(item.price, 15f, 800, ctx.col(R.color.on_tint)).apply {
            background = ctx.rounded(ctx.col(if (item.owner == Owner.ME) R.color.her_tint else R.color.him_tint), 999f)
            setPadding(ctx.dp(12), ctx.dp(4), ctx.dp(12), ctx.dp(4))
        }.lp(width = WRAP))
        if (item.note.isNotBlank()) addView(ctx.text(item.note, 14f, 400, ctx.col(R.color.ink2)))
        Links.safeUrl(item.link)?.let { url ->
            addView(ctx.text(ctx.getString(R.string.wish_open), 14f, 700).apply {
                setCompoundDrawablesRelative(ctx.icon(R.drawable.ic_link, ctx.col(R.color.ink), 18), null, null, null)
                compoundDrawablePadding = ctx.dp(6)
                minHeight = ctx.dp(44)
                gravity = android.view.Gravity.CENTER_VERTICAL
                setOnClickListener { open(url) }
            })
        }
        if (item.owner == Owner.PARTNER) {
            if (item.reserved) {
                addView(ctx.tintButton(ctx.getString(R.string.wish_reserved), null, ctx.col(R.color.ok_tint), ctx.col(R.color.ok_ink)) {
                    repo.toggleReserved(item.id)
                })
                addView(ctx.text(ctx.getString(R.string.wish_secret, store.partnerDisplay), 13f, 500, ctx.col(R.color.ink2)))
            } else {
                addView(ctx.secondaryButton(ctx.getString(R.string.wish_reserve)) { v ->
                    haptic(v)
                    repo.toggleReserved(item.id)
                })
            }
        } else {
            isClickable = true
            background = ctx.ripple(background, 24f)
            setOnClickListener { edit(item) }
        }
    }

    private fun open(url: String) {
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: ActivityNotFoundException) {
            ctx.toast(url)
        }
    }

    private fun edit(existing: WishItem?) {
        val form = ctx.column(6).apply {
            val p = ctx.dp(24)
            setPadding(p, ctx.dp(8), p, 0)
        }
        fun field(label: Int, value: String, type: Int, max: Int): EditText {
            form.addView(ctx.text(ctx.getString(label), 13f, 700, ctx.col(R.color.ink2)).lp(top = 8))
            return EditText(ctx).apply {
                setText(value)
                inputType = type
                filters = arrayOf(InputFilter.LengthFilter(max))
                typeface = Fonts.get(ctx, 500)
                form.addView(this)
            }
        }
        val title = field(R.string.wish_field_title, existing?.title ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, 80)
        val price = field(R.string.wish_field_price, existing?.price ?: "", InputType.TYPE_CLASS_TEXT, 24)
        val link = field(R.string.wish_field_link, existing?.link ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI, 500)
        val note = field(R.string.wish_field_note, existing?.note ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE, 200)

        val builder = AlertDialog.Builder(activity)
            .setTitle(if (existing == null) R.string.wish_add else R.string.wish_edit)
            .setView(ScrollView(ctx).apply { addView(form) })
            .setPositiveButton(R.string.settings_save, null)
            .setNegativeButton(R.string.settings_cancel, null)
        if (existing != null) builder.setNeutralButton(R.string.delete) { _, _ -> repo.remove(existing.id) }
        val dialog = builder.create()
        dialog.setOnShowListener {
            // Validate before closing, so a typo in the link doesn't lose what was typed.
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = title.text.toString().trim()
                if (name.isEmpty()) {
                    title.error = ctx.getString(R.string.wish_title_required)
                    return@setOnClickListener
                }
                val rawLink = link.text.toString().trim()
                val url = if (rawLink.isEmpty()) "" else Links.safeUrl(rawLink)
                if (url == null) {
                    link.error = ctx.getString(R.string.wish_bad_link)
                    return@setOnClickListener
                }
                repo.upsert(WishItem(
                    id = existing?.id ?: 0L,
                    owner = Owner.ME,
                    title = name,
                    price = price.text.toString().trim(),
                    link = url,
                    note = note.text.toString().trim(),
                    reserved = false,
                    createdAt = existing?.createdAt ?: System.currentTimeMillis(),
                    key = existing?.key ?: "",
                ))
                dialog.dismiss()
            }
        }
        dialog.show()
    }
}

class MoreScreen(private val activity: MainActivity) : Screen {
    private val ctx = activity
    private val body = ctx.column(12).apply {
        val side = ctx.dp(20)
        setPadding(side, ctx.dp(16), side, ctx.dp(28))
    }
    override val view: View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(body)
    }

    override fun refresh() {
        body.removeAllViews()
        body.addView(ctx.text(ctx.getString(R.string.more_title), 28f, 800).apply { letterSpacing = -0.02f })
        body.addView(entry(R.drawable.ic_tab_doodle, R.string.tab_doodle, R.string.more_doodle_text) { activity.select(MainActivity.TAB_DOODLE) })
        body.addView(entry(R.drawable.ic_tab_games, R.string.games_title, R.string.more_games_text) { activity.select(MainActivity.TAB_GAMES) })
        body.addView(entry(R.drawable.ic_tab_month, R.string.month_title, R.string.more_month_text) { activity.select(MainActivity.TAB_MONTH) })
        if (app.belong.couple.data.Account.get(ctx).available) {
            body.addView(entry(R.drawable.ic_heart, R.string.pair_title, R.string.more_pair_text) { PairDialog.show(activity) })
        }
        body.addView(entry(R.drawable.ic_settings, R.string.settings_title, R.string.more_settings_text) { SettingsDialog.show(activity) })
    }

    private fun entry(iconRes: Int, title: Int, text: Int, onClick: () -> Unit): View = ctx.card(paddingDp = 16).apply {
        val row = ctx.row(14)
        row.addView(android.widget.ImageView(ctx).apply {
            setImageDrawable(ctx.icon(iconRes, ctx.col(R.color.on_tint), 22))
            scaleType = android.widget.ImageView.ScaleType.CENTER
            background = ctx.gradient(16f, ctx.col(R.color.her_tint), ctx.col(R.color.him_tint))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
        val texts = ctx.column(2)
        texts.addView(ctx.text(ctx.getString(title), 17f, 700))
        texts.addView(ctx.text(ctx.getString(text), 14f, 400, ctx.col(R.color.ink2)))
        row.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        row.addView(android.widget.ImageView(ctx).apply {
            setImageDrawable(ctx.icon(R.drawable.ic_chevron, ctx.col(R.color.ink2), 20))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        addView(row)
        isClickable = true
        background = ctx.ripple(background, 24f)
        setOnClickListener { onClick() }
    }
}
