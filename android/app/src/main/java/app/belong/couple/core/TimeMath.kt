package app.belong.couple.core

import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.abs

enum class PartOfDay { MORNING, DAY, EVENING, NIGHT }

object TimeMath {
    fun daysUntil(today: LocalDate, target: LocalDate): Long = ChronoUnit.DAYS.between(today, target)

    /** How many hours zone [a] is ahead of zone [b] at [at]; half hours are kept. */
    fun hoursAhead(a: String, b: String, at: Instant): Double {
        val offA = ZoneId.of(a).rules.getOffset(at).totalSeconds
        val offB = ZoneId.of(b).rules.getOffset(at).totalSeconds
        return (offA - offB) / 3600.0
    }

    fun formatHours(hours: Double): String {
        val h = abs(hours)
        return if (h % 1.0 == 0.0) h.toInt().toString() else h.toString()
    }

    fun partOfDay(hour: Int): PartOfDay = when (hour) {
        in 5..11 -> PartOfDay.MORNING
        in 12..17 -> PartOfDay.DAY
        in 18..22 -> PartOfDay.EVENING
        else -> PartOfDay.NIGHT
    }

    /** The month a recap is about: the one that just ended during the first week, otherwise this one. */
    fun recapMonth(today: LocalDate): YearMonth {
        val current = YearMonth.from(today)
        return if (today.dayOfMonth <= 7) current.minusMonths(1) else current
    }
}
