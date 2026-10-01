package app.belong.couple.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.data.ChatRepo
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.TaskRepo
import app.belong.couple.data.WishRepo
import app.belong.couple.widget.Widgets

/** One screen of the app. */
interface Screen {
    val view: View
    fun refresh()
}

class MainActivity : Activity() {

    private lateinit var content: FrameLayout
    private val tabViews = mutableListOf<TextView>()
    private val screens = HashMap<Int, Screen>()
    private val framed = HashMap<Int, View>()
    private var current = TAB_TODAY

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CoupleStore.get(this).ensureSeeded()
        TaskRepo(this).ensureSeeded()
        WishRepo(this).ensureSeeded()
        ChatRepo(this).ensureSeeded()

        val root = column().apply {
            fitsSystemWindows = true
            setBackgroundColor(col(R.color.bg))
        }
        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(MATCH, 0, 1f))
        root.addView(tabBar(), LinearLayout.LayoutParams(MATCH, WRAP))
        setContentView(root)

        val fromIntent = intent?.getIntExtra(EXTRA_TAB, -1) ?: -1
        select(if (fromIntent >= 0) fromIntent else savedInstanceState?.getInt(STATE_TAB) ?: TAB_TODAY)
        Widgets.updateAll(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val tab = intent.getIntExtra(EXTRA_TAB, -1)
        if (tab >= 0) select(tab)
    }

    override fun onResume() {
        super.onResume()
        screens[current]?.refresh()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(STATE_TAB, current)
    }

    @Deprecated("Kept for Android 12 and older; newer versions call it too while targetSdk < 35")
    override fun onBackPressed() {
        when {
            current >= TAB_DOODLE -> select(TAB_MORE)
            current != TAB_TODAY -> select(TAB_TODAY)
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PHOTOS) (screens[TAB_MAP] as? MapScreen)?.onPermissionsResult()
    }

    fun select(destination: Int) {
        current = if (destination in 0..TAB_MONTH) destination else TAB_TODAY
        val screen = screens.getOrPut(current) { create(current) }
        val view = if (current >= TAB_DOODLE) framed.getOrPut(current) { withBackBar(screen.view) } else screen.view
        content.removeAllViews()
        (view.parent as? FrameLayout)?.removeView(view)
        content.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
        screen.refresh()
        val tab = if (current >= TAB_DOODLE) TAB_MORE else current
        tabViews.forEachIndexed { i, t -> styleTab(t, i == tab) }
    }

    /** Redraws every created screen, e.g. after the couple settings change. */
    fun refreshAll() {
        screens.values.forEach { it.refresh() }
        Widgets.updateAll(this)
    }

    private fun create(destination: Int): Screen = when (destination) {
        TAB_CHAT -> ChatScreen(this)
        TAB_WISHLIST -> WishlistScreen(this)
        TAB_MAP -> MapScreen(this)
        TAB_MORE -> MoreScreen(this)
        TAB_DOODLE -> DoodleScreen(this)
        TAB_GAMES -> GamesScreen(this)
        TAB_MONTH -> MonthScreen(this)
        else -> TodayScreen(this)
    }

    /** Sub-screens under "More" get a back button at the top. */
    private fun withBackBar(child: View): View = column().apply {
        val bar = row(4).apply { setPadding(dp(8), dp(4), dp(16), 0) }
        bar.addView(ImageView(this@MainActivity).apply {
            setImageDrawable(icon(R.drawable.ic_back, col(R.color.ink), 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = getString(R.string.back)
            background = ripple(rounded(col(R.color.bg), 24f), 24f)
            setOnClickListener { select(TAB_MORE) }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        bar.addView(text(getString(R.string.more_title), 15f, 700, col(R.color.ink2)))
        addView(bar)
        addView(child, LinearLayout.LayoutParams(MATCH, 0, 1f))
    }

    private fun tabBar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(col(R.color.surface))
        elevation = dp(8).toFloat()
        setPadding(dp(2), dp(6), dp(2), dp(6))
        TABS.forEachIndexed { index, (label, iconRes) ->
            val tab = text(getString(label), 11f, 600, col(R.color.ink2)).apply {
                gravity = Gravity.CENTER
                minHeight = dp(56)
                maxLines = 1
                compoundDrawablePadding = dp(4)
                setCompoundDrawablesRelative(null, icon(iconRes, col(R.color.ink2), 22), null, null)
                background = ripple(rounded(col(R.color.surface), 16f), 16f)
                setOnClickListener { select(index) }
                tag = iconRes
            }
            tabViews += tab
            addView(tab, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
    }

    private fun styleTab(tab: TextView, selected: Boolean) {
        val color = col(if (selected) R.color.ink else R.color.ink2)
        val iconColor = col(if (selected) R.color.us_end else R.color.ink2)
        tab.setTextColor(color)
        tab.typeface = Fonts.get(this, if (selected) 800 else 600)
        tab.setCompoundDrawablesRelative(null, icon(tab.tag as Int, iconColor, 22), null, null)
        tab.isSelected = selected
    }

    companion object {
        const val EXTRA_TAB = "app.belong.couple.TAB"
        private const val STATE_TAB = "tab"
        const val REQUEST_PHOTOS = 41

        const val TAB_TODAY = 0
        const val TAB_CHAT = 1
        const val TAB_WISHLIST = 2
        const val TAB_MAP = 3
        const val TAB_MORE = 4
        const val TAB_DOODLE = 5
        const val TAB_GAMES = 6
        const val TAB_MONTH = 7

        private val TABS = listOf(
            R.string.tab_today to R.drawable.ic_tab_today,
            R.string.tab_chat to R.drawable.ic_tab_chat,
            R.string.tab_wishlist to R.drawable.ic_tab_gift,
            R.string.tab_map to R.drawable.ic_tab_map,
            R.string.tab_more to R.drawable.ic_tab_more,
        )
    }
}
