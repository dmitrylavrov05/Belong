package app.belong.couple.core

import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sinh
import kotlin.math.tan

/** A photo from the gallery with the place it was taken. */
data class GeoPhoto(val id: Long, val uri: String, val lat: Double, val lon: Double, val takenAt: Long)

/** Web Mercator in unit coordinates: x and y both run 0..1, north is y = 0. */
object Mercator {
    const val MAX_LAT = 85.0

    fun x(lon: Double): Double = (lon + 180.0) / 360.0

    fun y(lat: Double): Double {
        val r = Math.toRadians(lat.coerceIn(-MAX_LAT, MAX_LAT))
        return (1.0 - ln(tan(r) + 1.0 / cos(r)) / PI) / 2.0
    }

    fun lon(x: Double): Double = x * 360.0 - 180.0

    fun lat(y: Double): Double = Math.toDegrees(atan(sinh(PI * (1.0 - 2.0 * y))))
}

/** Photos drawn as one marker at screen position ([x], [y]); newest photo first. */
data class MapCluster(val x: Float, val y: Float, val photos: List<GeoPhoto>)

/** A place on the list under the map: photos within a few kilometres of each other. */
data class Place(val lat: Double, val lon: Double, val photos: List<GeoPhoto>)

object PhotoClusters {
    /**
     * Groups markers that would overlap on screen. [positions] are screen coordinates for each photo,
     * [radius] is how close (in pixels) two markers may be before they merge.
     */
    fun cluster(photos: List<GeoPhoto>, positions: List<Pair<Float, Float>>, radius: Float): List<MapCluster> {
        require(photos.size == positions.size)
        val order = photos.indices.sortedByDescending { photos[it].takenAt }
        val centers = mutableListOf<FloatArray>() // x, y, count
        val members = mutableListOf<MutableList<GeoPhoto>>()
        val r2 = radius * radius
        for (i in order) {
            val (x, y) = positions[i]
            var found = -1
            for (c in centers.indices) {
                val dx = centers[c][0] - x
                val dy = centers[c][1] - y
                if (dx * dx + dy * dy <= r2) {
                    found = c
                    break
                }
            }
            if (found == -1) {
                centers += floatArrayOf(x, y, 1f)
                members += mutableListOf(photos[i])
            } else {
                val c = centers[found]
                // Keep the marker on the newest photo so it doesn't drift while you zoom.
                c[2] += 1f
                members[found] += photos[i]
            }
        }
        return centers.indices.map { MapCluster(centers[it][0], centers[it][1], members[it]) }
    }

    /** Groups photos taken within [km] of each other into places, biggest first. */
    fun places(photos: List<GeoPhoto>, km: Double = 25.0): List<Place> {
        val groups = mutableListOf<MutableList<GeoPhoto>>()
        for (p in photos.sortedByDescending { it.takenAt }) {
            val group = groups.firstOrNull { g -> Geo.distanceKm(g[0].lat, g[0].lon, p.lat, p.lon) <= km }
            if (group == null) groups += mutableListOf(p) else group += p
        }
        return groups
            .map { g -> Place(g.map { it.lat }.average(), g.map { it.lon }.average(), g) }
            .sortedWith(compareByDescending<Place> { it.photos.size }.thenByDescending { it.photos.first().takenAt })
    }

    /** A usable location: EXIF without GPS often reports 0,0. */
    fun isValid(lat: Double, lon: Double): Boolean =
        !lat.isNaN() && !lon.isNaN() && lat in -90.0..90.0 && lon in -180.0..180.0 && !(lat == 0.0 && lon == 0.0)
}
