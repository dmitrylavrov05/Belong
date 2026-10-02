package app.belong.couple.sync

import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Where the pair's data lives: a Firebase project with Email/Password sign-in and a Realtime Database.
 * Only the REST APIs are used, so the app needs no Firebase SDK.
 */
data class CloudConfig(
    val apiKey: String,
    val databaseUrl: String,
    val authUrl: String = "https://identitytoolkit.googleapis.com/v1",
    val tokenUrl: String = "https://securetoken.googleapis.com/v1",
    /** Database namespace, only needed for the local emulator. */
    val namespace: String? = null,
) {
    val ready: Boolean get() = apiKey.isNotBlank() && databaseUrl.isNotBlank()

    companion object {
        fun emulator(host: String, authPort: Int, databasePort: Int, project: String) = CloudConfig(
            apiKey = "emulator",
            databaseUrl = "http://$host:$databasePort",
            authUrl = "http://$host:$authPort/identitytoolkit.googleapis.com/v1",
            tokenUrl = "http://$host:$authPort/securetoken.googleapis.com/v1",
            namespace = "$project-default-rtdb",
        )
    }
}

enum class Reason {
    NETWORK,
    WRONG_PASSWORD,
    ACCOUNT_EXISTS,
    TOO_MANY_ATTEMPTS,
    WEAK_PASSWORD,
    SIGNED_OUT,
    DENIED,
    NO_SUCH_PAIR,
    CODE_USED,
    BAD_HELP_CODE,
    OTHER,
}

class CloudException(val reason: Reason, message: String = reason.name, cause: Throwable? = null) : Exception(message, cause)

/** A signed-in account. [idToken] lasts an hour; [refreshToken] gets a new one. */
data class Session(val uid: String, val idToken: String, val refreshToken: String, val expiresAt: Long)

internal object Http {
    private const val TIMEOUT = 15_000

    class Response(val code: Int, val body: String)

    fun request(url: String, method: String, body: String? = null, contentType: String = "application/json"): Response {
        val conn = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw CloudException(Reason.NETWORK, "Can't open $method", e)
        }
        try {
            conn.connectTimeout = TIMEOUT
            conn.readTimeout = TIMEOUT
            // HttpURLConnection has no PATCH; the database accepts POST with this override.
            if (method == "PATCH") {
                conn.requestMethod = "POST"
                conn.setRequestProperty("X-HTTP-Method-Override", "PATCH")
            } else {
                conn.requestMethod = method
            }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", contentType)
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return Response(code, text)
        } catch (e: IOException) {
            throw CloudException(Reason.NETWORK, "$method failed", e)
        } finally {
            conn.disconnect()
        }
    }

    fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}

/** Firebase Authentication with email and password, through its REST API. */
class AuthApi(private val config: CloudConfig) {

    fun signUp(email: String, password: String): Session =
        account("accounts:signUp", JSONObject().put("email", email).put("password", password).put("returnSecureToken", true))

    fun signIn(email: String, password: String): Session =
        account("accounts:signInWithPassword", JSONObject().put("email", email).put("password", password).put("returnSecureToken", true))

    fun refresh(refreshToken: String, now: Long = System.currentTimeMillis()): Session {
        val form = "grant_type=refresh_token&refresh_token=" + Http.encode(refreshToken)
        val response = Http.request("${config.tokenUrl}/token?key=${Http.encode(config.apiKey)}", "POST", form, "application/x-www-form-urlencoded")
        val o = parse(response)
        return Session(
            uid = o.getString("user_id"),
            idToken = o.getString("id_token"),
            refreshToken = o.getString("refresh_token"),
            expiresAt = now + o.optString("expires_in", "3600").toLong() * 1000,
        )
    }

    private fun account(endpoint: String, body: JSONObject, now: Long = System.currentTimeMillis()): Session {
        val response = Http.request("${config.authUrl}/$endpoint?key=${Http.encode(config.apiKey)}", "POST", body.toString())
        val o = parse(response)
        return Session(
            uid = o.getString("localId"),
            idToken = o.getString("idToken"),
            refreshToken = o.getString("refreshToken"),
            expiresAt = now + o.optString("expiresIn", "3600").toLong() * 1000,
        )
    }

    private fun parse(response: Http.Response): JSONObject {
        val o = try {
            JSONObject(response.body)
        } catch (e: JSONException) {
            throw CloudException(if (response.code >= 500) Reason.NETWORK else Reason.OTHER, "Bad auth response ${response.code}")
        }
        if (response.code in 200..299) return o
        val message = o.optJSONObject("error")?.optString("message").orEmpty()
        throw CloudException(reasonFor(message, response.code), message)
    }

    companion object {
        /** Maps Firebase Auth error codes such as "EMAIL_EXISTS" or "TOO_MANY_ATTEMPTS_TRY_LATER : …". */
        fun reasonFor(message: String, status: Int): Reason {
            val code = message.substringBefore(' ').substringBefore(':')
            return when (code) {
                "EMAIL_EXISTS" -> Reason.ACCOUNT_EXISTS
                "INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS" -> Reason.WRONG_PASSWORD
                "TOO_MANY_ATTEMPTS_TRY_LATER" -> Reason.TOO_MANY_ATTEMPTS
                "WEAK_PASSWORD" -> Reason.WEAK_PASSWORD
                "TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND", "INVALID_REFRESH_TOKEN" -> Reason.SIGNED_OUT
                else -> if (status >= 500) Reason.NETWORK else Reason.OTHER
            }
        }
    }
}

/** The Realtime Database REST API. Values are org.json values: JSONObject, String, Number, Boolean or null. */
class Db(private val config: CloudConfig) {

    fun url(path: String, token: String?, query: String = ""): String {
        val params = buildList {
            config.namespace?.let { add("ns=${Http.encode(it)}") }
            token?.let { add("auth=${Http.encode(it)}") }
            if (query.isNotEmpty()) add(query)
        }
        return "${config.databaseUrl.trimEnd('/')}/${path.trim('/')}.json" + if (params.isEmpty()) "" else "?" + params.joinToString("&")
    }

    fun get(path: String, token: String? = null): Any? = value(Http.request(url(path, token), "GET"))

    fun put(path: String, value: Any, token: String): Any? = value(Http.request(url(path, token), "PUT", json(value)))

    fun delete(path: String, token: String) {
        value(Http.request(url(path, token), "DELETE"))
    }

    /** Writes several paths under [path] at once; the database checks the rules against the combined result. */
    fun update(path: String, values: JSONObject, token: String): Any? = value(Http.request(url(path, token), "PATCH", values.toString()))

    private fun json(value: Any): String = if (value is String) JSONObject.quote(value) else value.toString()

    private fun value(response: Http.Response): Any? {
        when {
            response.code == 401 || response.code == 403 -> throw CloudException(Reason.DENIED, response.body)
            response.code >= 500 -> throw CloudException(Reason.NETWORK, "Database ${response.code}")
            response.code !in 200..299 -> throw CloudException(Reason.OTHER, "Database ${response.code}: ${response.body}")
        }
        return try {
            JSONTokener(response.body).nextValue().takeUnless { it == JSONObject.NULL }
        } catch (e: JSONException) {
            throw CloudException(Reason.OTHER, "Bad database response")
        }
    }

    /** An open server-sent event stream; [close] ends it from another thread. */
    class Stream {
        @Volatile internal var connection: HttpURLConnection? = null
        @Volatile var closed = false
            private set

        fun close() {
            closed = true
            connection?.disconnect()
        }
    }

    /**
     * Listens to [path] and calls [onEvent] with each event name ("put", "patch", "keep-alive",
     * "cancel", "auth_revoked") and its data. Blocks until the stream ends or [stream] is closed.
     */
    fun listen(path: String, token: String, query: String, stream: Stream, onEvent: (event: String, data: String) -> Unit) {
        val conn = try {
            URL(url(path, token, query)).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw CloudException(Reason.NETWORK, "Can't listen", e)
        }
        stream.connection = conn
        try {
            if (stream.closed) return
            conn.connectTimeout = 15_000
            conn.readTimeout = 90_000 // the server sends keep-alive every 30 seconds
            conn.setRequestProperty("Accept", "text/event-stream")
            val code = conn.responseCode
            if (code == 401 || code == 403) throw CloudException(Reason.DENIED, "Listen denied")
            if (code !in 200..299) throw CloudException(Reason.NETWORK, "Listen $code")
            BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { reader ->
                var event = ""
                val data = StringBuilder()
                while (true) {
                    val line = reader.readLine() ?: break
                    when {
                        line.startsWith("event:") -> event = line.substring(6).trim()
                        line.startsWith("data:") -> data.append(line.substring(5).trim())
                        line.isEmpty() && event.isNotEmpty() -> {
                            onEvent(event, data.toString())
                            event = ""
                            data.setLength(0)
                        }
                    }
                }
            }
        } catch (e: IOException) {
            if (!stream.closed) throw CloudException(Reason.NETWORK, "Stream broke", e)
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        /** Placeholder the server replaces with its own clock. */
        fun serverTime(): JSONObject = JSONObject().put(".sv", "timestamp")
    }
}
