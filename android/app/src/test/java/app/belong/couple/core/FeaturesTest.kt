package app.belong.couple.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskListTest {
    private fun task(id: Long, owner: Owner, done: Boolean, day: Long) = Task(id, "t$id", owner, done, day)

    @Test
    fun unfinishedTasksRollOverAndFinishedOnesDropOff() {
        val today = 100L
        val all = listOf(
            task(1, Owner.ME, done = false, day = 99),
            task(2, Owner.ME, done = true, day = 99),
            task(3, Owner.PARTNER, done = false, day = 100),
            task(4, Owner.OURS, done = true, day = 100),
            task(5, Owner.ME, done = false, day = 101),
        )
        val plan = TaskList.forDay(all, today)
        assertEquals(listOf(1L, 3L, 4L), plan.map { it.id })
        assertTrue(plan.all { it.day == today })
        assertEquals(1, TaskList.doneCount(plan))
        assertEquals(listOf(1L, 3L, 4L, 5L), TaskList.prune(all, today).map { it.id })
    }

    @Test
    fun openTasksComeFirstThenMineOursPartners() {
        val plan = TaskList.forDay(
            listOf(task(1, Owner.PARTNER, false, 5), task(2, Owner.ME, true, 5), task(3, Owner.OURS, false, 5), task(4, Owner.ME, false, 5)),
            5,
        )
        assertEquals(listOf(4L, 3L, 1L, 2L), plan.map { it.id })
    }

    @Test
    fun ownerKeysRoundTrip() {
        for (o in Owner.entries) assertEquals(o, Owner.of(o.key))
        assertEquals(Owner.ME, Owner.of("someone"))
        assertEquals(Owner.ME, Owner.of(null))
    }
}

class LinksTest {
    @Test
    fun acceptsWebLinksAndAddsTheScheme() {
        assertEquals("https://rozetka.com.ua/item/1", Links.safeUrl("https://rozetka.com.ua/item/1"))
        assertEquals("https://example.com/a?b=1", Links.safeUrl("  example.com/a?b=1 "))
        assertEquals("http://shop.ua", Links.safeUrl("http://shop.ua"))
    }

    @Test
    fun rejectsEverythingElse() {
        assertNull(Links.safeUrl(""))
        assertNull(Links.safeUrl("javascript:alert(1)"))
        assertNull(Links.safeUrl("intent://scan#Intent;end"))
        assertNull(Links.safeUrl("file:///sdcard/a.png"))
        assertNull(Links.safeUrl("not a link"))
        assertNull(Links.safeUrl("localhost"))
    }
}

class PlacesTest {
    @Test
    fun mercatorRoundTrips() {
        assertEquals(0.5, Mercator.x(0.0), 1e-12)
        assertEquals(0.5, Mercator.y(0.0), 1e-12)
        for (lat in listOf(-60.0, -10.5, 0.0, 33.3, 50.45, 80.0)) assertEquals(lat, Mercator.lat(Mercator.y(lat)), 1e-9)
        for (lon in listOf(-179.0, -79.38, 0.0, 30.52, 179.0)) assertEquals(lon, Mercator.lon(Mercator.x(lon)), 1e-9)
        assertTrue(Mercator.y(50.0) < Mercator.y(10.0))
        assertEquals(Mercator.y(85.0), Mercator.y(89.9), 1e-12)
    }

    private fun photo(id: Long, lat: Double, lon: Double, at: Long) = GeoPhoto(id, "content://$id", lat, lon, at)

    @Test
    fun overlappingMarkersMergeAndKeepTheNewestPhotoFirst() {
        val photos = listOf(photo(1, 0.0, 0.0, 10), photo(2, 0.0, 0.0, 30), photo(3, 0.0, 0.0, 20), photo(4, 0.0, 0.0, 5))
        val positions = listOf(100f to 100f, 110f to 105f, 300f to 300f, 104f to 98f)
        val clusters = PhotoClusters.cluster(photos, positions, radius = 20f)
        assertEquals(2, clusters.size)
        val big = clusters.first { it.photos.size == 3 }
        assertEquals(listOf(2L, 1L, 4L), big.photos.map { it.id })
        assertEquals(110f, big.x, 0f)
        assertEquals(1, clusters.first { it.photos.size == 1 }.photos.size)
    }

    @Test
    fun groupsPhotosIntoPlacesBiggestFirst() {
        val kyiv = (1..3).map { photo(it.toLong(), 50.45 + it * 0.01, 30.52, it.toLong()) }
        val lviv = listOf(photo(10, 49.84, 24.03, 100))
        val places = PhotoClusters.places(kyiv + lviv)
        assertEquals(2, places.size)
        assertEquals(3, places[0].photos.size)
        assertEquals("kyiv", Geo.nearestCity(places[0].lat, places[0].lon)?.id)
        assertEquals("lviv", Geo.nearestCity(places[1].lat, places[1].lon)?.id)
        assertNull(Geo.nearestCity(0.0, -150.0))
    }

    @Test
    fun ignoresMissingLocations() {
        assertFalse(PhotoClusters.isValid(0.0, 0.0))
        assertFalse(PhotoClusters.isValid(Double.NaN, 10.0))
        assertFalse(PhotoClusters.isValid(95.0, 10.0))
        assertTrue(PhotoClusters.isValid(50.45, 30.52))
    }
}
