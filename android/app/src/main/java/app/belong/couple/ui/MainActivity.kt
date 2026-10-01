package app.belong.couple.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.data.CoupleStore
import app.belong.couple.widget.Widgets

/** One screen of the bottom navigation. */
interface Screen {
    val view: View
    fun refresh()
}

class MainActivity : Activity() {

    private lateinit var content: FrameLayout
    private val tabViews = mutableListOf<TextView>()
    private val screens = arrayOfNulls<Screen>(TABS.size)
    private var current = TAB_TODAY

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CoupleStore.get(this).ensureSeeded()

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

    fun select(index: Int) {
        current = index.coerceIn(0, TABS.size - 1)
        val screen = screens[current] ?: create(current).also { screens[current] = it }
        content.removeAllViews()
        content.addView(screen.view, FrameLayout.LayoutParams(MATCH, MATCH))
        screen.refresh()
        tabViews.forEachIndexed { i, tab -> styleTab(tab, i == current) }
    }

    /** Redraws every created screen, e.g. after the couple settings change. */
    fun refreshAll() {
        screens.forEach { it?.refresh() }
        Widgets.updateAll(this)
    }

    private fun create(index: Int): Screen = when (index) {
        TAB_TODAY -> TodayScreen(this)
        TAB_DOODLE -> DoodleScreen(this)
        TAB_GAMES -> GamesScreen(this)
        else -> MonthScreen(this)
    }

    private fun tabBar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(col(R.color.surface))
        elevation = dp(8).toFloat()
        setPadding(dp(4), dp(6), dp(4), dp(6))
        TABS.forEachIndexed { index, (label, iconRes) ->
            val tab = text(getString(label), 12f, 600, col(R.color.ink2)).apply {
                gravity = Gravity.CENTER
                minHeight = dp(56)
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
        const val TAB_TODAY = 0
        const val TAB_DOODLE = 1
        const val TAB_GAMES = 2
        const val TAB_MONTH = 3

        private val TABS = listOf(
            R.string.tab_today to R.drawable.ic_tab_today,
            R.string.tab_doodle to R.drawable.ic_tab_doodle,
            R.string.tab_games to R.drawable.ic_tab_games,
            R.string.tab_month to R.drawable.ic_tab_month,
        )
    }
}
