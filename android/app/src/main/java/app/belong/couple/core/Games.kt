package app.belong.couple.core

import kotlin.random.Random

object DateMatch {
    /** Indexes of the cards both partners said yes to. */
    fun matches(a: List<Boolean>, b: List<Boolean>): List<Int> =
        a.indices.filter { i -> a[i] && b.getOrElse(i) { false } }
}

data class WheelIdea(val budget: Int, val place: String, val short: String, val full: String) {
    companion object {
        /** Parses "budget|place|short|full" items from the wheel_ideas string array. */
        fun parse(line: String): WheelIdea? {
            val parts = line.split('|')
            if (parts.size != 4) return null
            val budget = parts[0].toIntOrNull() ?: return null
            return WheelIdea(budget, parts[1], parts[2], parts[3])
        }
    }
}

object Wheel {
    const val MAX_SECTORS = 8

    /** Ideas for a wheel that fit the filters: anything up to [budget] for [place]. */
    fun sectors(ideas: List<WheelIdea>, budget: Int, place: String, random: Random = Random.Default): List<WheelIdea> =
        ideas.filter { it.place == place && it.budget <= budget }.shuffled(random).take(MAX_SECTORS)

    /** Rotation in degrees that lands sector [index] of [count] under a pointer at the top. */
    fun targetRotation(current: Float, index: Int, count: Int, extraTurns: Int = 5, jitter: Float = 0f): Float {
        val sector = 360f / count
        val base = (kotlin.math.ceil(current / 360f) * 360f) + 360f * extraTurns
        return base + (360f - (index + 0.5f) * sector) + jitter
    }

    /** Which sector sits under the top pointer for a given rotation. */
    fun sectorAt(rotation: Float, count: Int): Int {
        val sector = 360f / count
        val normalized = ((360f - (rotation % 360f)) % 360f + 360f) % 360f
        return (normalized / sector).toInt().coerceIn(0, count - 1)
    }
}
