# NP-21: release builds are minified for the first time, so the rules that were
# previously never exercised matter now. Retrofit, OkHttp and Stripe ship their
# own consumer rules; these cover the cases those do not.

# --- kotlinx.serialization -------------------------------------------------
# The compiler plugin generates a Companion.serializer() for each @Serializable
# class. R8 cannot see the reflective lookup that finds it.
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisibleAnnotations, AnnotationDefault

-keepclassmembers class ** {
    *** Companion;
}
-keepclasseswithmembers class ** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.networkpeer.mobile.**$$serializer { *; }
-keepclassmembers class com.networkpeer.mobile.** {
    *** Companion;
}

# The API model classes are deserialized by name from JSON.
-keep class com.networkpeer.mobile.core.model.** { *; }

# --- Socket.IO / Engine.IO -------------------------------------------------
# Reflective event dispatch; also pulls in optional JSR-305 annotations that are
# not on the runtime classpath.
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.*

# --- OkHttp ----------------------------------------------------------------
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- Keep enum names, which are serialized as strings ----------------------
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
