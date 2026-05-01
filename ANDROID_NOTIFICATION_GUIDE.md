# Android Notification Integration Guide

This guide explains how to integrate Android notifications for the Scrapbook Widget app using:

- Firebase Cloud Messaging (FCM) for background and terminated app notifications
- WebSocket realtime events for foreground updates while the app is open

This backend now supports these notification types:

- `photo_created`: a new photo was added to a group
- `photo_reacted`: someone reacted to a photo
- `message_created`: a new chat message was sent

It also supports these WebSocket realtime events for foreground sync:

- `message.created`
- `message.seen`
- `item.created`
- `scrapbook.updated`
- `reaction.created`
- `reaction.removed`

## 1. Prerequisites

Android app requirements:

- Firebase project connected to the Android app
- `google-services.json` added to the Android app module
- Firebase Auth already working for login
- Firebase Cloud Messaging enabled in the Firebase project

Backend requirements:

- Firebase Admin service account configured
- `firebase-admin` already installed
- Notification token endpoints available:
  - `POST /api/v1/users/me/device-token`
  - `DELETE /api/v1/users/me/device-token`

## 2. Add Firebase Messaging to Android

In project-level `build.gradle` or `settings.gradle`, make sure Google Services is configured.

In app-level `build.gradle`:

```gradle
plugins {
    id 'com.android.application'
    id 'com.google.gms.google-services'
}

dependencies {
    implementation platform("com.google.firebase:firebase-bom:34.1.0")
    implementation "com.google.firebase:firebase-messaging"
}
```

## 3. Add Android Manifest Entries

Add notification permission for Android 13+:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Register a `FirebaseMessagingService`:

```xml
<application ...>
    <service
        android:name=".notifications.AppFirebaseMessagingService"
        android:exported="false">
        <intent-filter>
            <action android:name="com.google.firebase.MESSAGING_EVENT" />
        </intent-filter>
    </service>
</application>
```

## 4. Request Notification Permission

For Android 13 and above, request `POST_NOTIFICATIONS` at runtime.

Example:

```java
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                1001
        );
    }
}
```

## 5. Create Notification Channel

The backend sends Android notifications using channel id:

- `scrapbook_updates`

Create that channel once when the app starts:

```java
public final class NotificationChannels {
    public static final String SCRAPBOOK_UPDATES = "scrapbook_updates";

    private NotificationChannels() {
    }

    public static void create(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                SCRAPBOOK_UPDATES,
                "Scrapbook Updates",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Messages, photo updates, and reactions");

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }
}
```

Call `NotificationChannels.create(this)` from `Application` or the first activity.

## 6. Create Firebase Messaging Service

Example service:

```java
package com.example.scrapbook.notifications;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.example.scrapbook.MainActivity;
import com.example.scrapbook.R;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class AppFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        DeviceTokenRepository.enqueueRegister(getApplicationContext(), token);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        String type = value(data, "type");
        String title = remoteMessage.getNotification() != null
                ? value(remoteMessage.getNotification().getTitle())
                : defaultTitle(type);
        String body = remoteMessage.getNotification() != null
                ? value(remoteMessage.getNotification().getBody())
                : defaultBody(type);

        Intent intent = buildTargetIntent(this, type, data);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                (int) System.currentTimeMillis(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, NotificationChannels.SCRAPBOOK_UPDATES)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(this).notify((int) System.currentTimeMillis(), builder.build());
    }

    private static Intent buildTargetIntent(Context context, String type, Map<String, String> data) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        intent.putExtra("notification_type", type);
        intent.putExtra("groupId", value(data, "groupId"));
        intent.putExtra("pageId", value(data, "pageId"));
        intent.putExtra("itemId", value(data, "itemId"));
        intent.putExtra("messageId", value(data, "messageId"));
        intent.putExtra("senderId", value(data, "senderId"));
        intent.putExtra("reactorId", value(data, "reactorId"));
        intent.putExtra("reactionType", value(data, "reactionType"));

        return intent;
    }

    private static String defaultTitle(String type) {
        switch (type) {
            case "message_created":
                return "New message";
            case "photo_created":
                return "New photo";
            case "photo_reacted":
                return "Photo reaction";
            default:
                return "Scrapbook update";
        }
    }

    private static String defaultBody(String type) {
        switch (type) {
            case "message_created":
                return "You received a new message";
            case "photo_created":
                return "A new photo was added";
            case "photo_reacted":
                return "Someone reacted to a photo";
            default:
                return "Open the app to view details";
        }
    }

    private static String value(Map<String, String> data, String key) {
        return data != null && data.containsKey(key) ? value(data.get(key)) : "";
    }

    private static String value(String text) {
        return text == null ? "" : text;
    }
}
```

## 7. Register FCM Token with Backend

After login succeeds, get the current FCM token and send it to the backend.

Example:

```java
FirebaseMessaging.getInstance().getToken()
        .addOnSuccessListener(token -> {
            DeviceTokenRepository.registerNow(context, token);
        });
```

Send:

```http
POST /api/v1/users/me/device-token
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

```json
{
  "token": "<FCM_TOKEN>",
  "platform": "android",
  "deviceId": "android-device-001",
  "deviceName": "Pixel 7"
}
```

Recommended behavior:

- register token after login
- register again when `onNewToken()` is called
- optionally register on app startup if user is already signed in

## 8. Toggle Notification Preferences In App

This backend supports per-device notification preferences.

Available fields:

- `enabled`: global on/off
- `messageEnabled`: allow chat message notifications
- `photoEnabled`: allow new photo notifications
- `reactionEnabled`: allow photo reaction notifications

Update endpoint:

```http
PATCH /api/v1/users/me/device-token/settings
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

Example request:

```json
{
  "deviceId": "android-device-001",
  "enabled": true,
  "messageEnabled": true,
  "photoEnabled": true,
  "reactionEnabled": false
}
```

You can also identify the target device by `token` instead of `deviceId`:

```json
{
  "token": "<FCM_TOKEN>",
  "enabled": false
}
```

Recommended UI behavior:

- One main switch for all notifications -> maps to `enabled`
- Optional sub-switches for:
  - messages -> `messageEnabled`
  - photos -> `photoEnabled`
  - reactions -> `reactionEnabled`

Important notes:

- This only controls backend push delivery.
- Android system notification permission and system-level app notification settings still apply.
- If a token document does not have these fields yet, backend defaults them to `true`.

## 8A. Handle Android System Notification On/Off

Your Android app should manage two separate layers:

- backend delivery settings via `/api/v1/users/me/device-token/settings`
- Android system notification availability on the device

These are different:

- If backend `enabled=false`, the backend will not send push notifications.
- If backend `enabled=true` but Android notifications are blocked, the backend may still send push, but Android will not show it.

Recommended Android behavior:

- show the in-app notification switches for backend preferences
- also detect whether Android notifications are currently allowed for the app
- if Android notifications are disabled, show a warning or helper text
- when the user wants to enable notifications, open Android app notification settings

Check whether notifications are enabled:

```java
boolean areNotificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
```

Suggested UX:

- Main notification switch in app:
  - if Android notifications are blocked, do not silently treat this as fully enabled
  - show a message like: "Notifications are turned off in Android settings"
  - provide a button to open system settings
- Category switches:
  - `messageEnabled`
  - `photoEnabled`
  - `reactionEnabled`
  - these should update backend preferences only

Open Android notification settings for this app:

```java
Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
context.startActivity(intent);
```

Useful import:

```java
import android.provider.Settings;
```

Recommended app logic:

- when app starts, check `NotificationManagerCompat.areNotificationsEnabled()`
- when user opens notification settings screen, check again
- if Android notifications are off:
  - show that system notifications are disabled
  - keep backend switches visible if you want to preserve backend preferences
  - encourage the user to enable Android notifications in system settings
- if user turns off the main in-app switch, call backend `enabled=false`
- if user turns on the main in-app switch, call backend `enabled=true`
- if user disables notifications at Android system level, do not assume backend preferences changed

Important:

- Android does not let apps directly enable notifications for the user.
- Your app can only request permission on Android 13+ and deep link the user to system settings.
- For Android 13+, permission granted does not guarantee the user has not later disabled app notifications in system settings, so check both when needed.

## 9. Remove FCM Token on Logout

When the user signs out, unregister the token:

```http
DELETE /api/v1/users/me/device-token?token=<FCM_TOKEN>
Authorization: Bearer <firebase_id_token>
```

If your HTTP client supports `DELETE` with JSON body, this also works:

```json
{
  "token": "<FCM_TOKEN>"
}
```

## 10. Suggested Token Repository

Example repository shape:

```java
public final class DeviceTokenRepository {
    private DeviceTokenRepository() {
    }

    public static void enqueueRegister(Context context, String token) {
        registerNow(context, token);
    }

    public static void registerNow(Context context, String token) {
        String firebaseIdToken = SessionManager.getFirebaseIdToken();
        if (firebaseIdToken == null || firebaseIdToken.isEmpty() || token == null || token.isEmpty()) {
            return;
        }

        DeviceTokenRequest body = new DeviceTokenRequest(
                token,
                "android",
                DeviceInfo.getDeviceId(context),
                DeviceInfo.getDeviceName()
        );

        ApiClient.usersApi().registerDeviceToken("Bearer " + firebaseIdToken, body);
    }

    public static void unregister(Context context, String token) {
        String firebaseIdToken = SessionManager.getFirebaseIdToken();
        if (firebaseIdToken == null || firebaseIdToken.isEmpty() || token == null || token.isEmpty()) {
            return;
        }

        ApiClient.usersApi().deleteDeviceToken("Bearer " + firebaseIdToken, token);
    }
}
```

## 11. Backend Notification Payloads

### `message_created`

```json
{
  "type": "message_created",
  "groupId": "group123",
  "messageId": "message456",
  "senderId": "user789"
}
```

Open behavior:

- open the target group chat screen
- optionally highlight or scroll to `messageId`

### `photo_created`

```json
{
  "type": "photo_created",
  "groupId": "group123",
  "pageId": "page456",
  "itemId": "item789",
  "senderId": "user111"
}
```

Open behavior:

- open the target group scrapbook page
- optionally focus the created photo item

### `photo_reacted`

```json
{
  "type": "photo_reacted",
  "groupId": "group123",
  "pageId": "page456",
  "itemId": "item789",
  "ownerId": "user111",
  "reactorId": "user222",
  "reactionType": "heart"
}
```

Open behavior:

- open the target scrapbook page
- optionally open the photo detail or reactions bottom sheet

## 12. Foreground vs Background Behavior

Recommended strategy:

- If the app is open and already viewing the same group, use WebSocket updates to refresh UI immediately.
- If the app is backgrounded or closed, rely on FCM notification display.

Do not rely only on FCM for in-app refresh.

For this project:

- chat and scrapbook realtime updates come from WebSocket
- FCM is for system notification delivery

## 13. WebSocket Events to Handle in Foreground

The Android client should keep the existing WebSocket connection and react to:

- `message.created`
- `message.seen`
- `item.created`
- `scrapbook.updated`
- `reaction.created`
- `reaction.removed`

Reaction event payload example:

```json
{
  "event": "reaction.created",
  "data": {
    "itemId": "item789",
    "scrapbookPageId": "page456",
    "groupId": "group123",
    "userId": "user222",
    "type": "heart",
    "action": "created"
  }
}
```

Recommended foreground handling:

- `message.created`: append or upsert message
- `message.seen`: update seen state
- `item.created`: refresh or upsert the new photo
- `scrapbook.updated`: debounce and refetch scrapbook page data
- `reaction.created`: upsert reaction count/state in the active item
- `reaction.removed`: remove or decrement reaction state in the active item

## 14. Navigation Handling

When the app is opened from a notification:

1. Read extras from `Intent`
2. Check `notification_type`
3. Navigate to the correct screen

Suggested mapping:

- `message_created` -> chat screen for `groupId`
- `photo_created` -> scrapbook page screen for `groupId` + `pageId`
- `photo_reacted` -> scrapbook page or photo detail for `groupId` + `pageId` + `itemId`

If using a single-activity architecture:

- let `MainActivity` receive the intent
- pass extras to the current nav host or fragment container

## 15. Common Pitfalls

- Missing `POST_NOTIFICATIONS` permission on Android 13+
- Notification channel id not matching backend channel id `scrapbook_updates`
- Not sending FCM token to backend after login
- Not updating backend when `onNewToken()` fires
- Not syncing in-app switches to `/me/device-token/settings`
- Using only WebSocket and expecting background push to work
- Using only FCM and expecting active screens to refresh automatically

## 16. Quick Checklist

- Add `google-services.json`
- Add Firebase Messaging dependency
- Add `FirebaseMessagingService`
- Request `POST_NOTIFICATIONS`
- Detect whether Android app notifications are currently enabled
- Add button/deep link to Android app notification settings
- Create `scrapbook_updates` notification channel
- Register token after login
- Re-register token in `onNewToken()`
- Sync notification switches to `/me/device-token/settings`
- Unregister token on logout
- Handle `message_created`, `photo_created`, `photo_reacted`
- Keep WebSocket for foreground realtime updates
