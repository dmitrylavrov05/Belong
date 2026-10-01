package app.belong.couple.share

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/** Serves story images from the cache to the app the person shares them with. */
class StoryProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    private fun fileFor(uri: Uri): File {
        val name = uri.lastPathSegment ?: throw FileNotFoundException(uri.toString())
        if (!NAME.matches(name)) throw FileNotFoundException(uri.toString())
        val file = File(dir(context!!), name)
        if (!file.exists()) throw FileNotFoundException(uri.toString())
        return file
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
        ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY)

    override fun getType(uri: Uri): String = "image/png"

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
        val file = fileFor(uri)
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(columns, 1).apply {
            addRow(columns.map { if (it == OpenableColumns.SIZE) file.length() else file.name })
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?): Int = 0

    companion object {
        private val NAME = Regex("[a-z0-9_-]+\\.png")

        fun dir(context: Context): File = File(context.cacheDir, "stories").apply { mkdirs() }

        fun uriFor(context: Context, name: String): Uri = Uri.parse("content://${context.packageName}.stories/$name")
    }
}
