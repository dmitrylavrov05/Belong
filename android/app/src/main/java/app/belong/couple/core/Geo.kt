package app.belong.couple.core

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

object Geo {
    private const val EARTH_RADIUS_KM = 6371.0088

    /** Great-circle distance between two cities in kilometres. */
    fun distanceKm(a: City, b: City): Double = distanceKm(a.lat, a.lon, b.lat, b.lon)

    fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val h = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * EARTH_RADIUS_KM * asin(sqrt(h))
    }

    /** The preset city closest to a point, if one is within [maxKm]. */
    fun nearestCity(lat: Double, lon: Double, maxKm: Double = 60.0): City? =
        Cities.all.minByOrNull { distanceKm(lat, lon, it.lat, it.lon) }
            ?.takeIf { distanceKm(lat, lon, it.lat, it.lon) <= maxKm }

    /** Rounds to the nearest 10 km, which reads better on a story card than "7 527". */
    fun roundedKm(km: Double): Int = (km / 10.0).roundToInt() * 10
}
