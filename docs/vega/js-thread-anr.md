Source: https://developer.amazon.com/docs/vega/0.23/triage-guidelines.html
Fetched: 2026-07-03

Triage Guidelines | Vega Troubleshooting

Alexa (/alexa)

Amazon Appstore (/apps-and-games)

Ring (https://developer.ring.com/)

AWS (https://aws.amazon.com)

Console (/home.html)

as

Settings

Sign out

Notifications

Alexa

Amazon Appstore

Ring

AWS

Support
Contact Us
My Cases

Console (/home.html)

Support (/support/)

Contact Us (/support/cases/new)

My Cases (/support/cases)

as

Settings (/myaccount.html)

Sign out

Vega Developer Docs

Home (/docs/vega/vega.html)

Get Started

Design and Develop

Publish

Reference

Support

Toggle navigation

Toggle navigation

Vega SDK Version 0.23
Version 0.23 (LATEST) (#)
Version 0.22 (#)
Version 0.21 (#)

Troubleshoot Issues
Collapse All (#) | Expand All (#)
Troubleshoot Issues Overview (../0.23/troubleshoot-overview.html)
Installation Issues (#)
Fix Vega SDK Issues (../0.23/sdk-install-issues.html)
Resolve Vega Studio Extension and CLI Issues (../0.23/cli-issues.html)
SDK Manager Issues (../0.23/sdk-manager-issues.html)
Build Issues (#)
Troubleshoot Amazon Devices Builder Tools for AI-Powered Development (../0.23/mcp-server-issues.html)
Fix Vega Studio Build Issues (../0.23/build-issues.html)
Fix Linker Namespacing Issues (../0.23/linker-namespacing-issues.html)
Resolve Monorepo Issues (../0.23/monorepo-issues.html)
Debug Runtime Issues (../0.23/runtime-issues.html)
Resolve Fast Refresh Issues (../0.23/fast-refresh-issues.html)
Troubleshoot Vega Virtual Device Issues (../0.23/kvd-issues.html)
Resolve Fire TV Stick Issues (../0.23/fire-tv-stick.html)
Fix VDA Connection and Power Issues (../0.23/vda-issues.html)
Troubleshoot Charles Proxy Issues (../0.23/charles-proxy-issues.html)
Troubleshoot Network Proxy Issues (../0.23/network-proxy-issues.html)
Troubleshoot Performance Tools Issues (../0.23/performance-tools-issues.html)
Debugging Issues (#)
Fix Debugging Issues (../0.23/debugger-issues.html)
Fix Crash Analysis Issues (../0.23/acr-issues.html)
Testing Issues (#)
Troubleshoot Test Automation Issues (../0.23/test-automation-issues.html)
Other Issues (#)
Live TV Issues (../0.23/live-tv-issues.html)
User Interface Issues (../0.23/keyboard-issues.html)
Triage Guidelines (../0.23/triage-guidelines.html)

Vega SDK Version 0.23
Version 0.23 (LATEST) (#)
Version 0.22 (#)
Version 0.21 (#)
Vega Docs Home (/docs/vega/vega.html) > Troubleshoot (../0.23/troubleshoot-overview.html) > Other Issues >
# Triage Guidelines
Open Beta Documentation Amazon offers this technical documentation as part of a pre-release, open beta. The features described might change as Amazon receives feedback and iterates on the features. For the most current feature information, see the latest Release Notes (../../vega/latest/vega-release-notes.html).
Testing issues in external builds is crucial for distinguishing between app-related and OS-related problems. By examining the app's behavior across different builds we can effectively pinpoint whether the root cause lies within the app code or the operating system itself. This systematic approach helps ensure accurate problem identification and targeted resolution, leading to more efficient troubleshooting and debugging processes.
When troubleshooting app issues, you can use version comparison as an effective diagnostic approach. If an issue reproduces on both the latest OS versions and previous OS versions while running the same app build, it typically indicates that the root cause lies within the app code or its dependencies. Conversely, if the issue only manifests on the latest OS version but works correctly on the previous one despite using the same app build, this suggests an OS compatibility issue that may require specific handling in your app. This comparative testing method helps you efficiently identify whether to focus debugging efforts on your app code or investigate OS-specific compatibility requirements, ultimately leading to more targeted problem resolution.
The following sections detail examples of app-side issue.
## ANR crash
Application Not Responding (ANR) crashes are typically app-related issues, occurring when an app fails to respond to the Lifecycle Manager (LCM) or system calls. In these cases, the LCM forcibly terminates the unresponsive app. There are several specific scenarios that can trigger an ANR, leading to app termination.
### Reading ANR reports
If your app process was ANR'ed, the next field you'll want to look at will be the "LCM_ANR_REASON" field; as the name implies, this will be the reason why the process was ANR'ed. These reasons are detailed below:
LCM_ANR_REASONDescriptionAdditional MetadataExample Output
Lifecycle CallbackWhen an app changes states, LCM triggers callbacks to inform the app about it's new state (ex: "onForeground"). Apps are expected to return immediately from these transitions as to not block the app from receiving new callbacks."LCM_APP_TRANSITION" What component's lifecycle transition caused the ANR and what transition was it.LCM_APP_TRANSITION: appInst[20]: FOREGROUND transition
Display Input EventInteractive components can subscribe to handle input events from the user such as touch, pointer, or keyboard events. If they handle these events asynchronously, they must acknowledge when they handle the events. If the app fails to acknowledge that they have done so in the given time period, the app will be deemed unresponsive and the app will be terminated. Note that some some graphics utilities may handle acknowledging the input on the app's behalf.N/A
Thread MonitorLCM offers a utility called "Thread Monitor" which monitors registered threads and then terminates the app if any become unresponsive. By default, all apps' main threads are monitored but additional threads can be monitored using "Thread Watchdog""LCM_ANR_THREAD_NAME" If the thread that ANR'ed was registered with a name, this field will list the name it was registered withLCM_ANR_THREAD_NAME: MyThread
Task Execution Limits ExceededWhen a task is launched by Task Manager, it has 10 minutes to completes it work in the background. If a task goes over that threshold it is killed. Please note this is only for tasks launched by Task Manager."TASK_MANAGER_COMPONENT_ID" Component ID of the task killed
"TASK_MANAGER_TASK_ID" Work ID of the task killed
"TASK_MANAGER_TASK_NAME" Optional name of the task killedTASK_MANAGER_COMPONENT_ID: com.amazon.appfwk.test.tm.task
TASK_MANAGER_TASK_ID: 1047
TASK_MANAGER_TASK_NAME: triggerExecutionLimits
### App was killed for being unresponsive (ANR)
To ensure all apps running on the system are alive and actively obeying their contracts, various services on the system track app responsiveness. If they determine the app has become unresponsive, they will request for LCM to forcefully terminate the process. The following are the events that could lead to an ANR. Note the default timeout lengths can be overridden by profile, platform, and product configurations, so this may not be the timeout length your app must comply with.
ANR causeSourceANR Transition descriptionDefault timeout length
Apps failing to return from transition callbacksLCMWhen an app changes states, LCM triggers callbacks to inform the app about it's new state (ex: "onForeground"). Apps are expected to return immediately from these transitions as to not block the app from receiving new callbacks.8 seconds
Interactive apps failing to creating surfaces while in the foregroundLCM / DisplayServerAll interactive apps are expected to create surfaces when they are in the foreground. When a component is added to the DisplayStack, DisplayServer notifies LCM and we mark that the component is visible to the user.12 seconds
Apps not responding to inputs in timeDisplayServerWhen an app is in the foreground and isn't responding to touch inputs, GWSI monitors touch ANRs and reports them through LCMby GWSI
App main thread is unresponsive for any other reason than aboveApp Thread MonitorWhen the main thread is doing excessive blocking OR has a deadlock. Note this is conditionally enabled per device.45 seconds
App JS thread is unresponsiveApp Thread MonitorWhen the JS thread is doing excessive blocking OR has a deadlock.by VS (8 seconds)

With the above data, we should reach out to the app team with the above mentioned information and recommend the solution according to the LCM_ANR_REASON to the app team.
## JS exceptions
JavaScript (JS) exceptions typically originate from the app and are recorded in journald logs. When investigating issues, it's important to correlate JS exceptions with the reported problem's timestamp and reproduction steps. While some JS exceptions may appear randomly in logs due to various factors, finding exceptions that align with the specific issue timeframe strongly suggests an app-side problem rather than a OS level issue. If JSErrors come with Fatal exception followed by crash, then it is the App's method is throwing exception.
## Media control buttons aren’t working
When media control keys (like play, pause, or fast-forward/rewind) on the remote control fail during video playback, log analysis becomes crucial. The full investigation typically focusses on two aspects: verifying if the remote's key press events are properly reaching the app, and confirming whether the app successfully acknowledges these signals. This systematic check helps identify where the communication chain breaks down.
However, app developers can look at the app acknowledgement log only
### inputd logs
```
`~~Jul 14 12:50:38.950438 firestick-3193544e8fbc4619 inputd[1702]: I Inputd:accept:189: Display Power Resource Acquired in response to Key Event [KEY_FASTFORWARD]: Took 0.010ms Jul 14 12:50:38.950856 firestick-3193544e8fbc4619 inputd[1702]: I Inputd:sendKeyToClient:2300: sending key to passthrough-capable client: id=17 pid=2564 prio=HIGHEST_PRIORITY_OBSERVER: TimeStamp=1752497438.950153 : keyType=EV_KEY : keyCode=[KEY_FASTFORWARD] : state=down Jul 14 12:50:38.950978 firestick-3193544e8fbc4619 inputd[1702]: I Inputd:sendKeyToClient:2300: sending key to passthrough-capable client: id=5 pid=1231 prio=TIMEOUT_MANAGER_PRIORITY: TimeStamp=1752497438.950153 : keyType=EV_KEY : keyCode=[KEY_FASTFORWARD] : state=down Jul 14 12:50:38.951094 firestick-3193544e8fbc4619 inputd[1702]: I Inputd:sendKeyToClient:2300: sending key to passthrough-capable client: id=22 pid=2440 prio=USAGE_STATS_PRIORITY: TimeStamp=1752497438.950153 : keyType=EV_KEY : keyCode=[KEY_FASTFORWARD] : state=down Jul 14 12:50:38.951206 firestick-3193544e8fbc4619 inputd[1702]: I Inputd:sendKeyToClient:2300: sending key to passthrough-capable client: id=19 pid=2008 prio=PUFFIN_OBSERVER_PRIORITY: TimeStamp=1752497438.950153 : keyType=EV_KEY : keyCode=[KEY_FASTFORWARD] : state=down Jul 14 12:50:38.951306 firestick-3193544e8fbc4619 inputd[1702]: I Inputd:sendKeyEvent:2389: id 65 is registered for key event device injection intercept, injecting [KEY_FASTFORWARD] to the original input device Jul 14 12:50:38.951508 firestick-3193544e8fbc4619 inputd[1702]: I Inputd:~~~~inject_ke~~y:385: Input event successfully written to udev: TimeStamp=1752497438.950153 : keyType=EV_KEY : keyCode=[KEY_FASTFORWARD] : state=down `
```

### App’s acknowledgment log
```
`Jul 14 12:50:38.951859 firestick-3193544e8fbc4619 layer.androidtv[22766]: I GWSI_LOG:KB key:XF86AudioForward state:1 evtId:42 Jul 14 12:50:39.211834 firestick-3193544e8fbc4619 layer.androidtv[22766]: I GWSI_LOG:KB key:XF86AudioForward state:0 evtId:43 `
```

When app's acknowledgment logs confirm about receiving the input from remote , but the expected actions still don't occur, it likely indicates an app-side issue. The app is receiving but failing to process these key events properly. Additionally, If the app has implemented VegaMediaControls(KMC) , the KMC-handler logs can provide further confirmation - it will record "undefined key events" for each button press if the app hasn't properly implemented the required KMC methods.
When KMC is invoked , If alexa is processing the Pause/Play/Forward/Rewind related , KSM (VegaSpeechModule) has to acknowledge to pass the information to KMC
### KMC button events undefined log
```
`Jul 11 09:29:20.821184 firestick-82bf81af994b24a7 local0.info layer.androidtv[10448]: 20 I Volta:[KeplerScript-JavaScript] mitxp[KIKAPLAYER][KMC-handler] - handlePlayPause (undefined) Jul 11 09:29:10.117873 firestick-82bf81af994b24a7 local0.info layer.androidtv[10448]: 20 I Volta:[KeplerScript-JavaScript] mitxp[KIKAPLAYER][KMC-handler] - handleRewind (undefined) Jul 11 09:29:10.663667 firestick-82bf81af994b24a7 local0.info layer.androidtv[10448]: 20 I Volta:[KeplerScript-JavaScript] mitxp[KIKAPLAYER][KMC-handler] - handleFastForward (undefined) `
```

## Navigation not working
It is same as the above mentioned media control buttons issue. The investigation should focus on two aspects: verifying if the remote's key press events are properly reaching the app, and confirming whether the app successfully acknowledges these signals. This systematic check helps identify where the communication chain breaks down. While app developers do not have access to inputd logs, they can see the app’s acknowledgement of the button event. If the app has an acknowledgment of the button event, it is likely that it has received the navigation event from the remote and first level triage should be done on the app side to check if there has been any issue in the app implementation.
## VoiceView not working
If VoiceView is not working and the user reports value is not read, it is worth checking the ucc tree to see if the label has description for accessibility to read. Link for the Vega script and Webview apps are below
KeplerScript (../../react-native-vega/0.72/accessibility.html)
WebView (webview-development-best-practices-tv.html)
## UI crop/UI Focus issues
User Interface (UI) cropping issues are typically app-related problems since the app controls UI element rendering. These issues appear as either truncated components or empty fields within tabs, menus, or submenus. Investigation by the app team is necessary to examine UI object rendering and layout implementation. As these are UI/focus-related issues, operating system logs generally won't contain relevant information about these problems.
## Audio related issues
Audio loss/overlap issues
If app tries to write audio without acquiring audio focus, then "Would block" error is returned to app. This requires triaging from App perspective why they failed to acquire required focus session:
```
`E AudioStream_VNTK:writeBuffer:180 failed Would Block `
```

Audio leak issues
In such cases, apps enter into a bad state after failing to write in the `Paused` focus state. For example, this may occur when the playback does not resume and stays in the loading spinner screen after Alexa interruptions.
```
`audioFocus Analysis /// ABP acquire media audio focus Jan 03 06:31:32.736009 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioControlService: requestAudioFocus(): pid=11411, sessionId=44 Jan 03 06:31:32.736033 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusStack: requestAudioFocus(): pid=11411, sessionId=44, life=2, request=1, flag=2, type=media, usage=media Jan 03 06:31:32.736711 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusRecordState: handleAudioFocusGained(): pid 11411 session 44 moving from state [init] to [granted] /// Mic button pressed Jan 03 06:31:49.516182 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[12d] VegaBluetoothKeyEventObserver:startSconeMicStreaming::scone mic button pressed /// PuffinApp acquires voice recognition focus, ABP's Media focus will be paused Jan 03 06:31:49.555699 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioControlService: requestAudioFocus(): pid=1565, sessionId=11 Jan 03 06:31:49.555723 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusStack: requestAudioFocus(): pid=1565, sessionId=11, life=0, request=0, flag=0, type=voice recognition, usage=voice recognition /// ABP Media focus is paused Jan 03 06:31:49.556032 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusRecordState: handleAudioFocusLost(): pid 11411 session 44 moving from state [paused] to [paused] /// PuffinApp voice recognition focus is moving on Jan 03 06:31:49.555045 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[e:4b] AudioFocusIntegration:acquireFocus:focusRequestId=Dialog Jan 03 06:31:49.607146 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusRecordState: handleAudioFocusGained(): pid 1565 session 11 moving from state [init] to [granted] Jan 03 06:31:49.608561 firestick-74357a7ea4ea1145 PuffinApp[1565]: 2875 I AudioManagerAipc: dispatchAudioFocusEventCb(): Dispatching audio focus listener event sessionId=11, event=0 Jan 03 06:31:49.608585 firestick-74357a7ea4ea1145 PuffinApp[1565]: 2875 W AudioManagerBase: onAudioFocusResumed(), no handler with focusSessionId 11 is registered before /// ABP's Media code has received focus paused Jan 03 06:31:49.607683 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: W MEDIA_PLAYERV2:MediaPlayerAudioFocusObserver.cpp(103) audioFocusEventObserver Alert: onAudioPause received Jan 03 06:31:49.607867 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: W MEDIA_PLAYERV2:MediaPlayerAudioFocusObserver.cpp(105) audioFocusEventObserver Alert: Audio focus paused temporarily, sent event to app Jan 03 06:31:49.608230 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: W MEDIA_PLAYERV2:MediaPipelineObserverImpl.cpp(132) operator() AudioFocus Paused. /// PuffinApp using their focus Jan 03 06:31:49.608656 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[dd] AudioFocusIntegration:onAudioFocusGranted:sessionId=11 Jan 03 06:31:49.609276 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[dd] AudioFocusIntegration:onAudioFocusGranted:focusgrantresponsetime=53 Jan 03 06:31:49.609820 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[e:4] AudioFocusIntegration:executeOnFocusAcquire::acquired channel:channelName=Dialog,focusRequestId=Dialog,sessionId=11 /// Mic button is released Jan 03 06:31:51.563061 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[12d] VegaBluetoothKeyEventObserver:stopSconeMicStreaming::scone mic button released or cancelled by other key press /// ABP Media is trying to write audio in media focus paused state, as expected it fails with "Would Block", this is not a system audio issue Jan 03 06:31:52.645487 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: E AudioStream_VNTK:writeBuffer:180 failed Would Block Jan 03 06:31:52.665143 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: E AudioStream_VNTK:writeBuffer:180 failed Would Block /// Now PuffinApp is releasing voice recognition focus Jan 03 06:31:53.131161 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[e:4b] AudioFocusIntegration:onFocusRelease:focusRequestId=Dialog Jan 03 06:31:53.131504 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioControlService: releaseAudioFocus(): pid=1565, sessionId=11 Jan 03 06:31:53.131524 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusStack: releaseAudioFocus(): pid=1565, sessionId=11 Jan 03 06:31:53.131558 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusRecordState: handleAudioFocusReleased(): pid 1565 session 11 moving from state [granted] to [released] /// ABP media focus is resumed here now Jan 03 06:31:53.131889 firestick-74357a7ea4ea1145 mixer[841]: 12236 I AudioFocusRecordState: handleAudioFocusGained(): pid 11411 session 44 moving from state [paused] to [granted] Jan 03 06:31:53.132524 firestick-74357a7ea4ea1145 PuffinApp[1565]: I PuffinApp:[254] AudioFocusIntegration:onAudioFocusReleased:sessionId=11 Jan 03 06:31:53.132438 firestick-74357a7ea4ea1145 PuffinApp[1565]: 13562 I AudioManagerAipc: dispatchAudioFocusEventCb(): Dispatching audio focus listener event sessionId=11, event=1 Jan 03 06:31:53.132461 firestick-74357a7ea4ea1145 PuffinApp[1565]: 13562 W AudioManagerBase: onAudioFocusStopped(), no handler with focusSessionId 11 is registered before ///ABP media code prints receiving their focus resumed, now it can successfully play audio again Jan 03 06:31:53.132662 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: W MEDIA_PLAYERV2:MediaPlayerAudioFocusObserver.cpp(83) audioFocusEventObserver Alert: onAudioGranted received Jan 03 06:31:53.132705 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: W MEDIA_PLAYERV2:MediaPlayerAudioFocusObserver.cpp(85) audioFocusEventObserver Alert: Audio focus granted , sent event to app Jan 03 06:31:53.132796 firestick-74357a7ea4ea1145 com.abp.firetv[11411]: W MEDIA_PLAYERV2:MediaPipelineObserverImpl.cpp(140) operator() AudioFocus Granted. ////// BUT ABP is not playing writing audio now, may be it has gone into bad state after it failed to write in Paused focus state, App developer should look into that further !!! `
```

## Media playback not working
When encountering media playback issues, distinguishing between OS-level and app-specific problems requires systematic investigation. A key diagnostic approach is to test playback across multiple apps - if the issue persists across various media apps, it likely indicates an OS-level or hardware problem, while issues isolated to a single app typically point to app-specific causes. The behavior with different media formats can also be telling; if all formats fail to play, this suggests an OS or driver issue, whereas problems with specific formats often indicate app codec or compatibility limitations.
System audio behavior provides another crucial diagnostic indicator. When audio functions normally but media playback fails within an app, this typically points to an app issue. Conversely, if all audio is affected, including system sounds, the problem likely resides at the OS or hardware level. The timing of issues can also be informative - problems arising after OS updates often indicate system-level changes, while issues coinciding with app updates suggest app-specific causes.
## Playback freeze
When investigating media playback freezing issues, several key indicators can help determine whether the problem originates from the OS or the app level. One primary indicator is CPU and memory usage - if the system shows high CPU utilization across all processes or significant memory pressure during freezes, this typically suggests an OS-level resource constraint. Conversely, if only the media app shows excessive resource consumption, the issue likely resides within the app. The frequency and pattern of freezing also provide valuable insights - intermittent freezing that occurs at regular intervals often indicates buffering or memory management issues within the app, while system-wide stuttering or freezing that affects multiple apps simultaneously usually points to OS-level problems.
App behavior during freezes offers additional diagnostic clues. If the app becomes completely unresponsive during freezes while other system functions continue normally, this suggests an app-specific issue such as deadlocks or poor thread management. However, if the entire system becomes sluggish or unresponsive during media playback, this often indicates OS-level resource constraints or driver issues. The relationship between freezing and specific actions is also telling - if freezes consistently occur during particular operations (like seeking or changing quality settings), this suggests app-level handling issues. Meanwhile, freezes that coincide with system events (like background processes starting or system resources being reallocated) typically indicate OS-level conflicts.
## WebView specific issues
### WebView exceptions are not showing in logs
The onError, onHttpError, and onSslError will capture some connection errors with the WebView but will not show console.log outputs. To do this, you need to port forward using `vda forward tcp:9229 tcp:9229` and then connecting to the device with chrome://inspect/#devices (http://chrome//inspect/#devices). Here, can use Chrome as a debugging tool, including seeing console.logs in the console tab.
### WebView local HTML asset not found
This is a common issue with two likely causes. When adding local files to `/assets/*`, the debug fast refresh and “run” buttons do not upload changes from the assets folder. You will need to rebuild before running each time a change is made to a local html asset. You may also delete the build folder and rebuild to ensure that the new html file is present. Also make sure that your source.uri is pointing to `file:///pkg/assets/*` and that the file is in the project root’s `/asset` directory (and not in the `/src` directory)
### WebView menu button not working
The menu button is not captured when the `allowsDefaultMediaControl` property is enabled. The Vega Script wrapper app needs to inject JavaScript into a WebView reference with the intended command.
Last updated: Oct 06, 2025

ANR crash (#anr-crash)
Reading ANR reports (#reading-anr-reports)
App was killed for being unresponsive (ANR) (#app-was-killed-for-being-unresponsive-anr)
JS exceptions (#js-exceptions)
Media control buttons aren’t working (#media-control-buttons-arent-working)
inputd logs (#inputd-logs)
App’s acknowledgment log (#apps-acknowledgment-log)
KMC button events undefined log (#kmc-button-events-undefined-log)
Navigation not working (#navigation-not-working)
VoiceView not working (#voiceview-not-working)
UI crop/UI Focus issues (#ui-cropui-focus-issues)
Audio related issues (#audio-related-issues)
Media playback not working (#media-playback-not-working)
Playback freeze (#playback-freeze)
WebView specific issues (#webview-specific-issues)
WebView exceptions are not showing in logs (#webview-exceptions-are-not-showing-in-logs)
WebView local HTML asset not found (#webview-local-html-asset-not-found)
WebView menu button not working (#webview-menu-button-not-working)

Back to Top
Follow us:

Resources

Appstore developer blog (/apps-and-games/blogs)

Technical documentation (/apps-and-games/documentation)

Amazon Developer Huddle (/apps-and-games/devhuddle)

Supported devices

Amazon Fire TV (/apps-and-games/fire-tv)

Fire tablets (/apps-and-games/fire-tablets)

Other services & APIs

Small Business Accelerator Program (/apps-and-games/small-business-program)

Developer Promotions Console (/docs/reports-promo/promo-overview.html)

Alexa for video publishers (/apps-and-games/alexa-for-video-publishers)

Login with Amazon (/apps-and-games/login-with-amazon)

Frustration-Free Setup (/frustration-free-setup)

Amazon Incentives API (/incentives-api)

Amazon Merch on Demand (/apps-and-games/merch)

Amazon Music (/docs/music/landing_home.html)

Fire TV Partners (/device-partners/firetv/)

Support

Appstore Developer Community (https://community.amazondeveloper.com/)

FAQs (/docs/app-submission/faq-landing.html)

Contact us (/support/cases/new)

Legal

Terms & agreements (/terms-and-agreements)

Privacy Notice (https://www.amazon.com/gp/help/customer/display.html?nodeId=GX7NJQ4ZB8MHFRNJ)

© 2010-2026, Amazon.com, Inc. or its affiliates. All Rights Reserved.

Terms (/terms-and-agreements)

Amazon Developer Blog (/blogs/)

Contact Us (/support/cases/new)
