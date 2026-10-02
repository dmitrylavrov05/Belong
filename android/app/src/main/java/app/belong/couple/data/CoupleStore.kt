package app.belong.couple.data

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import app.belong.couple.R
import app.belong.couple.core.Cities
import app.belong.couple.core.City
import app.belong.couple.core.Geo
import app.belong.couple.core.MonthStats
import app.belong.couple.core.Recap
import app.belong.couple.core.TimeMath
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth

enum class Counter(val key: String) {
    TAPS_SENT("taps_sent"),
    TAPS_RECEIVED("taps_received"),
    DOODLES("doodles"),
    SAFE("safe"),
}

/**
 * Everything the app knows about the couple, kept in SharedPreferences on this phone.
 * Until a sync server exists the partner side is simulated (see DemoPartner).
 */
class CoupleStore private constructor(private val context: Context) {

    val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var myName: String
        get() = prefs.getString("my_name", null) ?: context.getString(R.string.default_my_name)
        set(value) = prefs.edit().putString("my_name", value.trim()).apply()

    var partnerName: String
        get() = prefs.getString("partner_name", null) ?: context.getString(R.string.default_partner_name)
        set(value) = prefs.edit().putString("partner_name", value.trim()).apply()

    /** What you call your partner, e.g. "Сонечко ☀️". Empty means use their name. */
    var partnerNickname: String
        get() = prefs.getString("partner_nickname", "")!!
        set(value) = prefs.edit().putString("partner_nickname", value.trim().take(24)).apply()

    /** The name the app shows for the partner: the pet name when there is one. */
    val partnerDisplay: String get() = partnerNickname.ifBlank { partnerName }

    var myCityId: String
        get() = prefs.getString("my_city", "kyiv")!!
        set(value) = prefs.edit().putString("my_city", value).apply()

    var partnerCityId: String
        get() = prefs.getString("partner_city", "toronto")!!
        set(value) = prefs.edit().putString("partner_city", value).apply()

    val myCity: City get() = Cities.byId(myCityId)
    val partnerCity: City get() = Cities.byId(partnerCityId)

    var meetingDate: LocalDate
        get() = LocalDate.ofEpochDay(prefs.getLong("meeting", LocalDate.now().plusDays(12).toEpochDay()))
        set(value) = prefs.edit().putLong("meeting", value.toEpochDay()).apply()

    val myMood: Int get() = prefs.getInt("my_mood", 4)
    val myEnergy: Int get() = prefs.getInt("my_energy", 4)
    val partnerMood: Int get() = prefs.getInt("partner_mood", 2)
    val partnerEnergy: Int get() = prefs.getInt("partner_energy", 2)
    val partnerMoodAt: Long get() = prefs.getLong("partner_mood_at", System.currentTimeMillis())

    /** False for a real pair until the partner's first check-in arrives. */
    val hasPartnerCheckIn: Boolean get() = prefs.contains("partner_mood")

    /** True while the numbers on screen are the example data for Yulia and Igor. */
    val isExample: Boolean get() = prefs.getBoolean("example", true)

    fun setMyCheckIn(mood: Int, energy: Int, today: LocalDate = LocalDate.now()) {
        prefs.edit()
            .putInt("my_mood", mood.coerceIn(1, 5))
            .putInt("my_energy", energy.coerceIn(1, 5))
            .putInt("mood_$today", mood.coerceIn(1, 5))
            .apply()
    }

    fun setPartnerCheckIn(mood: Int, energy: Int, at: Long = System.currentTimeMillis()) {
        prefs.edit()
            .putInt("partner_mood", mood.coerceIn(1, 5))
            .putInt("partner_energy", energy.coerceIn(1, 5))
            .putLong("partner_mood_at", at)
            .apply()
    }

    fun count(counter: Counter, month: YearMonth): Int = prefs.getInt("${counter.key}_$month", 0)

    fun setCount(counter: Counter, month: YearMonth, value: Int) {
        if (count(counter, month) != value) prefs.edit().putInt("${counter.key}_$month", value).apply()
    }

    fun increment(counter: Counter, month: YearMonth = YearMonth.now(), by: Int = 1) {
        prefs.edit().putInt("${counter.key}_$month", count(counter, month) + by).apply()
    }

    fun moodsIn(month: YearMonth): List<Int> =
        prefs.all.filterKeys { it.startsWith("mood_$month-") }.values.mapNotNull { it as? Int }

    // ---------- Doodles ----------

    private val doodleDir: File get() = File(context.filesDir, "doodles").apply { mkdirs() }
    private val partnerDoodleFile: File get() = File(doodleDir, "partner_latest.png")
    private val myDoodleFile: File get() = File(doodleDir, "mine_latest.png")

    val partnerDoodleAt: Long get() = prefs.getLong("partner_doodle_at", 0L)
    val hasPartnerDoodle: Boolean get() = partnerDoodleFile.exists()

    fun savePartnerDoodle(bitmap: Bitmap, at: Long = System.currentTimeMillis()) {
        writePng(bitmap, partnerDoodleFile)
        prefs.edit().putLong("partner_doodle_at", at).apply()
    }

    fun saveMyDoodle(bitmap: Bitmap) {
        writePng(bitmap, myDoodleFile)
        prefs.edit().putLong("my_doodle_at", System.currentTimeMillis()).apply()
    }

    /** Loads the partner's latest doodle no larger than [maxSize] px on its longer side. */
    fun loadPartnerDoodle(maxSize: Int): Bitmap? {
        val file = partnerDoodleFile
        if (!file.exists()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSize) sample *= 2
        return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun writePng(bitmap: Bitmap, file: File) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        FileOutputStream(tmp).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        tmp.renameTo(file)
    }

    // ---------- Monthly recap ----------

    fun stats(today: LocalDate = LocalDate.now(), now: Instant = Instant.now()): MonthStats {
        val month = TimeMath.recapMonth(today)
        val days = TimeMath.daysUntil(today, meetingDate)
        return MonthStats(
            month = month,
            inProgress = month == YearMonth.from(today),
            km = Geo.roundedKm(Geo.distanceKm(myCity, partnerCity)),
            hoursApart = TimeMath.hoursAhead(myCity.zone, partnerCity.zone, now),
            tapsSent = count(Counter.TAPS_SENT, month),
            tapsReceived = count(Counter.TAPS_RECEIVED, month),
            doodles = count(Counter.DOODLES, month),
            safeCheckins = count(Counter.SAFE, month),
            daysToMeeting = days.takeIf { it >= 0 },
            averageMood = Recap.average(moodsIn(month)),
        )
    }

    // ---------- Example data ----------

    /** Drops Yulia and Igor's example month for a real pair. */
    fun startReal() {
        val editor = prefs.edit().putBoolean("seeded", true).putBoolean("example", false)
        val example = Counter.entries.map { it.key + "_" } + "mood_" + "partner_mood" + "partner_energy"
        prefs.all.keys.filter { key -> example.any { key.startsWith(it) } }.forEach { editor.remove(it) }
        editor.remove("partner_doodle_at").apply()
        partnerDoodleFile.delete()
    }

    /** Fills in Yulia and Igor's example month on first launch so every screen has something to show. */
    fun ensureSeeded(today: LocalDate = LocalDate.now()) {
        if (prefs.getBoolean("seeded", false)) return
        val recap = TimeMath.recapMonth(today)
        val editor = prefs.edit()
            .putBoolean("seeded", true)
            .putBoolean("example", true)
            .putLong("meeting", today.plusDays(12).toEpochDay())
            .putInt("my_mood", 4).putInt("my_energy", 4)
            .putInt("partner_mood", 2).putInt("partner_energy", 2)
            .putLong("partner_mood_at", System.currentTimeMillis() - 3 * 3600_000L)
            .putInt("${Counter.TAPS_SENT.key}_$recap", 63)
            .putInt("${Counter.TAPS_RECEIVED.key}_$recap", 58)
            .putInt("${Counter.DOODLES.key}_$recap", 17)
            .putInt("${Counter.SAFE.key}_$recap", 9)
        val pattern = intArrayOf(4, 3, 4, 5, 4, 2, 3, 4, 5, 4)
        for (day in 1..recap.lengthOfMonth()) {
            val date = recap.atDay(day)
            if (date.isAfter(today)) break
            editor.putInt("mood_$date", pattern[day % pattern.size])
        }
        editor.apply()
        savePartnerDoodle(DoodleArt.draw(context, 0, 600), System.currentTimeMillis() - 2 * 3600_000L)
    }

    companion object {
        const val PREFS = "belong"

        @Volatile private var instance: CoupleStore? = null

        fun get(context: Context): CoupleStore =
            instance ?: synchronized(this) {
                instance ?: CoupleStore(context.applicationContext).also { instance = it }
            }
    }
}
