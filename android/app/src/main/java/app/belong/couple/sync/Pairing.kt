package app.belong.couple.sync

import app.belong.couple.core.PairCode
import app.belong.couple.core.Role
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Random

/** A seat in a pair this phone is signed in to. */
data class Seat(
    val code: String,
    val role: Role,
    val gen: Int,
    val session: Session,
    val myName: String,
    val partnerName: String?,
)

/** What anyone with the code may see: the names and the current account generation of each seat. */
data class PublicPair(val names: Map<Role, String>, val gens: Map<Role, Int>)

/**
 * Creating, joining and signing in to a pair with a code and a password. Each partner has their own password.
 * A forgotten password is replaced with a one-time help code made by the partner (see [makeHelpCode]):
 * the seat moves to a new account and the old one loses access. The database rules enforce all of this.
 */
class Pairing(config: CloudConfig, private val random: Random = SecureRandom()) {
    private val auth = AuthApi(config)
    private val db = Db(config)

    fun create(name: String, password: String): Seat {
        repeat(5) {
            val code = PairCode.generate(random)
            val session = try {
                auth.signUp(PairCode.email(code, Role.A, 1), password)
            } catch (e: CloudException) {
                if (e.reason == Reason.ACCOUNT_EXISTS) return@repeat
                throw e
            }
            try {
                claim(code, Role.A, 1, name, session)
            } catch (e: CloudException) {
                if (e.reason == Reason.DENIED) return@repeat // the code is taken
                throw e
            }
            return Seat(code, Role.A, 1, session, name, null)
        }
        throw CloudException(Reason.OTHER, "No free pair code")
    }

    /** Null when there is no pair with this code. */
    fun publicInfo(code: String): PublicPair? {
        val logins = db.get("pairs/$code/logins") as? JSONObject ?: return null
        val names = HashMap<Role, String>()
        val gens = HashMap<Role, Int>()
        for (role in Role.entries) {
            val seat = logins.optJSONObject(role.key) ?: continue
            names[role] = seat.optString("name")
            gens[role] = seat.optString("gen").toIntOrNull() ?: continue
        }
        return if (gens.isEmpty()) null else PublicPair(names, gens)
    }

    fun join(code: String, name: String, password: String): Seat {
        val info = publicInfo(code) ?: throw CloudException(Reason.NO_SUCH_PAIR)
        if (Role.B in info.gens) throw CloudException(Reason.CODE_USED)
        val session = signUpOrRetry(PairCode.email(code, Role.B, 1), password) ?: throw CloudException(Reason.CODE_USED)
        try {
            claim(code, Role.B, 1, name, session)
        } catch (e: CloudException) {
            throw if (e.reason == Reason.DENIED) CloudException(Reason.CODE_USED) else e
        }
        return Seat(code, Role.B, 1, session, name, info.names[Role.A])
    }

    fun signIn(code: String, role: Role, password: String): Seat {
        val info = publicInfo(code) ?: throw CloudException(Reason.NO_SUCH_PAIR)
        val gen = info.gens[role] ?: throw CloudException(Reason.NO_SUCH_PAIR)
        val session = auth.signIn(PairCode.email(code, role, gen), password)
        return Seat(code, role, gen, session, info.names[role].orEmpty(), info.names[role.other])
    }

    /** Lets the partner in [role] set a new password. Run by the other partner; the code works once, for 30 minutes. */
    fun makeHelpCode(code: String, role: Role, token: String): String {
        val help = PairCode.generate(random)
        db.put("pairs/$code/reset/${role.key}", JSONObject().put("code", help).put("at", Db.serverTime()), token)
        return help
    }

    /** Moves the seat to a new account with [password], proving it with the partner's [helpCode]. */
    fun recover(code: String, role: Role, helpCode: String, password: String): Seat {
        val info = publicInfo(code) ?: throw CloudException(Reason.NO_SUCH_PAIR)
        var gen = info.gens[role] ?: throw CloudException(Reason.NO_SUCH_PAIR)
        val name = info.names[role].orEmpty()
        repeat(5) {
            gen++
            // A leftover account from an interrupted attempt with the same password is reused.
            val session = signUpOrRetry(PairCode.email(code, role, gen), password) ?: return@repeat
            val values = JSONObject()
                .put("members/${role.key}", session.uid)
                .put("logins/${role.key}", JSONObject().put("gen", gen.toString()).put("name", name))
                .put("reset/${role.key}/used", helpCode)
            try {
                db.update("pairs/$code", values, session.idToken)
            } catch (e: CloudException) {
                throw if (e.reason == Reason.DENIED) CloudException(Reason.BAD_HELP_CODE) else e
            }
            return Seat(code, role, gen, session, name, info.names[role.other])
        }
        throw CloudException(Reason.OTHER, "No free account slot")
    }

    /** Changes the name the partner and the sign-in screen see. */
    fun rename(seat: Seat, name: String, token: String) {
        db.put("pairs/${seat.code}/logins/${seat.role.key}/name", name, token)
    }

    private fun claim(code: String, role: Role, gen: Int, name: String, session: Session) {
        val values = JSONObject()
            .put("members/${role.key}", session.uid)
            .put("logins/${role.key}", JSONObject().put("gen", gen.toString()).put("name", name))
        db.update("pairs/$code", values, session.idToken)
    }

    /** Signs up, or signs in if an earlier attempt already made the account with this password. Null if someone else owns it. */
    private fun signUpOrRetry(email: String, password: String): Session? = try {
        auth.signUp(email, password)
    } catch (e: CloudException) {
        if (e.reason != Reason.ACCOUNT_EXISTS) throw e
        try {
            auth.signIn(email, password)
        } catch (e2: CloudException) {
            if (e2.reason == Reason.WRONG_PASSWORD) null else throw e2
        }
    }
}
