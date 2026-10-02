package app.belong.couple.sync

import app.belong.couple.core.Picture
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Unsplash photo search (https://unsplash.com/documentation). */
class Unsplash(private val accessKey: String) {

    val ready: Boolean get() = accessKey.isNotBlank()

    /** Up to [count] photos for [query]; throws [CloudException] when offline or over the hourly limit. */
    fun search(query: String, count: Int = 9): List<Picture> {
        val url = "$API/search/photos?per_page=$count&content_filter=high&query=" + URLEncoder.encode(query.trim(), "UTF-8")
        return parse(get(url))
    }

    /** Tells Unsplash a photo was chosen, as its guidelines require. Failures don't matter to the user. */
    fun trackDownload(picture: Picture) {
        if (picture.downloadLocation.startsWith("$API/")) {
            try { get(picture.downloadLocation) } catch (e: CloudException) { /* best effort */ }
        }
    }

    private fun get(url: String): String {
        val conn = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw CloudException(Reason.NETWORK, "Unsplash", e)
        }
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.setRequestProperty("Authorization", "Client-ID $accessKey")
            conn.setRequestProperty("Accept-Version", "v1")
            val code = conn.responseCode
            if (code == 403 || code == 429) throw CloudException(Reason.TOO_MANY_ATTEMPTS, "Unsplash limit")
            if (code !in 200..299) throw CloudException(Reason.NETWORK, "Unsplash $code")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: IOException) {
            throw CloudException(Reason.NETWORK, "Unsplash", e)
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val API = "https://api.unsplash.com"

        /** Credits link back to Unsplash with the app's name, as the API guidelines ask. */
        private const val UTM = "utm_source=belong&utm_medium=referral"

        fun parse(body: String): List<Picture> = try {
            val results = JSONObject(body).optJSONArray("results") ?: return emptyList()
            (0 until results.length()).mapNotNull { i ->
                val p = results.optJSONObject(i) ?: return@mapNotNull null
                val urls = p.optJSONObject("urls") ?: return@mapNotNull null
                val user = p.optJSONObject("user")
                val regular = urls.optString("regular")
                if (!regular.startsWith("https://")) return@mapNotNull null
                Picture(
                    url = regular,
                    thumb = urls.optString("small").ifEmpty { regular },
                    by = user?.optString("name").orEmpty().ifEmpty { "Unsplash" },
                    link = withUtm(user?.optJSONObject("links")?.optString("html").orEmpty().ifEmpty { "https://unsplash.com" }),
                    source = "unsplash",
                    downloadLocation = p.optJSONObject("links")?.optString("download_location").orEmpty(),
                )
            }
        } catch (e: JSONException) {
            emptyList()
        }

        fun withUtm(url: String) = url + (if ('?' in url) "&" else "?") + UTM

        /** The Unsplash home page link that goes next to the photographer's name. */
        val home: String get() = withUtm("https://unsplash.com")
    }
}

/** The title and preview image of a shared link (the Open Graph tags Pinterest and most sites publish). */
object LinkPreview {
    data class Preview(val url: String, val title: String?, val image: String?, val site: String?)

    private val URL_IN_TEXT = Regex("https?://[^\\s]+")

    fun firstUrl(text: String): String? = URL_IN_TEXT.find(text)?.value?.trimEnd('.', ',', ')', '»', '"')

    /** Fetches [url] (following redirects, e.g. pin.it → pinterest.com) and reads its Open Graph tags. */
    fun fetch(url: String): Preview {
        var current = url
        repeat(5) {
            val conn = try {
                URL(current).openConnection() as HttpURLConnection
            } catch (e: IOException) {
                throw CloudException(Reason.NETWORK, "Preview", e)
            }
            try {
                conn.instanceFollowRedirects = false
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36")
                conn.setRequestProperty("Accept-Language", java.util.Locale.getDefault().toLanguageTag())
                val code = conn.responseCode
                if (code in 300..399) {
                    val next = conn.getHeaderField("Location") ?: throw CloudException(Reason.OTHER, "Redirect")
                    current = URL(URL(current), next).toString()
                    if (!current.startsWith("https://")) throw CloudException(Reason.OTHER, "Not https")
                    return@repeat
                }
                if (code !in 200..299) throw CloudException(Reason.NETWORK, "Preview $code")
                // The tags are in <head>; the first 256 KB is plenty.
                val html = conn.inputStream.bufferedReader().use { r ->
                    val buf = CharArray(256 * 1024)
                    val n = r.read(buf)
                    if (n > 0) String(buf, 0, n) else ""
                }
                return parse(current, html)
            } catch (e: IOException) {
                throw CloudException(Reason.NETWORK, "Preview", e)
            } finally {
                conn.disconnect()
            }
        }
        throw CloudException(Reason.OTHER, "Too many redirects")
    }

    private val META = Regex("<meta\\s[^>]*>", RegexOption.IGNORE_CASE)
    private val ATTR = Regex("([a-zA-Z:_-]+)\\s*=\\s*(\"([^\"]*)\"|'([^']*)')")

    fun parse(url: String, html: String): Preview {
        val tags = HashMap<String, String>()
        for (m in META.findAll(html)) {
            val attrs = ATTR.findAll(m.value).associate { a -> a.groupValues[1].lowercase() to (a.groups[3]?.value ?: a.groups[4]?.value ?: "") }
            val key = (attrs["property"] ?: attrs["name"])?.lowercase() ?: continue
            val content = attrs["content"] ?: continue
            tags.putIfAbsent(key, unescape(content))
        }
        val image = (tags["og:image:secure_url"] ?: tags["og:image"] ?: tags["twitter:image"])
            ?.let { if (it.startsWith("//")) "https:$it" else it }
            ?.takeIf { it.startsWith("https://") }
        val title = (tags["og:title"] ?: tags["twitter:title"])?.trim()?.takeIf { it.isNotEmpty() }
        val site = tags["og:site_name"] ?: try { URL(url).host.removePrefix("www.") } catch (e: IOException) { null }
        return Preview(url, title, image, site)
    }

    private fun unescape(s: String) = s
        .replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'")
        .replace("&lt;", "<").replace("&gt;", ">")
}
