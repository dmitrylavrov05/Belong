package app.belong.couple.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.format.DateFormat
import android.text.format.DateUtils
import android.view.View
import android.widget.RemoteViews
import app.belong.couple.R
import app.belong.couple.core.Recap
import app.belong.couple.core.TimeMath
import app.belong.couple.data.CoupleStore
import app.belong.couple.ui.MainActivity
import app.belong.couple.ui.formatLongDate
import app.belong.couple.ui.language
import java.time.LocalDate
import java.util.Date

/** Base for the three home-screen widgets: every update re-renders from CoupleStore. */
abstract class BelongWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        CoupleStore.get(context).ensureSeeded()
        val views = render(context)
        ids.forEach { manager.updateAppWidget(it, views) }
    }

    abstract fun render(context: Context): RemoteViews
}

class MoodWidget : BelongWidget() {
    override fun render(context: Context) = Widgets.mood(context)
}

class CountdownWidget : BelongWidget() {
    override fun render(context: Context) = Widgets.countdown(context)
}

class DoodleWidget : BelongWidget() {
    override fun render(context: Context) = Widgets.doodle(context)
}

object Widgets {
    private fun open(context: Context, tab: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_TAB, tab)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, tab, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun mood(context: Context): RemoteViews {
        val store = CoupleStore.get(context)
        val city = store.partnerCity
        return RemoteViews(context.packageName, R.layout.widget_mood).apply {
            setTextViewText(R.id.widget_mood_emoji, Recap.emojiFor(store.partnerMood))
            setTextViewText(R.id.widget_mood_name, "${store.partnerName} · ${city.name(context.language())}")
            setString(R.id.widget_mood_clock, "setTimeZone", city.zone)
            setProgressBar(R.id.widget_mood_energy, 5, store.partnerEnergy, false)
            setTextViewText(R.id.widget_mood_energy_text, context.getString(R.string.widget_energy, store.partnerEnergy))
            setContentDescription(R.id.widget_root, context.getString(R.string.widget_mood_desc))
            setOnClickPendingIntent(R.id.widget_root, open(context, MainActivity.TAB_TODAY))
        }
    }

    fun countdown(context: Context): RemoteViews {
        val store = CoupleStore.get(context)
        val days = TimeMath.daysUntil(LocalDate.now(), store.meetingDate)
        val (number, label) = when {
            days > 0 -> days.toString() to context.resources.getQuantityString(R.plurals.days_until_label, days.toInt())
            days == 0L -> "❤" to context.getString(R.string.countdown_today)
            else -> "…" to context.getString(R.string.countdown_past)
        }
        return RemoteViews(context.packageName, R.layout.widget_countdown).apply {
            setTextViewText(R.id.widget_countdown_number, number)
            setTextViewText(R.id.widget_countdown_label, label)
            setTextViewText(R.id.widget_countdown_date, if (days >= 0) context.formatLongDate(store.meetingDate) else "")
            setOnClickPendingIntent(R.id.widget_root, open(context, MainActivity.TAB_TODAY))
        }
    }

    fun doodle(context: Context): RemoteViews {
        val store = CoupleStore.get(context)
        val bitmap = store.loadPartnerDoodle(480)
        return RemoteViews(context.packageName, R.layout.widget_doodle).apply {
            if (bitmap == null) {
                setViewVisibility(R.id.widget_doodle_image, View.GONE)
                setViewVisibility(R.id.widget_doodle_caption, View.GONE)
                setViewVisibility(R.id.widget_doodle_empty, View.VISIBLE)
            } else {
                setViewVisibility(R.id.widget_doodle_empty, View.GONE)
                setViewVisibility(R.id.widget_doodle_image, View.VISIBLE)
                setViewVisibility(R.id.widget_doodle_caption, View.VISIBLE)
                setImageViewBitmap(R.id.widget_doodle_image, bitmap)
                setTextViewText(R.id.widget_doodle_caption, context.getString(R.string.widget_from, store.partnerName, whenText(context, store.partnerDoodleAt)))
            }
            setOnClickPendingIntent(R.id.widget_root, open(context, MainActivity.TAB_DOODLE))
        }
    }

    fun whenText(context: Context, at: Long): String =
        if (DateUtils.isToday(at)) DateFormat.getTimeFormat(context).format(Date(at))
        else DateFormat.getMediumDateFormat(context).format(Date(at))

    /** Redraws every placed widget, e.g. after a new doodle or a changed meeting date. */
    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context) ?: return
        val renderers = listOf<Pair<Class<*>, (Context) -> RemoteViews>>(
            MoodWidget::class.java to ::mood,
            CountdownWidget::class.java to ::countdown,
            DoodleWidget::class.java to ::doodle,
        )
        for ((cls, render) in renderers) {
            val ids = manager.getAppWidgetIds(ComponentName(context, cls))
            if (ids.isNotEmpty()) manager.updateAppWidget(ids, render(context))
        }
    }

    /** Asks the launcher to place a widget; returns false when the launcher can't do it. */
    fun requestPin(context: Context, cls: Class<out BelongWidget>): Boolean {
        val manager = AppWidgetManager.getInstance(context) ?: return false
        if (!manager.isRequestPinAppWidgetSupported) return false
        return manager.requestPinAppWidget(ComponentName(context, cls), null, null)
    }
}
