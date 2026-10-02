package app.belong.couple.data

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import app.belong.couple.R
import app.belong.couple.core.ChatMessage
import app.belong.couple.core.Owner
import app.belong.couple.core.Task
import app.belong.couple.core.TaskList
import app.belong.couple.core.WishItem
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicLong

/** Tells open screens that tasks, wishes or messages changed (for example from a widget or the demo partner). */
object DataEvents {
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()

    fun changed() {
        main.post { listeners.forEach { it() } }
    }

    /** Calls [onChange] while [view] is attached to a window. */
    fun follow(view: View, onChange: () -> Unit) {
        view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                listeners += onChange
            }

            override fun onViewDetachedFromWindow(v: View) {
                listeners -= onChange
            }
        })
    }
}

private val ids = AtomicLong(System.currentTimeMillis())

fun newId(): Long = ids.incrementAndGet()

/** A list of items kept as JSON in the app's SharedPreferences. */
abstract class JsonList<T>(context: Context, private val key: String) {
    protected val app: Context = context.applicationContext
    private val prefs = CoupleStore.get(context).prefs

    protected abstract fun write(item: T): JSONObject
    protected abstract fun read(o: JSONObject): T?

    fun all(): List<T> = try {
        val array = JSONArray(prefs.getString(key, "[]"))
        (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.let { read(it) } }
    } catch (e: org.json.JSONException) {
        emptyList()
    }

    fun save(items: List<T>) {
        val array = JSONArray()
        items.forEach { array.put(write(it)) }
        prefs.edit().putString(key, array.toString()).apply()
        DataEvents.changed()
    }

    /** Drops the example items for a real pair and keeps them from coming back. */
    protected fun startEmpty(flag: String) {
        prefs.edit().putBoolean(flag, true).apply()
        save(emptyList())
    }

    protected fun seededOnce(flag: String, seed: () -> List<T>) {
        if (prefs.getBoolean(flag, false)) return
        prefs.edit().putBoolean(flag, true).apply()
        save(seed())
    }
}

class TaskRepo(context: Context) : JsonList<Task>(context, "tasks") {
    override fun write(item: Task) = JSONObject()
        .put("id", item.id).put("title", item.title).put("owner", item.owner.key)
        .put("done", item.done).put("day", item.day)

    override fun read(o: JSONObject) = Task(
        o.getLong("id"), o.getString("title"), Owner.of(o.optString("owner")), o.optBoolean("done"), o.optLong("day"),
    )

    private fun today(): Long = LocalDate.now().toEpochDay()

    fun forToday(): List<Task> = TaskList.forDay(all(), today())

    fun add(title: String, owner: Owner) {
        val text = title.trim().take(80)
        if (text.isEmpty()) return
        save(TaskList.prune(all(), today()) + Task(newId(), text, owner, false, today()))
    }

    fun toggle(id: Long) = save(TaskList.prune(all(), today()).map { if (it.id == id) it.copy(done = !it.done, day = today()) else it })

    fun remove(id: Long) = save(all().filterNot { it.id == id })

    fun startReal() = startEmpty("seeded_tasks")

    fun ensureSeeded() = seededOnce("seeded_tasks") {
        app.resources.getStringArray(R.array.seed_tasks).mapIndexed { i, line ->
            val (owner, title) = line.split('|', limit = 2)
            Task(newId(), title, Owner.of(owner), i == 3, today())
        }
    }
}

class WishRepo(context: Context) : JsonList<WishItem>(context, "wishes") {
    override fun write(item: WishItem) = JSONObject()
        .put("id", item.id).put("owner", item.owner.key).put("title", item.title).put("price", item.price)
        .put("link", item.link).put("note", item.note).put("reserved", item.reserved).put("at", item.createdAt)

    override fun read(o: JSONObject) = WishItem(
        o.getLong("id"), Owner.of(o.optString("owner")), o.getString("title"), o.optString("price"),
        o.optString("link"), o.optString("note"), o.optBoolean("reserved"), o.optLong("at"),
    )

    fun of(owner: Owner): List<WishItem> = all().filter { it.owner == owner }.sortedByDescending { it.createdAt }

    fun upsert(item: WishItem) {
        val items = all()
        save(if (items.any { it.id == item.id }) items.map { if (it.id == item.id) item else it } else items + item)
    }

    fun toggleReserved(id: Long) = save(all().map { if (it.id == id) it.copy(reserved = !it.reserved) else it })

    fun remove(id: Long) = save(all().filterNot { it.id == id })

    fun startReal() = startEmpty("seeded_wishes")

    fun ensureSeeded() = seededOnce("seeded_wishes") {
        val now = System.currentTimeMillis()
        app.resources.getStringArray(R.array.seed_wishes).mapIndexed { i, line ->
            val p = line.split('|')
            WishItem(newId(), Owner.of(p[0]), p[1], p.getOrElse(2) { "" }, "", p.getOrElse(3) { "" }, false, now - i * 60_000L)
        }
    }
}

class ChatRepo(context: Context) : JsonList<ChatMessage>(context, "chat") {
    override fun write(item: ChatMessage) = JSONObject()
        .put("id", item.id).put("me", item.fromMe).put("text", item.text).put("at", item.at).put("heart", item.hearted)
        .put("key", item.key).put("pending", item.pending)

    override fun read(o: JSONObject) = ChatMessage(
        o.getLong("id"), o.optBoolean("me"), o.getString("text"), o.optLong("at"), o.optBoolean("heart"),
        o.optString("key"), o.optBoolean("pending"),
    )

    fun send(text: String, fromMe: Boolean = true): ChatMessage? {
        val body = text.trim().take(2000)
        if (body.isEmpty()) return null
        val message = ChatMessage(newId(), fromMe, body, System.currentTimeMillis(), false)
        save((all() + message).takeLast(500))
        return message
    }

    fun toggleHeart(id: Long) = save(all().map { if (it.id == id) it.copy(hearted = !it.hearted) else it })

    /** Empties the chat for a real pair: no example messages, the server fills it in. */
    fun startShared() = startEmpty("seeded_chat")

    fun ensureSeeded() = seededOnce("seeded_chat") {
        val zone = ZoneId.systemDefault()
        val times = listOf(LocalTime.of(8, 12), LocalTime.of(8, 20), LocalTime.of(8, 21))
        app.resources.getStringArray(R.array.seed_chat).mapIndexed { i, line ->
            val (who, text) = line.split('|', limit = 2)
            val at = LocalDate.now().atTime(times.getOrElse(i) { LocalTime.NOON }).atZone(zone).toInstant().toEpochMilli()
            ChatMessage(newId(), who == "me", text, minOf(at, System.currentTimeMillis()), i == 2)
        }
    }
}
