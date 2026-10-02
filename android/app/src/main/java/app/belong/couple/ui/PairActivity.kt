package app.belong.couple.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.belong.couple.R
import app.belong.couple.core.PairCode
import app.belong.couple.core.Role
import app.belong.couple.data.Account
import app.belong.couple.data.ChatRepo
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.TaskRepo
import app.belong.couple.data.WishRepo
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Pairing
import app.belong.couple.sync.PublicPair
import app.belong.couple.sync.Reason
import app.belong.couple.sync.LiveSync
import app.belong.couple.sync.Seat

/**
 * Pairing without Google or email: one partner creates the pair and passes on its code,
 * the other joins with it. Each sets their own password and signs in later with the code and it.
 */
class PairActivity : Activity() {
    private enum class Step { START, CREATE, CODE, JOIN, SIGN_IN, RECOVER }

    private lateinit var body: LinearLayout
    private var step = Step.START
    private var busy = false

    /** Kept between steps: the code typed on the sign-in screen and who is signing in. */
    private var code = ""
    private var info: PublicPair? = null
    private var role: Role? = null
    private var created: Seat? = null

    override fun attachBaseContext(base: android.content.Context) = super.attachBaseContext(Language.wrap(base))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        body = column(12).apply {
            val side = dp(24)
            setPadding(side, dp(32), side, dp(32))
        }
        setContentView(ScrollView(this).apply {
            fitsSystemWindows = true
            isFillViewport = true
            setBackgroundColor(col(R.color.bg))
            addView(body)
        })
        show(Step.START)
    }

    @Deprecated("Kept for Android 12 and older; newer versions call it too while targetSdk < 35")
    override fun onBackPressed() {
        when (step) {
            Step.START -> @Suppress("DEPRECATION") super.onBackPressed()
            Step.CODE -> openApp()
            Step.RECOVER -> show(Step.SIGN_IN)
            else -> show(Step.START)
        }
    }

    private fun show(next: Step) {
        step = next
        body.removeAllViews()
        when (next) {
            Step.START -> start()
            Step.CREATE -> create()
            Step.CODE -> codeScreen()
            Step.JOIN -> join()
            Step.SIGN_IN -> signIn()
            Step.RECOVER -> recover()
        }
    }

    // ---------- Steps ----------

    private fun start() {
        body.gravity = Gravity.TOP
        // The two circles drift together, as in the brand animation.
        val art = FrameLayout(this)
        art.addView(View(this).apply { background = glow() }, FrameLayout.LayoutParams(dp(300), dp(300), Gravity.CENTER))
        val mark = PairMark(this, soft = true).apply { join = 0f }
        art.addView(mark, FrameLayout.LayoutParams(WRAP, dp(150), Gravity.CENTER))
        body.addView(art, LinearLayout.LayoutParams(MATCH, dp(320)))
        android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1000
            interpolator = android.view.animation.PathInterpolator(0.6f, 0f, 0.3f, 1f)
            addUpdateListener { mark.join = it.animatedValue as Float }
            start()
        }

        body.addView(text(getString(R.string.welcome_title), 32f, 800).apply {
            letterSpacing = -0.01f
            setLineSpacing(0f, 1f)
        })
        body.addView(text(getString(R.string.welcome_text), 16f, 400, col(R.color.ink2)).lp(top = 4, bottom = 20))
        if (Account.get(this).lostAccess) body.addView(note(getString(R.string.pair_lost_access)).lp(bottom = 12))
        body.addView(primaryButton(getString(R.string.pair_create)) { show(Step.CREATE) }.apply { minHeight = dp(56) })
        body.addView(secondaryButton(getString(R.string.pair_join)) { show(Step.JOIN) }.apply { minHeight = dp(56) }.lp(top = 12))
        val more = row(8)
        more.addView(textButton(getString(R.string.pair_sign_in)) { show(Step.SIGN_IN) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        more.addView(textButton(getString(R.string.pair_demo)) {
            Account.get(this).demoChosen = true
            openApp()
        }.apply { setTextColor(col(R.color.ink2)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        body.addView(more.lp(top = 8))
    }

    private fun create() {
        body.gravity = Gravity.TOP
        body.addView(text(getString(R.string.step_of, 1, 2), 13f, 600, col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        heading(R.string.pair_create, R.string.pair_create_text)
        val name = field(R.string.pair_your_name, InputType.TYPE_TEXT_FLAG_CAP_WORDS, 24)
        val password = passwordField(R.string.pair_password)
        val repeat = passwordField(R.string.pair_password_repeat)
        body.addView(note(getString(R.string.pair_password_note)))
        val error = errorText()
        body.addView(primaryButton(getString(R.string.pair_create_button)) { button ->
            val n = name.text.toString().trim()
            val p = password.text.toString()
            val problem = checkName(n) ?: checkPassword(p, repeat.text.toString())
            if (problem != null) return@primaryButton showError(error, problem)
            run(button, error, { Pairing(Account.get(this).config).create(n, p) }) { seat ->
                created = seat
                finishPairing(seat)
                show(Step.CODE)
            }
        })
    }

    /** Step 2 of 2: pass the code on and wait until the partner joins. */
    private fun codeScreen() {
        val seat = created ?: return openApp()
        val formatted = PairCode.format(seat.code)
        body.gravity = Gravity.TOP
        body.addView(text(getString(R.string.step_of, 2, 2), 13f, 600, col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        heading(R.string.invite_title, R.string.invite_text)

        val card = card(paddingDp = 20, spacingDp = 6)
        card.addView(text(getString(R.string.pair_code), 13f, 600, col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        val codeRow = row(8).apply { gravity = Gravity.CENTER }
        codeRow.addView(text(formatted, 32f, 800).apply {
            letterSpacing = 0.06f
            setTextIsSelectable(true)
        })
        codeRow.addView(android.widget.ImageView(this).apply {
            setImageDrawable(icon(R.drawable.ic_copy, col(R.color.ink2), 20))
            scaleType = android.widget.ImageView.ScaleType.CENTER
            contentDescription = getString(R.string.pair_copy)
            background = ripple(rounded(col(R.color.surface), 22f), 22f)
            setOnClickListener {
                getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(getString(R.string.app_name), formatted))
                Toaster.show(this@PairActivity, getString(R.string.pair_copied), R.drawable.ic_copy)
            }
        }, LinearLayout.LayoutParams(dp(44), dp(44)))
        card.addView(codeRow)
        card.addView(text(getString(R.string.pair_code_note), 13f, 500, col(R.color.ink2)).apply { gravity = Gravity.CENTER })
        body.addView(card.lp(top = 12))

        body.addView(primaryButton(getString(R.string.pair_share), R.drawable.ic_share) {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, getString(R.string.pair_share_text, formatted))
            }, getString(R.string.pair_share)))
        }.apply { minHeight = dp(56) }.lp(top = 20))

        // "Waiting for your partner…" with a pulsing avatar; checks every few seconds whether they joined.
        val waiting = row(14).apply {
            background = rounded(col(R.color.him_tint), 20f)
            setPadding(dp(14), dp(14), dp(16), dp(14))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        val pulse = FrameLayout(this)
        pulse.addView(PulseRings(this), FrameLayout.LayoutParams(dp(64), dp(64), Gravity.CENTER))
        pulse.addView(avatar("?", col(R.color.him), 40).apply { layoutParams = FrameLayout.LayoutParams(dp(40), dp(40), Gravity.CENTER) })
        waiting.addView(pulse, LinearLayout.LayoutParams(dp(64), dp(64)))
        val texts = column(2)
        val title = text(getString(R.string.waiting_title), 16f, 700)
        val caption = text(getString(R.string.waiting_text), 13f, 500, col(R.color.on_tint))
        texts.addView(title)
        texts.addView(caption)
        waiting.addView(texts, LinearLayout.LayoutParams(0, WRAP, 1f))
        body.addView(waiting.lp(top = 20))
        val open = textButton(getString(R.string.pair_later)) { openApp() }
        body.addView(open.lp(top = 8))

        val config = Account.get(this).config
        val check = object : Runnable {
            override fun run() {
                if (step != Step.CODE || isFinishing) return
                Thread {
                    val partner = try { Pairing(config).publicInfo(seat.code)?.names?.get(Role.B) } catch (e: CloudException) { null }
                    runOnUiThread {
                        if (step != Step.CODE || isFinishing) return@runOnUiThread
                        if (partner.isNullOrBlank()) {
                            body.postDelayed(this, 4_000)
                            return@runOnUiThread
                        }
                        Account.get(this@PairActivity).setPartnerName(partner)
                        CoupleStore.get(this@PairActivity).partnerName = partner
                        pulse.removeAllViews()
                        pulse.addView(PairMark(this@PairActivity).apply {
                            initials = seat.myName.take(1).uppercase() to partner.take(1).uppercase()
                        }, FrameLayout.LayoutParams(WRAP, dp(40), Gravity.CENTER))
                        title.text = getString(R.string.joined_title, partner)
                        caption.text = getString(R.string.joined_text)
                        body.removeView(open)
                        body.addView(primaryButton(getString(R.string.pair_open_app)) { openApp() }.apply { minHeight = dp(56) }.lp(top = 12))
                    }
                }.start()
            }
        }
        body.postDelayed(check, 3_000)
    }

    private fun join() {
        body.gravity = Gravity.TOP
        heading(R.string.pair_join, R.string.pair_join_text)
        val codeField = codeField()
        val name = field(R.string.pair_your_name, InputType.TYPE_TEXT_FLAG_CAP_WORDS, 24)
        val password = passwordField(R.string.pair_password)
        val repeat = passwordField(R.string.pair_password_repeat)
        body.addView(note(getString(R.string.pair_password_note)))
        val error = errorText()
        body.addView(primaryButton(getString(R.string.pair_join_button)) { button ->
            val c = PairCode.parse(codeField.text.toString())
            val n = name.text.toString().trim()
            val p = password.text.toString()
            val problem = (if (c == null) getString(R.string.pair_error_code_format) else null)
                ?: checkName(n) ?: checkPassword(p, repeat.text.toString())
            if (problem != null || c == null) return@primaryButton showError(error, problem.orEmpty())
            run(button, error, { Pairing(Account.get(this).config).join(c, n, p) }) { seat ->
                finishPairing(seat)
                toast(getString(R.string.pair_joined, seat.partnerName ?: ""))
                openApp()
            }
        })
    }

    private fun signIn() {
        body.gravity = Gravity.TOP
        heading(R.string.pair_sign_in, R.string.pair_sign_in_text)
        val codeField = codeField().apply { setText(if (code.isEmpty()) "" else PairCode.format(code)) }
        val error = errorText()
        val who = column(12)
        body.addView(who)

        fun showSeats(pair: PublicPair) {
            who.removeAllViews()
            who.addView(text(getString(R.string.pair_who), 13f, 700, col(R.color.ink2)))
            val chips = row(8)
            for (r in Role.entries) {
                val name = pair.names[r]?.takeIf { pair.gens.containsKey(r) } ?: continue
                chips.addView(chip(name, r == role) {
                    role = r
                    showSeats(pair)
                })
            }
            who.addView(chips)
            val selected = role ?: return
            val password = passwordField(R.string.pair_password, who)
            who.addView(primaryButton(getString(R.string.pair_sign_in_button)) { button ->
                val p = password.text.toString()
                if (p.isEmpty()) return@primaryButton showError(error, getString(R.string.pair_error_password_short, PairCode.MIN_PASSWORD))
                run(button, error, { Pairing(Account.get(this).config).signIn(code, selected, p) }) { seat ->
                    finishPairing(seat)
                    openApp()
                }
            })
            val partner = pair.names[selected.other]
            if (partner != null) who.addView(link(getString(R.string.pair_forgot)) { show(Step.RECOVER) })
        }

        body.addView(secondaryButton(getString(R.string.pair_next)) { button ->
            val c = PairCode.parse(codeField.text.toString()) ?: return@secondaryButton showError(error, getString(R.string.pair_error_code_format))
            run(button, error, { Pairing(Account.get(this).config).publicInfo(c) ?: throw CloudException(Reason.NO_SUCH_PAIR) }) { pair ->
                code = c
                info = pair
                role = role?.takeIf { pair.gens.containsKey(it) }
                showSeats(pair)
            }
        }, body.childCount - 1)
        info?.takeIf { code.isNotEmpty() }?.let { showSeats(it) }
    }

    private fun recover() {
        val selected = role ?: return show(Step.SIGN_IN)
        val partner = info?.names?.get(selected.other).orEmpty()
        body.gravity = Gravity.TOP
        body.addView(text(getString(R.string.pair_recover_title), 26f, 800))
        body.addView(text(getString(R.string.pair_recover_text, partner), 15f, 500, col(R.color.ink2)).lp(bottom = 8))
        val help = field(R.string.pair_help_code, InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 12)
        val password = passwordField(R.string.pair_new_password)
        val repeat = passwordField(R.string.pair_password_repeat)
        val error = errorText()
        body.addView(primaryButton(getString(R.string.pair_recover_button)) { button ->
            val h = PairCode.parse(help.text.toString())
            val p = password.text.toString()
            val problem = (if (h == null) getString(R.string.pair_error_help_code) else null) ?: checkPassword(p, repeat.text.toString())
            if (problem != null || h == null) return@primaryButton showError(error, problem.orEmpty())
            run(button, error, { Pairing(Account.get(this).config).recover(code, selected, h, p) }) { seat ->
                finishPairing(seat)
                toast(getString(R.string.pair_recovered))
                openApp()
            }
        })
    }

    // ---------- Actions ----------

    /** Runs [work] off the main thread, then [done] with its result or shows the error. */
    private fun <T> run(button: View, error: TextView, work: () -> T, done: (T) -> Unit) {
        if (busy) return
        busy = true
        button.isEnabled = false
        button.alpha = 0.6f
        error.visibility = View.GONE
        Thread {
            val result = try {
                Result.success(work())
            } catch (e: CloudException) {
                Result.failure(e)
            } catch (e: RuntimeException) {
                Result.failure(CloudException(Reason.OTHER, e.message ?: "", e))
            }
            runOnUiThread {
                busy = false
                button.isEnabled = true
                button.alpha = 1f
                if (isFinishing) return@runOnUiThread
                result.fold(done) { showError(error, message((it as CloudException).reason)) }
            }
        }.start()
    }

    /** Signs this phone in and replaces the example couple with the real one. */
    private fun finishPairing(seat: Seat) {
        Account.get(this).signIn(seat)
        val store = CoupleStore.get(this)
        store.startReal()
        TaskRepo(this).startReal()
        WishRepo(this).startReal()
        if (seat.myName.isNotBlank()) store.myName = seat.myName
        store.partnerName = seat.partnerName?.takeIf { it.isNotBlank() } ?: getString(R.string.pair_partner_placeholder)
        store.partnerNickname = ""
        ChatRepo(this).startShared()
        LiveSync.reset(this)
    }

    private fun openApp() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
        finish()
    }

    private fun message(reason: Reason): String = getString(
        when (reason) {
            Reason.NETWORK -> R.string.pair_error_network
            Reason.WRONG_PASSWORD -> R.string.pair_error_wrong_password
            Reason.TOO_MANY_ATTEMPTS -> R.string.pair_error_too_many
            Reason.WEAK_PASSWORD -> R.string.pair_error_weak
            Reason.NO_SUCH_PAIR -> R.string.pair_error_no_pair
            Reason.CODE_USED -> R.string.pair_error_code_used
            Reason.BAD_HELP_CODE -> R.string.pair_error_help_code_wrong
            else -> R.string.pair_error_other
        },
    )

    private fun checkName(name: String): String? = if (name.isBlank()) getString(R.string.pair_error_name) else null

    private fun checkPassword(password: String, repeat: String): String? = when {
        !PairCode.passwordOk(password) -> getString(R.string.pair_error_password_short, PairCode.MIN_PASSWORD)
        password != repeat -> getString(R.string.pair_error_password_mismatch)
        else -> null
    }

    // ---------- Views ----------

    private fun heading(title: Int, subtitle: Int) {
        body.addView(text(getString(title), 28f, 700).apply { letterSpacing = -0.01f }.lp(top = 8))
        body.addView(text(getString(subtitle), 16f, 400, col(R.color.ink2)).lp(top = 4, bottom = 8))
    }

    private fun note(value: String): TextView = text(value, 13f, 500, col(R.color.ink2)).apply {
        background = rounded(col(R.color.sunk), 14f)
        setPadding(dp(14), dp(10), dp(14), dp(10))
    }

    private fun errorText(): TextView = text("", 14f, 600, col(R.color.her)).apply { visibility = View.GONE }.also { body.addView(it) }

    private fun showError(view: TextView, message: String) {
        view.text = message
        view.visibility = View.VISIBLE
        view.announceForAccessibility(message)
    }

    private fun link(label: String, onClick: () -> Unit): TextView = text(label, 15f, 700, col(R.color.us_end)).apply {
        gravity = Gravity.CENTER
        minHeight = dp(48)
        background = ripple(rounded(col(R.color.bg), 16f), 16f)
        setOnClickListener { onClick() }
    }

    private fun field(label: Int, flags: Int, max: Int, parent: LinearLayout = body): EditText {
        parent.addView(text(getString(label), 13f, 700, col(R.color.ink2)))
        return EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or flags
            filters = arrayOf(InputFilter.LengthFilter(max))
            maxLines = 1
            typeface = Fonts.get(context, 500)
            minHeight = dp(48)
        }.also { parent.addView(it) }
    }

    private fun passwordField(label: Int, parent: LinearLayout = body): EditText =
        field(label, InputType.TYPE_TEXT_VARIATION_PASSWORD, 64, parent)

    private fun codeField(): EditText =
        field(R.string.pair_code, InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 12).apply {
            hint = "K7M3-Q9XP"
        }
}
