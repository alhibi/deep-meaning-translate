import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android") version "2.1.21"
    id("com.google.devtools.ksp") version "2.1.21-2.0.1"
}

/**
 * Release signing comes from the environment, never from the repository:
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 * Without them the release build is signed with the local debug key so the APK stays
 * installable; the build log states which key was used. That build is NOT a Play release.
 */
val releaseStore = System.getenv("ANDROID_KEYSTORE_PATH")
val releaseReady = releaseStore != null && file(releaseStore).exists()

android {
    namespace = "today.fluently.app"
    compileSdk = (rootProject.extra["compileSdkVersion"] as Int)

    defaultConfig {
        applicationId = "today.fluently.app"
        minSdk = (rootProject.extra["minSdkVersion"] as Int)
        targetSdk = (rootProject.extra["targetSdkVersion"] as Int)
        versionCode = 3
        versionName = "1.0.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // The translator is Arabic-first: keep the app usable in RTL and German.
        resourceConfigurations += listOf("en", "ar", "de")
        aaptOptions {
            ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
        }
        ksp {
            arg("room.schemaLocation", "$projectDir/schemas")
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseReady) {
                signingConfig = signingConfigs.create("release") {
                    storeFile = file(releaseStore!!)
                    storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                    keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                    keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                }
            } else {
                // Installable, but with the debug key. Documented in docs/android/build-and-release.md.
                signingConfig = signingConfigs.getByName("debug")
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    sourceSets {
        getByName("androidTest").assets.srcDir("$projectDir/schemas")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

repositories {
    flatDir {
        dirs("../capacitor-cordova-android-plugins/src/main/libs", "libs")
    }
}

dependencies {
    implementation(fileTree(mapOf("include" to listOf("*.jar"), "dir" to "libs")))
    implementation("androidx.appcompat:appcompat:${rootProject.extra["androidxAppCompatVersion"]}")
    implementation("androidx.coordinatorlayout:coordinatorlayout:${rootProject.extra["androidxCoordinatorLayoutVersion"]}")
    implementation("androidx.core:core-splashscreen:${rootProject.extra["coreSplashScreenVersion"]}")
    implementation("androidx.core:core-ktx:${rootProject.extra["androidxCoreVersion"]}")
    implementation("androidx.activity:activity-ktx:${rootProject.extra["androidxActivityVersion"]}")
    implementation(project(":capacitor-android"))
    implementation(project(":capacitor-cordova-android-plugins"))

    // Durable, queryable records. Settings use Preferences DataStore (below).
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    ksp("androidx.room:room-compiler:2.7.2")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")

    testImplementation("junit:junit:${rootProject.extra["junitVersion"]}")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("androidx.room:room-testing:2.7.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.google.truth:truth:1.4.4")

    androidTestImplementation("androidx.test.ext:junit:${rootProject.extra["androidxJunitVersion"]}")
    androidTestImplementation("androidx.test.espresso:espresso-core:${rootProject.extra["androidxEspressoCoreVersion"]}")
    androidTestImplementation("androidx.room:room-testing:2.7.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
}

// Capacitor's generated plugin wiring (Groovy). Applied after our dependencies.
apply(from = "capacitor.build.gradle")
