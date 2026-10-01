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
import app.belong.couple.data.CoupleStore

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
        label(R.string.settings_my_city)
        val myCity = cityPicker(store.myCityId).also { form.addView(it) }
        label(R.string.settings_partner_city)
        val partnerCity = cityPicker(store.partnerCityId).also { form.addView(it) }

        label(R.string.settings_meeting)
        var meeting = store.meetingDate
        val dateButton = ctx.secondaryButton(ctx.formatLongDate(meeting)) {}
        dateButton.setOnClickListener {
            DatePickerDialog(activity, { _, y, m, d ->
                meeting = java.time.LocalDate.of(y, m + 1, d)
                dateButton.text = ctx.formatLongDate(meeting)
            }, meeting.year, meeting.monthValue - 1, meeting.dayOfMonth).show()
        }
        form.addView(dateButton)
        form.addView(ctx.text(ctx.getString(R.string.settings_demo), 13f, 500, ctx.col(R.color.ink2)).lp(top = 12))

        AlertDialog.Builder(activity)
            .setTitle(R.string.settings_title)
            .setView(ScrollView(ctx).apply { addView(form) })
            .setPositiveButton(R.string.settings_save) { _, _ ->
                myName.text.toString().takeIf { it.isNotBlank() }?.let { store.myName = it }
                partnerName.text.toString().takeIf { it.isNotBlank() }?.let { store.partnerName = it }
                store.myCityId = Cities.all[myCity.selectedItemPosition].id
                store.partnerCityId = Cities.all[partnerCity.selectedItemPosition].id
                store.meetingDate = meeting
                activity.refreshAll()
            }
            .setNegativeButton(R.string.settings_cancel, null)
            .show()
    }
}
