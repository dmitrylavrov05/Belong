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
import app.belong.couple.data.Account
import app.belong.couple.data.ChatRepo
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DataEvents
import app.belong.couple.data.TaskRepo
import app.belong.couple.data.WishRepo
import app.belong.couple.sync.PairSync
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

    override fun attachBaseContext(base: android.content.Context) = super.attachBaseContext(Language.wrap(base))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Account.get(this).needsPairing) return openPairing()
        CoupleStore.get(this).ensureSeeded()
        TaskRepo(this).ensureSeeded()
        WishRepo(this).ensureSeeded()
        app.belong.couple.data.SharedRepo(this).ensureSeeded()
        ChatRepo(this).ensureSeeded()

        val root = column().apply {
            fitsSystemWindows = true
            setBackgroundColor(col(R.color.bg))
        }
        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(MATCH, 0, 1f))
        root.addView(tabBar(), LinearLayout.LayoutParams(MATCH, WRAP))
        setContentView(root)
        // Signing out, or losing access after a password reset on another phone, returns to pairing.
        DataEvents.follow(root) { if (Account.get(this).needsPairing && !isFinishing) openPairing() }

        val fromIntent = intent?.getIntExtra(EXTRA_TAB, -1) ?: -1
        select(if (fromIntent >= 0) fromIntent else savedInstanceState?.getInt(STATE_TAB) ?: TAB_TODAY)
        handleShare(intent)
        Widgets.updateAll(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val tab = intent.getIntExtra(EXTRA_TAB, -1)
        if (tab >= 0) select(tab)
        handleShare(intent)
    }

    override fun onStart() {
        super.onStart()
        PairSync.start(this)
    }

    override fun onStop() {
        super.onStop()
        PairSync.stop()
    }

    /** A link shared into Belong becomes a new dream. */
    private fun handleShare(intent: Intent?) {
        val text = intent?.getStringExtra(EXTRA_SHARED_TEXT) ?: return
        intent.removeExtra(EXTRA_SHARED_TEXT) // not again after rotation
        select(TAB_DREAMS)
        (screens[TAB_DREAMS] as? DreamsScreen)?.addFromShare(text)
    }

    private fun openPairing() {
        startActivity(Intent(this, PairActivity::class.java))
        finish()
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
            current in PARENT -> select(PARENT.getValue(current))
            current != TAB_TODAY -> select(TAB_TODAY)
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PHOTOS) (screens[TAB_MAP] as? MapScreen)?.onPermissionsResult()
        if (requestCode == REQUEST_MIC) (screens[TAB_CHAT] as? ChatScreen)?.onMicPermission(grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED)
    }

    @Deprecated("Activity results without AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_DAY_PHOTOS && resultCode == RESULT_OK) PhotosScreen.picked(this, data)
        if (requestCode == REQUEST_SCRATCH_PHOTO && resultCode == RESULT_OK) (screens[TAB_SCRATCH] as? ScratchScreen)?.onPhotoPicked(data)
        if (requestCode == REQUEST_AVATAR && resultCode == RESULT_OK) (screens[TAB_SETTINGS] as? SettingsScreen)?.onAvatarPicked(data)
        if (requestCode == REQUEST_COVER && resultCode == RESULT_OK) (screens[TAB_TODAY] as? TodayScreen)?.onCoverPicked(data)
        if (requestCode == REQUEST_CHAT_PHOTO && resultCode == RESULT_OK) (screens[TAB_CHAT] as? ChatScreen)?.onPhotoPicked(data)
    }

    fun select(destination: Int) {
        current = if (destination in 0..TAB_SCRATCH) destination else TAB_TODAY
        val screen = screens.getOrPut(current) { create(current) }
        val parent = PARENT[current]
        val view = if (parent != null) framed.getOrPut(current) { withBackBar(screen.view, parent) } else screen.view
        content.removeAllViews()
        (view.parent as? FrameLayout)?.removeView(view)
        content.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
        screen.refresh()
        val tab = parent ?: current
        tabViews.forEachIndexed { i, t -> styleTab(t, TABS[i].first == tab) }
    }

    /** Opens "Customise Today" over Today. */
    fun openCustomize() {
        select(TAB_TODAY)
        (screens[TAB_TODAY] as? TodayScreen)?.customize()
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
        TAB_MORE -> UsScreen(this)
        TAB_DOODLE -> DoodleScreen(this)
        TAB_GAMES -> GamesScreen(this)
        TAB_MONTH -> MonthScreen(this)
        TAB_DREAMS -> DreamsScreen(this)
        TAB_CALENDAR -> CalendarScreen(this)
        TAB_PHOTOS -> PhotosScreen(this)
        TAB_FEELINGS -> FeelingsScreen(this)
        TAB_LETTERS -> LettersScreen(this)
        TAB_MOVIES -> MoviesScreen(this)
        TAB_INBOX -> InboxScreen(this)
        TAB_SETTINGS -> SettingsScreen(this)
        TAB_SCRATCH -> ScratchScreen(this)
        else -> TodayScreen(this)
    }

    /** Sub-screens get a back button to the tab they belong to. */
    private fun withBackBar(child: View, parent: Int): View = column().apply {
        val bar = row(4).apply { setPadding(dp(8), dp(4), dp(16), 0) }
        bar.addView(ImageView(this@MainActivity).apply {
            setImageDrawable(icon(R.drawable.ic_back, col(R.color.ink), 22))
            scaleType = ImageView.ScaleType.CENTER
            contentDescription = getString(R.string.back)
            background = ripple(rounded(col(R.color.bg), 24f), 24f)
            setOnClickListener { select(parent) }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        bar.addView(text(getString(when (parent) { TAB_DREAMS -> R.string.dreams_title; TAB_TODAY -> R.string.tab_today; else -> R.string.tab_more }), 15f, 700, col(R.color.ink2)))
        addView(bar)
        addView(child, LinearLayout.LayoutParams(MATCH, 0, 1f))
    }

    private fun tabBar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        background = android.graphics.drawable.LayerDrawable(arrayOf(
            android.graphics.drawable.ColorDrawable(col(R.color.line)),
            android.graphics.drawable.InsetDrawable(android.graphics.drawable.ColorDrawable(col(R.color.surface)), 0, dp(1), 0, 0),
        ))
        setPadding(dp(2), dp(6), dp(2), dp(6))
        TABS.forEach { (destination, label, iconRes) ->
            val tab = text(getString(label), 12f, 600, col(R.color.ink2)).apply {
                gravity = Gravity.CENTER
                minHeight = dp(56)
                maxLines = 1
                compoundDrawablePadding = dp(4)
                setCompoundDrawablesRelative(null, icon(iconRes, col(R.color.ink2), 22), null, null)
                background = ripple(rounded(col(R.color.surface), 16f), 16f)
                setOnClickListener { select(destination) }
                tag = iconRes
            }
            tabViews += tab
            addView(tab, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
    }

    /** The chosen tab's icon takes the pair gradient and its label turns dark and bold. */
    private fun styleTab(tab: TextView, selected: Boolean) {
        tab.setTextColor(col(if (selected) R.color.ink else R.color.ink2))
        tab.typeface = Fonts.get(this, if (selected) 700 else 600)
        val iconRes = tab.tag as Int
        tab.setCompoundDrawablesRelative(null, if (selected) gradientIcon(iconRes, 24) else icon(iconRes, col(R.color.ink2), 24), null, null)
        tab.isSelected = selected
    }

    companion object {
        const val EXTRA_TAB = "app.belong.couple.TAB"
        const val EXTRA_SHARED_TEXT = "app.belong.couple.SHARED_TEXT"
        private const val STATE_TAB = "tab"
        const val REQUEST_PHOTOS = 41
        const val REQUEST_DAY_PHOTOS = 42
        const val REQUEST_CHAT_PHOTO = 43
        const val REQUEST_MIC = 44
        const val REQUEST_COVER = 45
        const val REQUEST_AVATAR = 46
        const val REQUEST_SCRATCH_PHOTO = 47

        const val TAB_TODAY = 0
        const val TAB_CHAT = 1
        const val TAB_WISHLIST = 2
        const val TAB_MAP = 3
        const val TAB_MORE = 4
        const val TAB_DOODLE = 5
        const val TAB_GAMES = 6
        const val TAB_MONTH = 7
        const val TAB_DREAMS = 8
        const val TAB_CALENDAR = 9
        const val TAB_PHOTOS = 10
        const val TAB_FEELINGS = 11
        const val TAB_LETTERS = 12
        const val TAB_MOVIES = 13
        const val TAB_INBOX = 14
        const val TAB_SETTINGS = 15
        const val TAB_SCRATCH = 16

        /** Screens reached from a tab, with a back button to it. */
        private val PARENT = mapOf(
            TAB_WISHLIST to TAB_DREAMS,
            TAB_DOODLE to TAB_MORE,
            TAB_GAMES to TAB_MORE,
            TAB_MONTH to TAB_MORE,
            TAB_CALENDAR to TAB_MORE,
            TAB_MAP to TAB_MORE,
            TAB_FEELINGS to TAB_MORE,
            TAB_LETTERS to TAB_MORE,
            TAB_MOVIES to TAB_MORE,
            TAB_INBOX to TAB_TODAY,
            TAB_SETTINGS to TAB_MORE,
            TAB_SCRATCH to TAB_MORE,
        )

        private val TABS = listOf(
            Triple(TAB_TODAY, R.string.tab_today, R.drawable.ic_tab_today),
            Triple(TAB_DREAMS, R.string.tab_dreams, R.drawable.ic_tab_dreams),
            Triple(TAB_CHAT, R.string.tab_chat, R.drawable.ic_tab_chat),
            Triple(TAB_PHOTOS, R.string.tab_photos, R.drawable.ic_tab_photos),
            Triple(TAB_MORE, R.string.tab_more, R.drawable.ic_tab_us),
        )
    }
}
