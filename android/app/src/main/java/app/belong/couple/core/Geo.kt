package app.belong.couple.core

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

object Geo {
    private const val EARTH_RADIUS_KM = 6371.0088

    /** Great-circle distance between two cities in kilometres. */
    fun distanceKm(a: City, b: City): Double {
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLon = Math.toRadians(b.lon - a.lon)
        val h = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * EARTH_RADIUS_KM * asin(sqrt(h))
    }

    /** Rounds to the nearest 10 km, which reads better on a story card than "7 527". */
    fun roundedKm(km: Double): Int = (km / 10.0).roundToInt() * 10
}
