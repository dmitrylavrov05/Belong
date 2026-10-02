package app.belong.couple.ui

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/**
 * The app's own language, independent of the phone's. Android 13+ keeps the choice itself
 * (and shows it in system settings); older versions keep it here and every activity applies it.
 */
object Language {
    /** Language tags the app is translated into; "" means follow the phone. */
    val choices = listOf("", "en", "uk", "ru")

    /** Each language's name in that language, so people can find their own. */
    fun nameOf(tag: String): String = when (tag) {
        "en" -> "English"
        "uk" -> "Українська"
        "ru" -> "Русский"
        else -> ""
    }

    private const val PREFS = "belong_language"

    fun current(context: Context): String =
        if (Build.VERSION.SDK_INT >= 33) {
            context.getSystemService(LocaleManager::class.java)?.applicationLocales?.get(0)?.language.orEmpty()
        } else {
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("tag", "")!!
        }

    fun set(activity: Activity, tag: String) {
        if (Build.VERSION.SDK_INT >= 33) {
            // The system saves the choice and recreates the app's activities in the new language.
            activity.getSystemService(LocaleManager::class.java)?.applicationLocales =
                if (tag.isEmpty()) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(tag)
        } else {
            activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("tag", tag).commit()
            activity.recreate()
        }
    }

    /** For activities' attachBaseContext on Android 12 and older. */
    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= 33) return base
        val tag = base.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("tag", "")!!
        if (tag.isEmpty()) return base
        val locale = Locale.forLanguageTag(tag)
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration).apply { setLocales(LocaleList(locale)) }
        return base.createConfigurationContext(config)
    }
}
