plugins {
    id("com.android.application") version "8.7.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

val orbitOut = System.getenv("ORBIT_BUILD_ROOT")
if (!orbitOut.isNullOrBlank()) {
    layout.buildDirectory.set(file("$orbitOut/root"))
    subprojects {
        layout.buildDirectory.set(file("$orbitOut/${project.name}"))
    }
}
