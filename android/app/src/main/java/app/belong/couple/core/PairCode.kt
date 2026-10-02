package app.belong.couple.core

import java.security.SecureRandom
import java.util.Random

/** The two seats in a pair: "a" created it, "b" joined with the code. */
enum class Role(val key: String) {
    A("a"),
    B("b");

    val other: Role get() = if (this == A) B else A

    companion object {
        fun of(key: String?): Role? = entries.firstOrNull { it.key == key }
    }
}

/**
 * Pair codes and one-time help codes: 8 characters without look-alikes (0/O, 1/I/L),
 * shown as "K7M3-Q9XP" and stored lowercase.
 */
object PairCode {
    private const val ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
    const val LENGTH = 8
    const val MIN_PASSWORD = 8

    /** Accounts are Firebase email/password users; nobody ever receives mail at this domain. */
    const val EMAIL_DOMAIN = "pair.belong.app"

    private val secure = SecureRandom()

    fun generate(random: Random = secure): String =
        buildString { repeat(LENGTH) { append(ALPHABET[random.nextInt(ALPHABET.length)]) } }

    /** "K7M3-Q9XP" for display. */
    fun format(code: String): String = code.uppercase().let { it.take(4) + "-" + it.drop(4) }

    /** Reads what a person typed, ignoring case, spaces and dashes. Returns null if it isn't a code. */
    fun parse(input: String): String? {
        val code = input.lowercase().filter { it.isLetterOrDigit() }
        return code.takeIf { it.length == LENGTH && it.all { c -> c in ALPHABET } }
    }

    /** The account behind one seat. [gen] grows by one each time the seat is recovered with a help code. */
    fun email(code: String, role: Role, gen: Int): String = "$code.${role.key}.$gen@$EMAIL_DOMAIN"

    fun passwordOk(password: String): Boolean = password.length >= MIN_PASSWORD && password.isNotBlank()
}
