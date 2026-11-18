// Root build for the Android app. Versions live in `variables.gradle` (shared with the
// Capacitor-generated scripts); this file only wires the Android Gradle Plugin.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.13.2")
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
