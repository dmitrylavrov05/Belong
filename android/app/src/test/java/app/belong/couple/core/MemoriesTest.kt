package app.belong.couple.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

class CalendarModelTest {
    private fun day(y: Int, m: Int, d: Int) = LocalDate.of(y, m, d).toEpochDay()

    @Test
    fun yearlyDatesComeBackAndOneOffsPass() {
        val today = day(2026, 10, 2)
        assertEquals(day(2027, 3, 14), CalendarModel.nextOccurrence(day(2002, 3, 14), yearly = true, today = today))
        assertEquals(today, CalendarModel.nextOccurrence(day(2000, 10, 2), yearly = true, today = today))
        assertNull(CalendarModel.nextOccurrence(day(2026, 9, 1), yearly = false, today = today))
        assertEquals(day(2026, 12, 31), CalendarModel.nextOccurrence(day(2026, 12, 31), yearly = false, today = today))
        // 29 February falls on the 28th in other years.
        assertEquals(day(2027, 2, 28), CalendarModel.nextOccurrence(day(2004, 2, 29), yearly = true, today = today))
    }

    @Test
    fun upcomingSortsDatesAnniversaryAndMeetingOnlyWhenApart() {
        val today = day(2026, 10, 2)
        val root = JSONObject("""{
            "dates": {
                "b": {"title": "Birthday", "emoji": "🎂", "day": ${day(2002, 10, 10)}, "yearly": true},
                "t": {"title": "Trip", "emoji": "✈️", "day": ${day(2026, 10, 5)}, "yearly": false},
                "old": {"title": "Gone", "day": ${day(2026, 1, 5)}, "yearly": false}
            },
            "couple": {"since": ${day(2023, 10, 20)}, "apart": false, "meeting": ${day(2026, 10, 3)}}
        }""")
        val list = CalendarModel.upcoming(root, today, "Anniversary", "Meeting")
        assertEquals(listOf("Trip", "Birthday", "Anniversary"), list.map { it.title })
        assertEquals(24, list[1].years)
        assertEquals(3, list[2].years)
        assertEquals(8L, list[1].daysLeft)
        root.getJSONObject("couple").put("apart", true)
        assertEquals("Meeting", CalendarModel.upcoming(root, today, "Anniversary", "Meeting").first().title)
    }

    @Test
    fun apartIsUnknownUntilSet() {
        assertNull(CalendarModel.apart(JSONObject()))
        assertEquals(false, CalendarModel.apart(JSONObject("""{"couple": {"apart": false}}""")))
    }

    @Test
    fun monthMarksYearlyDatesInLaterYearsOnly() {
        val root = JSONObject("""{"dates": {
            "b": {"title": "B", "day": ${day(2002, 3, 14)}, "yearly": true},
            "o": {"title": "O", "day": ${day(2026, 3, 1)}, "yearly": false}
        }}""")
        assertEquals(setOf(14, 1), CalendarModel.inMonth(root, YearMonth.of(2026, 3)).keys)
        assertEquals(setOf(14), CalendarModel.inMonth(root, YearMonth.of(2027, 3)).keys)
        assertTrue(CalendarModel.inMonth(root, YearMonth.of(2001, 3)).isEmpty())
    }
}

class PhotosAndReportTest {
    private val sep = YearMonth.of(2026, 9)
    private fun day(d: Int) = sep.atDay(d).toEpochDay()

    private val root = JSONObject("""{
        "photos": {
            "${day(3)}": {"p1": {"by": "a", "at": 1, "caption": "Coffee"}, "p2": {"by": "b", "at": 2}},
            "${day(20)}": {"p3": {"by": "b", "at": 3}},
            "${LocalDate.of(2026, 10, 1).toEpochDay()}": {"p4": {"by": "a", "at": 4}}
        },
        "flags": {"question": {"${day(3)}": {"a": true, "b": true}, "${day(4)}": {"a": true}}},
        "thanks": {"${day(5)}": {"a": {"text": "x"}, "b": {"text": "y"}}},
        "moments": {"m": {"title": "Picnic", "day": ${day(7)}}},
        "feelings": {
            "f1": {"by": "b", "at": ${sep.atDay(10).toEpochDay() * 86_400_000L}, "wrote": {"b": true}},
            "f2": {"by": "a", "at": ${sep.atDay(12).toEpochDay() * 86_400_000L}, "wrote": {"a": true, "b": true}}
        }
    }""")

    @Test
    fun photosAreNewestFirstWithOwners() {
        val photos = PhotosModel.photos(root, Role.A)
        assertEquals(listOf("p4", "p3", "p2", "p1"), photos.map { it.key })
        assertEquals(Owner.ME, photos.first { it.key == "p1" }.by)
        assertEquals(Owner.PARTNER, photos.first { it.key == "p2" }.by)
        assertEquals(3, PhotosModel.inMonth(photos, sep).size)
        assertEquals(4, PhotosModel.inYear(photos, 2026).size)
    }

    @Test
    fun monthHighlightsCountWhatHappened() {
        val h = ReportModel.month(root, Role.A, sep)
        assertEquals(3, h.photos)
        assertEquals(2, h.photoDays)
        assertEquals(1, h.questions) // only days both answered
        assertEquals(2, h.thanks)
        assertEquals(listOf("Picnic"), h.moments)
        assertEquals(2, h.talks)
    }

    @Test
    fun collageSpreadsOverDays() {
        val photos = (1..20).map { DayPhoto("k$it", day(it), Owner.ME, it.toLong(), "") }
        val picked = ReportModel.collage(photos, 4)
        assertEquals(4, picked.size)
        assertEquals(4, picked.map { it.day }.distinct().size)
        assertEquals(listOf("k1", "k2"), ReportModel.collage(photos.take(2), 9).map { it.key })
    }

    @Test
    fun feelingsWaitForMyNoteWhenPartnerWrote() {
        val notes = FeelingsModel.notes(root, Role.A)
        assertEquals(listOf("f2", "f1"), notes.map { it.key })
        assertEquals("f1", FeelingsModel.waitingForMe(root, Role.A)?.key)
        assertNull(FeelingsModel.waitingForMe(root, Role.B))
    }
}
