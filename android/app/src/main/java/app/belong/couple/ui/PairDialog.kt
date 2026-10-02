package app.belong.couple.ui

import android.app.AlertDialog
import android.content.Intent
import android.widget.ScrollView
import app.belong.couple.R
import app.belong.couple.core.PairCode
import app.belong.couple.data.Account
import app.belong.couple.data.ChatRepo
import app.belong.couple.data.CoupleStore
import app.belong.couple.sync.LiveSync
import app.belong.couple.sync.PairSync
import app.belong.couple.sync.CloudException
import app.belong.couple.sync.Pairing

/** "Our pair" under More: the code, helping the partner sign in, and signing out. */
object PairDialog {

    fun show(activity: MainActivity) {
        val ctx = activity
        val account = Account.get(ctx)
        val seat = account.seat
        if (seat == null) {
            account.demoChosen = false
            activity.startActivity(Intent(activity, PairActivity::class.java))
            activity.finish()
            return
        }
        val code = PairCode.format(seat.code)
        val partner = seat.partnerName?.takeIf { it.isNotBlank() }
        val form = ctx.column(12).apply {
            val p = ctx.dp(24)
            setPadding(p, ctx.dp(8), p, ctx.dp(8))
        }
        form.addView(ctx.text(ctx.getString(R.string.pair_code), 13f, 700, ctx.col(R.color.ink2)))
        form.addView(ctx.text(code, 28f, 800).apply {
            letterSpacing = 0.06f
            setTextIsSelectable(true)
        })
        form.addView(ctx.text(ctx.getString(R.string.pair_signed_in_as, seat.myName), 15f, 500))
        form.addView(ctx.text(
            if (partner != null) ctx.getString(R.string.pair_partner_joined, partner) else ctx.getString(R.string.pair_partner_waiting),
            15f, 500, ctx.col(R.color.ink2),
        ))
        if (partner == null) {
            form.addView(ctx.primaryButton(ctx.getString(R.string.pair_share), R.drawable.ic_share) {
                ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, ctx.getString(R.string.pair_share_text, code))
                }, ctx.getString(R.string.pair_share)))
            })
        } else {
            form.addView(ctx.secondaryButton(ctx.getString(R.string.pair_help_partner, partner), R.drawable.ic_shield) {
                helpPartner(activity, partner)
            })
        }
        form.addView(ctx.text(ctx.getString(R.string.pair_remember, code), 13f, 500, ctx.col(R.color.ink2)))

        AlertDialog.Builder(activity)
            .setTitle(R.string.pair_title)
            .setView(ScrollView(ctx).apply { addView(form) })
            .setPositiveButton(R.string.pair_close, null)
            .setNeutralButton(R.string.pair_sign_out) { _, _ -> confirmSignOut(activity, code) }
            .show()
    }

    private fun helpPartner(activity: MainActivity, partner: String) {
        val account = Account.get(activity)
        val seat = account.seat ?: return
        activity.toast(activity.getString(R.string.pair_help_making))
        Thread {
            val help = try {
                Pairing(account.config).makeHelpCode(seat.code, seat.role.other, account.token())
            } catch (e: CloudException) {
                null
            }
            activity.runOnUiThread {
                if (activity.isFinishing) return@runOnUiThread
                if (help == null) {
                    activity.toast(activity.getString(R.string.pair_error_network))
                    return@runOnUiThread
                }
                AlertDialog.Builder(activity)
                    .setTitle(R.string.pair_help_title)
                    .setMessage(activity.getString(R.string.pair_help_text, PairCode.format(help), partner))
                    .setPositiveButton(R.string.pair_close, null)
                    .show()
            }
        }.start()
    }

    private fun confirmSignOut(activity: MainActivity, code: String) {
        AlertDialog.Builder(activity)
            .setTitle(R.string.pair_sign_out_title)
            .setMessage(activity.getString(R.string.pair_sign_out_text, code))
            .setPositiveButton(R.string.pair_sign_out) { _, _ ->
                PairSync.stop()
                LiveSync.reset(activity)
                app.belong.couple.data.SharedRepo(activity).startReal()
                app.belong.couple.sync.Matches.reset(activity)
                ChatRepo(activity).startShared()
                CoupleStore.get(activity).partnerNickname = ""
                Account.get(activity).signOut()
            }
            .setNegativeButton(R.string.settings_cancel, null)
            .show()
    }
}
