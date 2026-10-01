package app.belong.couple.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import kotlin.random.Random

class GeoTest {
    @Test
    fun kyivToTorontoIsAbout7560Km() {
        val km = Geo.distanceKm(Cities.byId("kyiv"), Cities.byId("toronto"))
        assertEquals(7556.0, km, 5.0)
        assertEquals(7560, Geo.roundedKm(km))
        assertEquals(7530, Geo.roundedKm(7527.4))
    }

    @Test
    fun sameCityIsZero() {
        assertEquals(0.0, Geo.distanceKm(Cities.byId("lviv"), Cities.byId("lviv")), 1e-9)
    }

    @Test
    fun unknownCityFallsBackToKyiv() {
        assertEquals("kyiv", Cities.byId("atlantis").id)
        assertEquals("kyiv", Cities.byId(null).id)
    }

    @Test
    fun everyCityHasAValidZoneAndBothNames() {
        for (city in Cities.all) {
            ZoneId.of(city.zone)
            assertTrue(city.nameEn.isNotBlank() && city.nameUk.isNotBlank())
        }
        assertEquals(Cities.all.size, Cities.all.map { it.id }.toSet().size)
    }
}

class TimeMathTest {
    @Test
    fun kyivIsSevenHoursAheadOfTorontoInOctober() {
        val at = Instant.parse("2026-10-01T12:00:00Z")
        assertEquals(7.0, TimeMath.hoursAhead("Europe/Kiev", "America/Toronto", at), 0.0)
        assertEquals(-7.0, TimeMath.hoursAhead("America/Toronto", "Europe/Kiev", at), 0.0)
    }

    @Test
    fun dstGapMakesItSixHoursInMarch() {
        // Canada switches to summer time two weeks before Europe.
        val at = Instant.parse("2026-03-20T12:00:00Z")
        assertEquals(6.0, TimeMath.hoursAhead("Europe/Kiev", "America/Toronto", at), 0.0)
    }

    @Test
    fun formatsWholeAndHalfHours() {
        assertEquals("7", TimeMath.formatHours(-7.0))
        assertEquals("5.5", TimeMath.formatHours(5.5))
    }

    @Test
    fun countsDaysUntilMeeting() {
        val today = LocalDate.of(2026, 10, 1)
        assertEquals(12, TimeMath.daysUntil(today, LocalDate.of(2026, 10, 13)))
        assertEquals(0, TimeMath.daysUntil(today, today))
        assertEquals(-1, TimeMath.daysUntil(today, LocalDate.of(2026, 9, 30)))
    }

    @Test
    fun recapIsLastMonthDuringTheFirstWeek() {
        assertEquals(YearMonth.of(2026, 9), TimeMath.recapMonth(LocalDate.of(2026, 10, 1)))
        assertEquals(YearMonth.of(2026, 9), TimeMath.recapMonth(LocalDate.of(2026, 10, 7)))
        assertEquals(YearMonth.of(2026, 10), TimeMath.recapMonth(LocalDate.of(2026, 10, 8)))
        assertEquals(YearMonth.of(2025, 12), TimeMath.recapMonth(LocalDate.of(2026, 1, 3)))
    }

    @Test
    fun partsOfDay() {
        assertEquals(PartOfDay.MORNING, TimeMath.partOfDay(8))
        assertEquals(PartOfDay.DAY, TimeMath.partOfDay(13))
        assertEquals(PartOfDay.EVENING, TimeMath.partOfDay(21))
        assertEquals(PartOfDay.NIGHT, TimeMath.partOfDay(2))
    }
}

class GamesTest {
    @Test
    fun matchesAreOnlyMutualYeses() {
        val a = "1101100101".map { it == '1' }
        val b = "1001110100".map { it == '1' }
        assertEquals(listOf(0, 3, 4, 7), DateMatch.matches(a, b))
        assertEquals(emptyList<Int>(), DateMatch.matches(a, List(10) { false }))
        assertEquals(listOf(0), DateMatch.matches(listOf(true, true), listOf(true)))
    }

    @Test
    fun parsesWheelIdeas() {
        assertEquals(WheelIdea(1, "out", "Karaoke", "Karaoke for two"), WheelIdea.parse("1|out|Karaoke|Karaoke for two"))
        assertNull(WheelIdea.parse("x|out|Karaoke|Karaoke for two"))
        assertNull(WheelIdea.parse("1|out|Karaoke"))
    }

    @Test
    fun wheelUsesOnlyIdeasWithinTheFilters() {
        val ideas = (0 until 12).map { WheelIdea(it % 3, if (it % 2 == 0) "home" else "out", "s$it", "f$it") }
        val sectors = Wheel.sectors(ideas, budget = 1, place = "home", random = Random(7))
        assertTrue(sectors.isNotEmpty())
        assertTrue(sectors.all { it.place == "home" && it.budget <= 1 })
        assertTrue(Wheel.sectors(List(20) { WheelIdea(0, "home", "s", "f") }, 2, "home").size <= Wheel.MAX_SECTORS)
    }

    @Test
    fun wheelLandsOnTheChosenSector() {
        for (count in 3..8) {
            for (index in 0 until count) {
                var rotation = 123f
                rotation = Wheel.targetRotation(rotation, index, count)
                assertEquals("count=$count index=$index", index, Wheel.sectorAt(rotation, count))
                assertTrue(rotation > 123f + 360f * 4)
            }
        }
    }
}

class RecapTest {
    @Test
    fun moodEmojiIsClamped() {
        assertEquals("😔", Recap.emojiFor(0))
        assertEquals("🤩", Recap.emojiFor(9))
        assertEquals("😊", Recap.emojiForAverage(3.6))
        assertEquals("—", Recap.emojiForAverage(null))
        assertNull(Recap.average(emptyList()))
        assertEquals(3.5, Recap.average(listOf(3, 4))!!, 1e-9)
    }
}
