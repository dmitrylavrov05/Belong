package app.belong.couple.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.format.DateFormat
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import app.belong.couple.R
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Manrope at any weight from the bundled variable font. */
object Fonts {
    private val cache = HashMap<Int, Typeface>()

    fun get(context: Context, weight: Int): Typeface = cache.getOrPut(weight) {
        try {
            Typeface.Builder(context.assets, "fonts/Manrope.ttf")
                .setFontVariationSettings("'wght' $weight")
                .build()
        } catch (e: RuntimeException) {
            Typeface.create(Typeface.SANS_SERIF, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
        }
    }
}

const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

fun Context.dp(value: Float): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics).toInt()

fun Context.dp(value: Int): Int = dp(value.toFloat())

fun Context.col(id: Int): Int = getColor(id)

fun Context.locale(): Locale = resources.configuration.locales[0]

fun Context.language(): String = locale().language

fun Context.toast(message: CharSequence) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

fun Context.formatLongDate(date: LocalDate): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale()).format(date)

/** "Thursday, October 1" / "четвер, 1 жовтня" with the first letter capitalised. */
fun Context.formatDayHeader(date: LocalDate): String {
    val pattern = DateFormat.getBestDateTimePattern(locale(), "EEEEdMMMM")
    val text = DateTimeFormatter.ofPattern(pattern, locale()).format(date)
    return text.replaceFirstChar { it.titlecase(locale()) }
}

fun Context.text(
    value: CharSequence,
    size: Float = 16f,
    weight: Int = 400,
    color: Int = col(R.color.ink),
): TextView = TextView(this).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    typeface = Fonts.get(context, weight)
    setTextColor(color)
    setLineSpacing(0f, 1.12f)
}

fun Context.rounded(color: Int, radiusDp: Float, strokeColor: Int? = null, strokeDp: Float = 1f): GradientDrawable =
    GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
        if (strokeColor != null) setStroke(dp(strokeDp), strokeColor)
    }

fun Context.gradient(radiusDp: Float, start: Int, end: Int): GradientDrawable =
    GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(start, end)).apply {
        cornerRadius = dp(radiusDp).toFloat()
    }

fun Context.ripple(content: Drawable, radiusDp: Float): Drawable =
    RippleDrawable(ColorStateList.valueOf(0x33000000), content, rounded(Color.BLACK, radiusDp))

private fun Context.gap(sizeDp: Int): Drawable = GradientDrawable().apply {
    setSize(dp(sizeDp), dp(sizeDp))
    setColor(Color.TRANSPARENT)
}

fun Context.column(spacingDp: Int = 0): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    if (spacingDp > 0) {
        dividerDrawable = gap(spacingDp)
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    }
}

fun Context.row(spacingDp: Int = 0): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    if (spacingDp > 0) {
        dividerDrawable = gap(spacingDp)
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    }
}

fun Context.card(paddingDp: Int = 18, spacingDp: Int = 12, background: Drawable? = null): LinearLayout =
    column(spacingDp).apply {
        this.background = background ?: rounded(col(R.color.surface), 24f)
        val p = dp(paddingDp)
        setPadding(p, p, p, p)
        softShadow()
    }

fun Context.icon(res: Int, color: Int, sizeDp: Int = 20): Drawable =
    getDrawable(res)!!.mutate().apply {
        setTint(color)
        setBounds(0, 0, dp(sizeDp), dp(sizeDp))
    }

private fun Context.button(label: String, iconRes: Int?, textColor: Int, background: Drawable, onClick: (View) -> Unit): TextView =
    text(label, 16f, 700, textColor).apply {
        gravity = Gravity.CENTER
        minHeight = dp(52)
        setPadding(dp(18), dp(6), dp(18), dp(6))
        this.background = ripple(background, 16f)
        isClickable = true
        isFocusable = true
        if (iconRes != null) {
            setCompoundDrawablesRelative(icon(iconRes, textColor), null, null, null)
            compoundDrawablePadding = dp(8)
        }
        setOnClickListener(onClick)
        pressable()
    }

/**
 * The pair gradient with white text and a blue glow. The gradient is a shade deeper than the
 * design's #F07DA1 → #5C9DF2 so the white label stays readable (contrast above 4.5:1).
 */
fun Context.primaryButton(label: String, iconRes: Int? = null, onClick: (View) -> Unit): TextView =
    button(label, iconRes, Color.WHITE, gradient(16f, col(R.color.us_start), col(R.color.us_end)), onClick).apply {
        elevation = dp(6).toFloat()
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            outlineSpotShadowColor = col(R.color.him)
            outlineAmbientShadowColor = col(R.color.him)
        }
    }

/** White with the card shadow, as in the design. */
fun Context.secondaryButton(label: String, iconRes: Int? = null, onClick: (View) -> Unit): TextView =
    button(label, iconRes, col(R.color.ink), rounded(col(R.color.surface), 16f), onClick).apply { softShadow(3f) }

/** A borderless button for quieter actions ("Sign in", "Skip"). */
fun Context.textButton(label: String, onClick: (View) -> Unit): TextView =
    button(label, null, col(R.color.ink), rounded(col(R.color.bg), 12f), onClick).apply {
        minHeight = dp(44)
        maxLines = 1
        setPadding(dp(8), 0, dp(8), 0)
        setAutoSizeTextTypeUniformWithConfiguration(12, 16, 1, android.util.TypedValue.COMPLEX_UNIT_SP)
    }

fun Context.tintButton(label: String, iconRes: Int?, bg: Int, fg: Int, onClick: (View) -> Unit): TextView =
    button(label, iconRes, fg, rounded(bg, 16f), onClick)

/** A pill that can be selected, used for filters and segmented choices. */
fun Context.chip(label: String, selected: Boolean, onClick: (View) -> Unit): TextView =
    text(label, 14f, if (selected) 700 else 600, if (selected) Color.WHITE else col(R.color.ink2)).apply {
        gravity = Gravity.CENTER
        minHeight = dp(40)
        minWidth = dp(48)
        setPadding(dp(14), 0, dp(14), 0)
        background = ripple(
            if (selected) rounded(col(R.color.ink), 999f) else rounded(col(R.color.surface), 999f, col(R.color.line)),
            999f,
        )
        isSelected = selected
        setOnClickListener(onClick)
    }

fun View.lp(
    width: Int = MATCH,
    height: Int = WRAP,
    weight: Float = 0f,
    top: Int = 0,
    bottom: Int = 0,
): View {
    layoutParams = LinearLayout.LayoutParams(width, height, weight).apply {
        topMargin = context.dp(top)
        bottomMargin = context.dp(bottom)
    }
    return this
}

/** A row of five segments, filled up to [value], like the energy battery in the design. */
fun Context.meter(value: Int, color: Int, heightDp: Int = 8): LinearLayout = row(4).apply {
    for (i in 1..5) {
        addView(View(this@meter).apply {
            background = rounded(if (i <= value) color else col(R.color.sunk), 4f)
        }, LinearLayout.LayoutParams(0, dp(heightDp), 1f))
    }
}

/** A circle with the first letter of a name, coloured by owner. */
fun Context.avatar(name: String, color: Int, sizeDp: Int = 44): TextView =
    text(name.trim().take(1).uppercase(locale()), sizeDp * 0.4f, 800, Color.WHITE).apply {
        gravity = Gravity.CENTER
        background = rounded(color, sizeDp / 2f)
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
