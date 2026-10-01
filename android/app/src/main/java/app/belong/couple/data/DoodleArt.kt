package app.belong.couple.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF

/** Hand-drawn-looking doodles the example partner sends. */
object DoodleArt {
    const val PAPER = 0xFFFFF8F3.toInt()
    const val KINDS = 3

    fun draw(context: Context, kind: Int, size: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(PAPER)
        val s = size / 100f
        val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3.2f * s
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        when (kind % KINDS) {
            0 -> heart(canvas, pen, s)
            1 -> sun(canvas, pen, s)
            else -> moon(canvas, pen, s)
        }
        return bitmap
    }

    private fun heart(canvas: Canvas, pen: Paint, s: Float) {
        pen.color = 0xFFF07DA1.toInt()
        val p = Path().apply {
            moveTo(50 * s, 78 * s)
            cubicTo(14 * s, 56 * s, 16 * s, 24 * s, 36 * s, 24 * s)
            cubicTo(45 * s, 24 * s, 49 * s, 30 * s, 50 * s, 36 * s)
            cubicTo(52 * s, 29 * s, 57 * s, 23 * s, 66 * s, 24 * s)
            cubicTo(86 * s, 26 * s, 84 * s, 58 * s, 50 * s, 78 * s)
        }
        canvas.drawPath(p, pen)
        pen.color = 0xFF5C9DF2.toInt()
        sparkle(canvas, pen, 80 * s, 18 * s, 6 * s)
        sparkle(canvas, pen, 18 * s, 80 * s, 4.5f * s)
        pen.color = 0xFF2B2233.toInt()
        canvas.drawLine(40 * s, 46 * s, 40 * s, 48 * s, pen)
        canvas.drawLine(60 * s, 46 * s, 60 * s, 48 * s, pen)
        canvas.drawArc(RectF(43 * s, 50 * s, 57 * s, 60 * s), 20f, 140f, false, pen)
    }

    private fun sun(canvas: Canvas, pen: Paint, s: Float) {
        pen.color = 0xFFF5B85C.toInt()
        canvas.drawCircle(50 * s, 50 * s, 18 * s, pen)
        for (i in 0 until 10) {
            val a = Math.toRadians(i * 36.0)
            val x1 = 50 * s + Math.cos(a).toFloat() * 26 * s
            val y1 = 50 * s + Math.sin(a).toFloat() * 26 * s
            val x2 = 50 * s + Math.cos(a).toFloat() * 36 * s
            val y2 = 50 * s + Math.sin(a).toFloat() * 36 * s
            canvas.drawLine(x1, y1, x2, y2, pen)
        }
        pen.color = 0xFF2B2233.toInt()
        canvas.drawLine(43 * s, 46 * s, 43 * s, 48 * s, pen)
        canvas.drawLine(57 * s, 46 * s, 57 * s, 48 * s, pen)
        canvas.drawArc(RectF(42 * s, 48 * s, 58 * s, 58 * s), 20f, 140f, false, pen)
    }

    private fun moon(canvas: Canvas, pen: Paint, s: Float) {
        pen.color = 0xFF5C9DF2.toInt()
        val p = Path().apply {
            moveTo(58 * s, 20 * s)
            cubicTo(30 * s, 22 * s, 24 * s, 62 * s, 46 * s, 76 * s)
            cubicTo(60 * s, 84 * s, 78 * s, 78 * s, 84 * s, 64 * s)
            cubicTo(64 * s, 70 * s, 46 * s, 50 * s, 58 * s, 20 * s)
        }
        canvas.drawPath(p, pen)
        pen.color = 0xFFF07DA1.toInt()
        sparkle(canvas, pen, 76 * s, 30 * s, 6 * s)
        sparkle(canvas, pen, 22 * s, 30 * s, 4 * s)
        pen.color = Color.argb(255, 245, 184, 92)
        sparkle(canvas, pen, 30 * s, 84 * s, 4 * s)
    }

    private fun sparkle(canvas: Canvas, pen: Paint, x: Float, y: Float, r: Float) {
        canvas.drawLine(x - r, y, x + r, y, pen)
        canvas.drawLine(x, y - r, x, y + r, pen)
    }
}
