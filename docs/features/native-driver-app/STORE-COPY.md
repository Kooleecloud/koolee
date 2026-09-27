# Koolee Driver — store copy

> The text for every store form the driver app needs, ready to paste, and the
> answers behind each privacy form. The app is **for Koolee staff only**:
> accounts are created by an admin invite, there is no sign-up, and nobody
> outside the team can use it. Apple distributes it as an **Unlisted** app;
> on Google Play it goes out on a testing track (see §3.1).
>
> Kept beside [CHECKLIST.md](CHECKLIST.md), which says when each form is due.
> The permission strings quoted here are the ones in `apps/driver/app.json`;
> if you change one there, change it here.

---

## 1. Listing basics (both stores)

| Field               | Value                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| App name            | Koolee Driver                                                                                                                                    |
| Subtitle (iOS)      | For Koolee drivers and agents                                                                                                                    |
| Short description   | The Koolee staff app: your shift, your stops, seals and hand-offs.                                                                               |
| Bundle id / package | `cloud.koolee.driver`                                                                                                                            |
| Category            | Business (iOS) · Business (Play)                                                                                                                 |
| Age rating          | 4+ (iOS) · Everyone (Play) — no user-generated content, no purchases, no ads                                                                     |
| Price               | Free, no in-app purchases                                                                                                                        |
| Support URL         | `https://koolee.cloud`                                                                                                                           |
| Privacy policy URL  | `https://koolee.cloud/privacy` — **needs the staff section in §5 first**; the current page describes customers only, and both stores check this. |

**Full description** (both stores):

```text
Koolee Driver is the app Koolee's own drivers and door agents use on shift. It is not for the public: every account is created by a Koolee administrator, and the app cannot be used without one.

On shift, the app shows the day's stops in order, with each customer's window and doorstep. At the door it walks the visit step by step — confirm the booking agreement, check the traveller's passport, photograph and seal every bag — and on the road it checks every seal before a bag is loaded and records the hand-off at the airline's bag drop. Each step is timestamped into the booking's chain of custody.

While a driver is on shift, the app shares their location with Koolee dispatch and with the customers they are collecting from, including when the phone is locked, so a customer can see their driver coming. Location sharing stops when the shift ends.
```

---

## 2. Apple

### 2.1 Unlisted App Distribution request

Form: https://developer.apple.com/contact/request/unlisted-app/ (after A1).

**App name:** Koolee Driver
**Bundle ID:** `cloud.koolee.driver`

**Describe your app and who it is for:**

```text
Koolee Driver is an internal operations app for Koolee's field staff: the drivers and door agents who collect travellers' luggage from their homes and deliver it to the airline's bag drop. It is used only by people Koolee has hired. Accounts are created by a Koolee administrator through an invitation; there is no public sign-up, and the app does nothing for anyone without an invited account.

We are asking for Unlisted distribution because the app has no audience outside our staff, who install it on their own phones from a direct link we give them when they join. Staff do not use managed devices, so Apple Business Manager custom-app distribution does not fit.
```

**Why can't the app be distributed with TestFlight or Apple Business Manager?**

```text
It is a production tool used every working day, so TestFlight's 90-day builds and beta framing don't fit. Our staff use their personal phones, which are not enrolled in Apple Business Manager or any MDM.
```

### 2.2 App Review notes (App Store Connect → App Review Information)

**Sign-in required:** yes. Create a reviewer account in the admin console
(Staff → Invite, role Agent, "cleared to drive" on) and put its email and
password here. Put a test booking on its schedule, so there is something to open.

```text
Koolee Driver is an internal app for Koolee's field staff and is distributed Unlisted. Every account is created by a Koolee administrator; the account below was created for App Review.

HOW TO SEE THE APP WORK
1. Sign in with the account below.
2. On Today, pick a truck and tap "Start shift". The app asks for location permission. Choose "Allow While Using App", then accept the follow-up prompt to change to "Always Allow".
3. The shift card says "Location: Live". Lock the phone or switch apps: location keeps being sent while the shift is open. That is the feature the background location mode exists for.
4. Tap "End shift". Location tracking stops, and the app no longer uses location in the background.

WHY THE APP USES LOCATION IN THE BACKGROUND
While a driver is on shift, the app sends their position to Koolee every few seconds, including when the phone is locked or in a pocket. Koolee dispatch uses it to assign and monitor pickups. The customer whose luggage the driver is collecting sees the driver approaching on their trip page. Drivers keep their phones locked while driving, so without background location the customer's map would freeze the moment the phone locks. Location is used only between "Start shift" and "End shift", never off shift, and iOS shows the blue location indicator throughout.

CAMERA
The camera is used to photograph the traveller's passport page and each bag, and to scan the barcode on each tamper-evident seal. Nothing is taken from the photo library.

NOTIFICATIONS
Drivers are notified when a visit or pickup is assigned to them, and if Koolee stops receiving their location during a shift.
```

### 2.3 App Privacy (App Store Connect → App Privacy)

Matches `ios.privacyManifests` in `app.json`. Tracking: **No** for everything.

| Data type                                  | Collected | Linked to the person | Used for          |
| ------------------------------------------ | --------- | -------------------- | ----------------- |
| Precise location                           | Yes       | Yes                  | App functionality |
| Name                                       | Yes       | Yes                  | App functionality |
| Email address                              | Yes       | Yes                  | App functionality |
| User ID                                    | Yes       | Yes                  | App functionality |
| Photos or videos (passport and bag photos) | Yes       | Yes                  | App functionality |
| Device ID (the push notification token)    | Yes       | Yes                  | App functionality |
| Crash data                                 | Yes       | No                   | App functionality |
| Performance data                           | Yes       | No                   | App functionality |

The passport and bag photos are of the CUSTOMER's documents and luggage,
taken by the driver as custody evidence. The form asks about data the app
collects, not whose it is, so they count here.

### 2.4 Permission strings (already in `app.json`, for reference)

- **Location, Always:** "Koolee shares your position with dispatch and the customers you are collecting from while you are on shift, including when the app is in the background or the phone is locked."
- **Location, While Using:** "Koolee uses your location to show how far you are from your next pickup."
- **Camera:** "Koolee uses the camera to photograph passports and bags and to scan seal tags."

---

## 3. Google Play

### 3.1 How it ships

Play has no "Unlisted" setting for a public account. Pick one:

- **Internal testing** (recommended to start): up to 100 testers by email, and no review wait after the first. Drivers opt in once through a link, then update from the Play Store like any app.
- **Closed testing:** unlimited testers through an email list or Google Group, with a short review per release. Use it past 100 drivers.
- **Production:** a public listing is harmless (accounts are invite-only), but it means the full review, the listing requirements and the public page.

Whichever track you choose, the declarations below are required before the first release.

### 3.2 Location permissions declaration (App content → Sensitive permissions → Location)

The app requests `ACCESS_BACKGROUND_LOCATION`, so Play needs this declaration
**and a short video** (30 s is plenty, uploaded unlisted to YouTube). The video
shows: the prominent disclosure (the shift card and the system prompt), then
starting a shift and locking the phone while the location keeps updating (the
persistent "Koolee is sharing your location" notification is visible).

**Which feature uses location in the background?**

```text
Live driver location during a shift. While a Koolee driver is on shift, the app sends their position to Koolee every few seconds so dispatch can assign and monitor pickups, and so the customer whose luggage is being collected can see the driver approaching.
```

**Why does the feature need location in the background?**

```text
Drivers keep the phone locked or in a holder while driving to the customer. Without background access, location stops the moment the screen locks, and the customer's map and dispatch's view freeze for the whole drive. Background location is used only between "Start shift" and "End shift". A persistent foreground-service notification is shown for the whole time, and tracking stops when the shift ends.
```

**Prominent disclosure:** before any system prompt, the shift card on Today
says "Koolee shares your location with dispatch and your customers for the
whole shift, even when the app is closed or the phone is locked, so they can
watch you arrive. You'll be asked when you clock on." Tapping "Start shift" is
the consent that leads to the prompt. The foreground notification ("Koolee is
sharing your location" / "Customers and dispatch can see you while you are on
shift.") stays up for the whole shift.

### 3.3 Foreground service declaration (App content → Foreground service permissions)

Type: **Location** (`FOREGROUND_SERVICE_LOCATION`).

```text
The location foreground service runs only while the driver is on shift, from "Start shift" until "End shift", to keep sending the driver's position to Koolee while the phone is locked. It is started by the driver tapping "Start shift", shows a persistent notification the whole time, and is stopped by "End shift".
```

Use the same video as §3.2.

### 3.4 Data safety (App content → Data safety)

- Data collected: **yes**. Shared with third parties: **no** (processors acting for Koolee are not "sharing" under Play's definition). Encrypted in transit: **yes**. Users can request deletion: **yes** (by contacting Koolee; accounts are created and closed by an admin).

| Category → type                                    | Collected        | Optional?                | Purpose                               |
| -------------------------------------------------- | ---------------- | ------------------------ | ------------------------------------- |
| Location → Precise location                        | Yes              | Required while on shift  | App functionality                     |
| Personal info → Name                               | Yes              | Required                 | App functionality, Account management |
| Personal info → Email address                      | Yes              | Required                 | Account management                    |
| Personal info → User IDs                           | Yes              | Required                 | Account management                    |
| Photos and videos → Photos                         | Yes              | Required for visits      | App functionality                     |
| App info and performance → Crash logs, Diagnostics | Yes              | Required                 | Analytics (stability)                 |
| Device or other IDs                                | Yes (push token) | Optional (notifications) | App functionality                     |

### 3.5 Other App content answers

- **App access:** "All functionality requires an account created by a Koolee administrator." Provide the reviewer account from §2.2.
- **Ads:** No.
- **Target audience:** 18 and over. Not designed for children.
- **Content rating (IARC):** Utility/Productivity. No violence, sexuality, gambling, user interaction or sharing of location with OTHER USERS beyond the customer being served. Answer "Yes" to "Does the app share the user's current physical location with other users?", because the customer sees the driver's position.
- **News app / COVID / Financial features / Health:** No.

---

## 4. Screenshots

Both stores need screenshots, even Unlisted/testing:

- iOS: 6.9" (1320 × 2868) — Today, Schedule, a visit, a pickup, Account.
- Play: at least 2 phone screenshots (1080 × 1920 or larger).

The simulator flows in `apps/driver/e2e/maestro` produce exactly these
screens (`screens.yaml`, `visit.yaml`, `pickup.yaml`). Run them against a
seeded demo account, so no real customer's name or address appears.

---

## 5. Privacy policy — staff section (draft for review)

The public policy at `/privacy` describes customers only. Both stores check
that the policy linked from the listing covers what THIS app collects. Here is
a draft section to review and add before submitting. **It is legal copy: TD
reviews it; it is not live anywhere.**

```text
Koolee staff (drivers and agents)

If you work for Koolee and use the Koolee Driver app, we collect:
- Your account details: name, email address and the photo you choose for your profile.
- Your location, but only while you are on shift, from "Start shift" until "End shift", including when the app is in the background. We use it to assign and coordinate pickups, and to show the customer you are collecting from where you are. It is not collected when you are off shift.
- The custody evidence you record: seal numbers, photos of passports and bags, timestamps and the location at each hand-off.
- Technical data: a push notification token for your phone, and crash and performance reports.

Customers see your first name and your photo. A customer choosing a driver for their pickup sees the drivers on shift nearby on a map, with how far away they are. Once they have chosen you, they see your live position while you are on your way to them. They see nothing else about you. We keep a sampled trail of your on-shift positions for seven days, to look into gaps in coverage; after that only your most recent position is kept. Custody records are kept for as long as the booking's records are.
```

"Seven days" is `prunePositionPings` in
`packages/core/src/services/position-health.ts`. Change the sentence if that
window changes.
