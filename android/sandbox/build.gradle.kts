// Builds a signed debug APK from ../app without the Android Gradle Plugin.
// Needs: aapt2, zipalign, apksigner, zip on PATH and, in $BELONG_SDK (default /opt/android-sandbox),
// android-34.jar (platform API) and r8lib.jar (D8). See ../README.md.
//
//   gradle assembleApk   -> build/outputs/belong-debug.apk
//   gradle test          -> unit tests for app/src/test

import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.0.21"
}

val appPackage = "app.belong.couple"
val appVersionCode = "1"
val appVersionName = "0.1.0"
val minSdk = "26"
val targetSdk = "34"

val sdkDir = file(providers.environmentVariable("BELONG_SDK").getOrElse("/opt/android-sandbox"))
val androidJar = sdkDir.resolve("android-34.jar")
val d8Jar = sdkDir.resolve("r8lib.jar")
val appMain = file("../app/src/main")

val outDir = layout.buildDirectory
val generatedR = outDir.dir("generated/r")
val manifestOut = outDir.file("intermediates/AndroidManifest.xml")
val compiledRes = outDir.file("intermediates/compiled-res.zip")
val resourcesApk = outDir.file("intermediates/resources.apk")
val dexDir = outDir.dir("intermediates/dex")
val apkOut = outDir.file("outputs/belong-debug.apk")

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_11) }
}

sourceSets {
    main {
        kotlin.srcDir(appMain.resolve("java"))
        java.srcDir(generatedR)
    }
    test {
        kotlin.srcDir(file("../app/src/test/java"))
    }
}

// -PapiCheck=26 compiles against an older platform to list every call that needs a version guard.
val compileJar = providers.gradleProperty("apiCheck").map { sdkDir.resolve("android-$it.jar") }.getOrElse(androidJar)

dependencies {
    compileOnly(files(compileJar))
    implementation(kotlin("stdlib"))
    testImplementation("junit:junit:4.13.2")
    testCompileOnly(files(androidJar))
}

// AGP builds take the package from `namespace`; aapt2 needs it in the manifest.
val prepareManifest by tasks.registering {
    val source = appMain.resolve("AndroidManifest.xml")
    inputs.file(source)
    outputs.file(manifestOut)
    doLast {
        val text = source.readText()
            .replaceFirst("<manifest ", "<manifest package=\"$appPackage\" ")
            .replace("\${applicationId}", appPackage)
        manifestOut.get().asFile.apply { parentFile.mkdirs() }.writeText(text)
    }
}

val compileResources by tasks.registering(Exec::class) {
    inputs.dir(appMain.resolve("res"))
    outputs.file(compiledRes)
    doFirst { compiledRes.get().asFile.parentFile.mkdirs() }
    commandLine("aapt2", "compile", "--dir", appMain.resolve("res").path, "-o", compiledRes.get().asFile.path)
}

val linkResources by tasks.registering(Exec::class) {
    dependsOn(prepareManifest, compileResources)
    inputs.files(compiledRes, manifestOut, androidJar)
    inputs.dir(appMain.resolve("assets"))
    outputs.file(resourcesApk)
    outputs.dir(generatedR)
    commandLine(
        "aapt2", "link",
        "-o", resourcesApk.get().asFile.path,
        "-I", androidJar.path,
        "--manifest", manifestOut.get().asFile.path,
        "--java", generatedR.get().asFile.path,
        "-A", appMain.resolve("assets").path,
        "--min-sdk-version", minSdk,
        "--target-sdk-version", targetSdk,
        "--version-code", appVersionCode,
        "--version-name", appVersionName,
        compiledRes.get().asFile.path,
    )
}

tasks.compileKotlin { dependsOn(linkResources) }
tasks.compileJava { dependsOn(linkResources) }

val dex by tasks.registering(JavaExec::class) {
    dependsOn(tasks.jar)
    val inputsJars = files(tasks.jar.flatMap { it.archiveFile }) + configurations.runtimeClasspath.get()
    inputs.files(inputsJars)
    outputs.dir(dexDir)
    classpath = files(d8Jar)
    mainClass.set("com.android.tools.r8.D8")
    doFirst {
        dexDir.get().asFile.apply { deleteRecursively(); mkdirs() }
        args(
            listOf("--release", "--min-api", minSdk, "--lib", androidJar.path, "--output", dexDir.get().asFile.path) +
                inputsJars.files.map { it.path },
        )
    }
}

val debugKeystore = outDir.file("debug.keystore")

val createKeystore by tasks.registering(Exec::class) {
    outputs.file(debugKeystore)
    onlyIf { !debugKeystore.get().asFile.exists() }
    commandLine(
        "keytool", "-genkeypair", "-keystore", debugKeystore.get().asFile.path,
        "-storepass", "android", "-keypass", "android", "-alias", "belongdebug",
        "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
        "-dname", "CN=Belong Debug,O=Belong,C=UA",
    )
}

val assembleApk by tasks.registering {
    dependsOn(linkResources, dex, createKeystore)
    inputs.file(resourcesApk)
    inputs.dir(dexDir)
    outputs.file(apkOut)
    doLast {
        val work = outDir.dir("intermediates/apk").get().asFile.apply { deleteRecursively(); mkdirs() }
        val unaligned = work.resolve("unaligned.apk")
        resourcesApk.get().asFile.copyTo(unaligned, overwrite = true)
        val dexFiles = dexDir.get().asFile.listFiles { f -> f.name.endsWith(".dex") }!!.map { it.name }.sorted()
        exec { workingDir = dexDir.get().asFile; commandLine(listOf("zip", "-q", unaligned.path) + dexFiles) }
        val aligned = work.resolve("aligned.apk")
        exec { commandLine("zipalign", "-p", "-f", "4", unaligned.path, aligned.path) }
        val apk = apkOut.get().asFile.apply { parentFile.mkdirs() }
        exec {
            commandLine(
                "apksigner", "sign", "--ks", debugKeystore.get().asFile.path,
                "--ks-pass", "pass:android", "--key-pass", "pass:android",
                "--out", apk.path, aligned.path,
            )
        }
        exec { commandLine("apksigner", "verify", "--print-certs", apk.path) }
        println("APK: ${apk.path} (${apk.length() / 1024} KB)")
    }
}
