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
import app.belong.couple.core.Owner
import app.belong.couple.core.Recap
import app.belong.couple.core.TaskList
import app.belong.couple.core.TimeMath
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.TaskRepo
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

/** Today's tasks; tapping a row ticks it off right on the home screen. */
class TasksWidget : BelongWidget() {
    override fun render(context: Context) = Widgets.tasks(context)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_TOGGLE) {
            val id = intent.getLongExtra(EXTRA_ID, -1L)
            if (id != -1L) TaskRepo(context).toggle(id)
            Widgets.updateAll(context)
        } else {
            super.onReceive(context, intent)
        }
    }

    companion object {
        const val ACTION_TOGGLE = "app.belong.couple.TOGGLE_TASK"
        const val EXTRA_ID = "id"
    }
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
            setTextViewText(R.id.widget_mood_name, "${store.partnerDisplay} · ${city.name(context.language())}")
            setString(R.id.widget_mood_clock, "setTimeZone", city.zone)
            setProgressBar(R.id.widget_mood_energy, 5, store.partnerEnergy, false)
            setTextViewText(R.id.widget_mood_energy_text, context.getString(R.string.widget_energy, store.partnerEnergy))
            setContentDescription(R.id.widget_root, context.getString(R.string.widget_mood_desc))
            setOnClickPendingIntent(R.id.widget_root, open(context, MainActivity.TAB_TODAY))
        }
    }

    fun countdown(context: Context): RemoteViews {
        val store = CoupleStore.get(context)
        if (store.apart != true) return nextDate(context)
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

    /** For a couple living together: the next important date from the calendar. */
    private fun nextDate(context: Context): RemoteViews {
        val today = LocalDate.now().toEpochDay()
        val next = app.belong.couple.core.CalendarModel.upcoming(
            app.belong.couple.data.SharedRepo(context).root(), today, context.getString(R.string.calendar_anniversary), context.getString(R.string.countdown_title),
        ).firstOrNull()
        return RemoteViews(context.packageName, R.layout.widget_countdown).apply {
            if (next == null) {
                setTextViewText(R.id.widget_countdown_number, "📅")
                setTextViewText(R.id.widget_countdown_label, context.getString(R.string.calendar_add_first))
                setTextViewText(R.id.widget_countdown_date, "")
            } else {
                setTextViewText(R.id.widget_countdown_number, if (next.daysLeft == 0L) "❤" else next.daysLeft.toString())
                setTextViewText(R.id.widget_countdown_label, "${next.emoji} ${next.title}")
                setTextViewText(R.id.widget_countdown_date, context.formatLongDate(LocalDate.ofEpochDay(next.date)))
            }
            setOnClickPendingIntent(R.id.widget_root, open(context, MainActivity.TAB_CALENDAR))
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
                setTextViewText(R.id.widget_doodle_caption, context.getString(R.string.widget_from, store.partnerDisplay, whenText(context, store.partnerDoodleAt)))
            }
            setOnClickPendingIntent(R.id.widget_root, open(context, MainActivity.TAB_DOODLE))
        }
    }

    private val taskRows = listOf(
        Triple(R.id.task_row_0, R.id.task_check_0, R.id.task_title_0) to R.id.task_dot_0,
        Triple(R.id.task_row_1, R.id.task_check_1, R.id.task_title_1) to R.id.task_dot_1,
        Triple(R.id.task_row_2, R.id.task_check_2, R.id.task_title_2) to R.id.task_dot_2,
        Triple(R.id.task_row_3, R.id.task_check_3, R.id.task_title_3) to R.id.task_dot_3,
        Triple(R.id.task_row_4, R.id.task_check_4, R.id.task_title_4) to R.id.task_dot_4,
    )

    fun tasks(context: Context): RemoteViews {
        val tasks = TaskRepo(context).forToday()
        return RemoteViews(context.packageName, R.layout.widget_tasks).apply {
            setTextViewText(R.id.tasks_progress, "${TaskList.doneCount(tasks)}/${tasks.size}")
            setViewVisibility(R.id.tasks_empty, if (tasks.isEmpty()) View.VISIBLE else View.GONE)
            taskRows.forEachIndexed { i, (ids, dotId) ->
                val (rowId, checkId, titleId) = ids
                val task = tasks.getOrNull(i)
                if (task == null) {
                    setViewVisibility(rowId, View.GONE)
                    return@forEachIndexed
                }
                setViewVisibility(rowId, View.VISIBLE)
                setImageViewResource(checkId, if (task.done) R.drawable.wcheck_on else R.drawable.wcheck_off)
                setTextViewText(titleId, task.title)
                setTextColor(titleId, context.getColor(if (task.done) R.color.ink2 else R.color.ink))
                setImageViewResource(dotId, when (task.owner) {
                    Owner.ME -> R.drawable.wdot_her
                    Owner.OURS -> R.drawable.wdot_us
                    Owner.PARTNER -> R.drawable.wdot_him
                })
                setContentDescription(rowId, context.getString(if (task.done) R.string.task_done_cd else R.string.task_open_cd, task.title))
                val toggle = Intent(context, TasksWidget::class.java)
                    .setAction(TasksWidget.ACTION_TOGGLE)
                    .putExtra(TasksWidget.EXTRA_ID, task.id)
                setOnClickPendingIntent(
                    rowId,
                    PendingIntent.getBroadcast(context, task.id.hashCode(), toggle, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
                )
            }
            val extra = tasks.size - taskRows.size
            setViewVisibility(R.id.tasks_more, if (extra > 0) View.VISIBLE else View.GONE)
            if (extra > 0) setTextViewText(R.id.tasks_more, context.getString(R.string.widget_tasks_more, extra))
            setOnClickPendingIntent(R.id.tasks_header, open(context, MainActivity.TAB_TODAY))
            setOnClickPendingIntent(R.id.tasks_empty, open(context, MainActivity.TAB_TODAY))
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
            TasksWidget::class.java to ::tasks,
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
