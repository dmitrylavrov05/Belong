package app.belong.couple.ui

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.text.InputFilter
import android.text.InputType
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.ScrollView
import android.widget.Spinner
import app.belong.couple.R
import app.belong.couple.core.Cities
import app.belong.couple.data.Account
import app.belong.couple.data.CoupleStore
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Pairing

/** Names, cities and the next meeting date for the couple. */
object SettingsDialog {

    fun show(activity: MainActivity) {
        val ctx = activity
        val store = CoupleStore.get(ctx)
        val form = ctx.column(8).apply {
            val p = ctx.dp(24)
            setPadding(p, ctx.dp(8), p, ctx.dp(8))
        }

        fun label(res: Int) = form.addView(ctx.text(ctx.getString(res), 13f, 700, ctx.col(R.color.ink2)).lp(top = 8))

        fun nameField(value: String): EditText = EditText(ctx).apply {
            setText(value)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            filters = arrayOf(InputFilter.LengthFilter(24))
            maxLines = 1
            typeface = Fonts.get(ctx, 500)
        }

        val cityNames = Cities.all.map { it.name(ctx.language()) }
        fun cityPicker(selectedId: String): Spinner = Spinner(ctx).apply {
            adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, cityNames)
            setSelection(Cities.all.indexOfFirst { it.id == selectedId }.coerceAtLeast(0))
            minimumHeight = ctx.dp(48)
        }

        label(R.string.settings_my_name)
        val myName = nameField(store.myName).also { form.addView(it) }
        label(R.string.settings_partner_name)
        val partnerName = nameField(store.partnerName).also { form.addView(it) }
        label(R.string.settings_nickname)
        val nickname = nameField(store.partnerNickname).apply { hint = ctx.getString(R.string.settings_nickname_hint) }
        form.addView(nickname)
        val ideas = ctx.row(6)
        ctx.resources.getStringArray(R.array.nickname_ideas).forEach { idea ->
            ideas.addView(ctx.chip(idea, false) { nickname.setText(idea) }.apply { textSize = 13f })
        }
        form.addView(android.widget.HorizontalScrollView(ctx).apply {
            isHorizontalScrollBarEnabled = false
            addView(ideas)
        })
        form.addView(ctx.text(ctx.getString(R.string.settings_nickname_note), 12f, 500, ctx.col(R.color.ink2)))

        // Cities and the next meeting only matter for a couple living apart.
        val apart = android.widget.CheckBox(ctx).apply {
            text = ctx.getString(R.string.settings_apart)
            isChecked = store.apart == true
            typeface = Fonts.get(ctx, 600)
            minHeight = ctx.dp(48)
        }
        form.addView(apart.lp(top = 8))
        val apartFields = ctx.column(8)
        form.addView(apartFields)
        fun apartLabel(res: Int) = apartFields.addView(ctx.text(ctx.getString(res), 13f, 700, ctx.col(R.color.ink2)).lp(top = 8))
        apartLabel(R.string.settings_my_city)
        val myCity = cityPicker(store.myCityId).also { apartFields.addView(it) }
        apartLabel(R.string.settings_partner_city)
        val partnerCity = cityPicker(store.partnerCityId).also { apartFields.addView(it) }
        apartLabel(R.string.settings_meeting)
        apartFields.visibility = if (apart.isChecked) android.view.View.VISIBLE else android.view.View.GONE
        apart.setOnCheckedChangeListener { _, on -> apartFields.visibility = if (on) android.view.View.VISIBLE else android.view.View.GONE }

        var meeting = store.meetingDate
        val dateButton = ctx.secondaryButton(ctx.formatLongDate(meeting)) {}
        dateButton.setOnClickListener {
            DatePickerDialog(activity, { _, y, m, d ->
                meeting = java.time.LocalDate.of(y, m + 1, d)
                dateButton.text = ctx.formatLongDate(meeting)
            }, meeting.year, meeting.monthValue - 1, meeting.dayOfMonth).show()
        }
        apartFields.addView(dateButton)

        label(R.string.settings_language)
        val languages = Language.choices.map { if (it.isEmpty()) ctx.getString(R.string.language_system) else Language.nameOf(it) }
        val language = Spinner(ctx).apply {
            adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, languages)
            setSelection(Language.choices.indexOf(Language.current(ctx)).coerceAtLeast(0))
            minimumHeight = ctx.dp(48)
        }
        form.addView(language)
        val account = Account.get(ctx)
        if (!account.paired) form.addView(ctx.text(ctx.getString(R.string.settings_demo), 13f, 500, ctx.col(R.color.ink2)).lp(top = 12))

        AlertDialog.Builder(activity)
            .setTitle(R.string.settings_title)
            .setView(ScrollView(ctx).apply { addView(form) })
            .setPositiveButton(R.string.settings_save) { _, _ ->
                myName.text.toString().takeIf { it.isNotBlank() }?.let { store.myName = it }
                renameOnServer(account, store.myName)
                partnerName.text.toString().takeIf { it.isNotBlank() }?.let { store.partnerName = it }
                store.partnerNickname = nickname.text.toString()
                store.myCityId = Cities.all[myCity.selectedItemPosition].id
                store.partnerCityId = Cities.all[partnerCity.selectedItemPosition].id
                if (apart.isChecked != (store.apart == true)) store.setApart(apart.isChecked)
                if (apart.isChecked && meeting != store.meetingDate) store.meetingDate = meeting
                activity.refreshAll()
                val tag = Language.choices[language.selectedItemPosition]
                if (tag != Language.current(ctx)) Language.set(activity, tag)
            }
            .setNegativeButton(R.string.settings_cancel, null)
            .show()
    }

    /** The partner and the sign-in screen see the name stored with the pair. */
    private fun renameOnServer(account: Account, name: String) {
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
