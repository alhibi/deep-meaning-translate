# Capacitor bridge and plugins are reached by reflection.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
}
-keep class today.fluently.app.** { *; }
# Room and DataStore ship their own consumer rules; JSON is part of the platform.
-keep class org.json.** { *; }
-dontwarn org.robolectric.**
