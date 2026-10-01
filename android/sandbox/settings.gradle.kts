// Builds the Belong APK without the Android Gradle Plugin (see ../README.md).
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositories { mavenCentral() }
}
rootProject.name = "belong-sandbox"
