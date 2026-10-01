package app.belong.couple.demo

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import app.belong.couple.R
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.Counter
import app.belong.couple.data.DoodleArt
import app.belong.couple.widget.Widgets
import kotlin.random.Random

/**
 * Stands in for the partner's phone until there is a sync server:
 * answers taps and doodles after a short pause so widgets and counters visibly change.
 */
object DemoPartner {
    private val main = Handler(Looper.getMainLooper())
    private var nextDoodle = 1

    fun onThinkingSent(context: Context) {
        val app = context.applicationContext
        if (Random.nextFloat() > 0.6f) return
        main.postDelayed({
            val store = CoupleStore.get(app)
            store.increment(Counter.TAPS_RECEIVED)
            Toast.makeText(app, app.getString(R.string.think_back, store.partnerName), Toast.LENGTH_SHORT).show()
        }, 3_000)
    }

    fun onDoodleSent(context: Context) {
        val app = context.applicationContext
        main.postDelayed({
            val store = CoupleStore.get(app)
            store.savePartnerDoodle(DoodleArt.draw(app, nextDoodle++, 600))
            store.increment(Counter.DOODLES)
            Widgets.updateAll(app)
            Toast.makeText(app, app.getString(R.string.doodle_reply, store.partnerName), Toast.LENGTH_SHORT).show()
        }, 5_000)
    }
}
