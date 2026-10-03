package app.belong.couple.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Outline
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import app.belong.couple.R
import app.belong.couple.core.Owner
import app.belong.couple.core.ProfileModel
import app.belong.couple.core.seatKey
import app.belong.couple.data.CoupleStore
import app.belong.couple.data.DayPhotos
import app.belong.couple.data.SharedRepo

/** Round avatars: a person's photo, their emoji on a soft gradient, or the first letter of their name. */
object Avatars {
    /** Soft two-colour gradients for emoji avatars. */
    val GRADIENTS = listOf(
        0xFFFFB4C6.toInt() to 0xFFFFD9A0.toInt(),
        0xFFA8C8FF.toInt() to 0xFFC9B6FF.toInt(),
        0xFFB8E8C8.toInt() to 0xFFA8D8FF.toInt(),
        0xFFFFD2A8.toInt() to 0xFFFF9FB8.toInt(),
        0xFFD7C2FF.toInt() to 0xFFFFC2E2.toInt(),
        0xFFFFE7A3.toInt() to 0xFFB8F0D2.toInt(),
        0xFFC2E7FF.toInt() to 0xFFE9D2FF.toInt(),
        0xFFFFC9C9.toInt() to 0xFFFFEFC2.toInt(),
    )

    val EMOJI = listOf("🌸", "🌷", "🦊", "🐻", "🐱", "🐶", "🐼", "🦋", "🌻", "🍓", "🍒", "🌙", "⭐", "☀️", "🌈", "💜", "🐧", "🐨", "🦄", "🍀")

    fun view(context: Context, owner: Owner, sizeDp: Int): View {
        val repo = SharedRepo(context)
        val store = CoupleStore.get(context)
        val profile = ProfileModel.profile(repo.root(), seatKey(repo.me, mine = owner == Owner.ME))
        val name = if (owner == Owner.ME) store.myName else store.partnerDisplay
        return view(context, profile.photo, profile.emoji, profile.color, name, if (owner == Owner.ME) R.color.her else R.color.him, sizeDp)
    }

    fun view(context: Context, photo: String?, emoji: String?, color: Int, name: String, fallback: Int, sizeDp: Int): View {
        val size = context.dp(sizeDp)
        val frame = FrameLayout(context).apply {
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) = outline.setOval(0, 0, view.width, view.height)
            }
            clipToOutline = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        when {
            photo != null -> {
                frame.background = context.rounded(context.col(R.color.sunk), sizeDp / 2f)
                frame.addView(ImageView(context).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    DayPhotos.load(this, photo, thumb = true)
                }, FrameLayout.LayoutParams(size, size))
            }
            emoji != null -> {
                val (a, b) = GRADIENTS[Math.floorMod(color, GRADIENTS.size)]
                frame.background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(a, b)).apply { shape = GradientDrawable.OVAL }
                frame.addView(context.text(emoji, sizeDp * 0.42f).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(size, size))
            }
            else -> {
                frame.background = context.rounded(context.col(fallback), sizeDp / 2f)
                frame.addView(context.text(name.trim().take(1).uppercase(context.locale()), sizeDp * 0.4f, 800, Color.WHITE).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(size, size))
            }
        }
        frame.layoutParams = android.widget.LinearLayout.LayoutParams(size, size)
        return frame
    }
}
