package app.belong.couple.data

import android.content.Context
import app.belong.couple.R
import app.belong.couple.core.Role
import app.belong.couple.sync.AuthApi
import app.belong.couple.sync.CloudConfig
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Reason
import app.belong.couple.sync.Seat
import app.belong.couple.sync.Session

/**
 * The pair this phone is signed in to, kept in its own preferences file (excluded from backups).
 * No password is stored: only the refresh token that keeps the session alive.
 */
class Account private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    val config = CloudConfig(
        apiKey = context.getString(R.string.cloud_api_key).trim(),
        databaseUrl = context.getString(R.string.cloud_database_url).trim(),
    )

    /** True when this build has a server to sync with. */
    val available: Boolean get() = config.ready

    val seat: Seat?
        @Synchronized get() {
            val code = prefs.getString("code", null) ?: return null
            val role = Role.of(prefs.getString("role", null)) ?: return null
            return Seat(
                code = code,
                role = role,
                gen = prefs.getInt("gen", 1),
                session = Session(
                    uid = prefs.getString("uid", "")!!,
                    idToken = prefs.getString("id_token", "")!!,
                    refreshToken = prefs.getString("refresh_token", "")!!,
                    expiresAt = prefs.getLong("expires_at", 0L),
                ),
                myName = prefs.getString("my_name", "")!!,
                partnerName = prefs.getString("partner_name", null),
            )
        }

    val paired: Boolean get() = available && prefs.contains("code")

    /** The person chose to look around with the example couple instead of pairing. */
    var demoChosen: Boolean
        get() = prefs.getBoolean("demo", false)
        set(value) = prefs.edit().putBoolean("demo", value).apply()

    /** Set when the server stopped accepting this phone, e.g. after the seat was recovered on another phone. */
    var lostAccess: Boolean
        get() = prefs.getBoolean("lost_access", false)
        set(value) = prefs.edit().putBoolean("lost_access", value).apply()

    /** True when the app should show the pairing screen instead of the tabs. */
    val needsPairing: Boolean get() = available && !paired && !demoChosen

    @Synchronized
    fun signIn(seat: Seat) {
        prefs.edit()
            .putString("code", seat.code)
            .putString("role", seat.role.key)
            .putInt("gen", seat.gen)
            .putString("my_name", seat.myName)
            .putString("partner_name", seat.partnerName)
            .putBoolean("demo", false)
            .putBoolean("lost_access", false)
            .apply()
        saveSession(seat.session)
    }

    @Synchronized
    fun setPartnerName(name: String) = prefs.edit().putString("partner_name", name).apply()

    @Synchronized
    fun setMyName(name: String) = prefs.edit().putString("my_name", name).apply()

    /** A valid ID token, refreshed when it's about to expire. */
    @Synchronized
    fun token(): String {
        val seat = seat ?: throw CloudException(Reason.SIGNED_OUT)
        val session = seat.session
        if (session.expiresAt - 5 * 60_000 > System.currentTimeMillis() && session.idToken.isNotEmpty()) return session.idToken
        val fresh = AuthApi(config).refresh(session.refreshToken)
        saveSession(fresh)
        return fresh.idToken
    }

    /** Drops the token so the next [token] call refreshes it (the server said it expired). */
    @Synchronized
    fun expireToken() = prefs.edit().putLong("expires_at", 0L).apply()

    @Synchronized
    fun signOut(lost: Boolean = false) {
        prefs.edit().clear().putBoolean("lost_access", lost).apply()
        DataEvents.changed()
    }

    private fun saveSession(session: Session) {
        prefs.edit()
            .putString("uid", session.uid)
            .putString("id_token", session.idToken)
            .putString("refresh_token", session.refreshToken)
            .putLong("expires_at", session.expiresAt)
            .apply()
    }

    companion object {
        const val PREFS = "belong_account"

        @Volatile private var instance: Account? = null

        fun get(context: Context): Account =
            instance ?: synchronized(this) {
                instance ?: Account(context.applicationContext).also { instance = it }
            }
    }
}
