package app.belong.couple.core

/** A city the couple can pick; [zone] is an IANA time zone that every Android version knows. */
data class City(
    val id: String,
    val nameEn: String,
    val nameUk: String,
    val lat: Double,
    val lon: Double,
    val zone: String,
) {
    fun name(language: String): String = if (language == "uk") nameUk else nameEn
}

object Cities {
    val all: List<City> = listOf(
        City("kyiv", "Kyiv", "Київ", 50.4501, 30.5234, "Europe/Kiev"),
        City("lviv", "Lviv", "Львів", 49.8397, 24.0297, "Europe/Kiev"),
        City("kharkiv", "Kharkiv", "Харків", 49.9935, 36.2304, "Europe/Kiev"),
        City("odesa", "Odesa", "Одеса", 46.4825, 30.7233, "Europe/Kiev"),
        City("dnipro", "Dnipro", "Дніпро", 48.4647, 35.0462, "Europe/Kiev"),
        City("warsaw", "Warsaw", "Варшава", 52.2297, 21.0122, "Europe/Warsaw"),
        City("krakow", "Kraków", "Краків", 50.0647, 19.9450, "Europe/Warsaw"),
        City("berlin", "Berlin", "Берлін", 52.5200, 13.4050, "Europe/Berlin"),
        City("prague", "Prague", "Прага", 50.0755, 14.4378, "Europe/Prague"),
        City("vienna", "Vienna", "Відень", 48.2082, 16.3738, "Europe/Vienna"),
        City("london", "London", "Лондон", 51.5074, -0.1278, "Europe/London"),
        City("lisbon", "Lisbon", "Лісабон", 38.7223, -9.1393, "Europe/Lisbon"),
        City("dubai", "Dubai", "Дубай", 25.2048, 55.2708, "Asia/Dubai"),
        City("toronto", "Toronto", "Торонто", 43.6532, -79.3832, "America/Toronto"),
        City("newyork", "New York", "Нью-Йорк", 40.7128, -74.0060, "America/New_York"),
        City("vancouver", "Vancouver", "Ванкувер", 49.2827, -123.1207, "America/Vancouver"),
    )

    fun byId(id: String?): City = all.firstOrNull { it.id == id } ?: all.first()
}
