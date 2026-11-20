// Root build for the Android app. Versions live in `variables.gradle` (shared with the
// Capacitor-generated scripts); this file only wires the Android Gradle Plugin.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.5.2")
        // AGP 9 has built-in Kotlin; a newer KGP on the root classpath selects the Kotlin
        // compiler version used by built-in Kotlin (Kotlin 2.4 requires AGP 9.1+).
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

apply(from = "variables.gradle")

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
