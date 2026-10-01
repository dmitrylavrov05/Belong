package app.belong.couple.core

import java.time.YearMonth

data class MonthStats(
    val month: YearMonth,
    val inProgress: Boolean,
    val km: Int,
    val hoursApart: Double,
    val tapsSent: Int,
    val tapsReceived: Int,
    val doodles: Int,
    val safeCheckins: Int,
    val daysToMeeting: Long?,
    val averageMood: Double?,
)

object Recap {
    private val moodEmoji = listOf("😔", "😕", "🙂", "😊", "🤩")

    fun emojiFor(mood: Int): String = moodEmoji[(mood - 1).coerceIn(0, 4)]

    fun emojiForAverage(avg: Double?): String = if (avg == null) "—" else emojiFor(Math.round(avg).toInt())

    fun average(values: Collection<Int>): Double? = if (values.isEmpty()) null else values.average()
}
