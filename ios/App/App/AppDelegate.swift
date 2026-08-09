import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.

        // WKWebView occasionally finishes its very first layout pass with
        // its internal viewport bookkeeping (window.innerWidth/innerHeight)
        // stuck at a smaller size than the device's actual screen, even
        // though the DOM itself (document.documentElement, #root) is
        // correctly laid out to the full screen - confirmed live via Safari
        // Web Inspector against a real, reproduced case. Also confirmed
        // live: neither dispatching a synthetic JS 'resize' event, nor
        // toggling the viewport meta tag's content, nor even a full in-page
        // reload (location.reload()) budges those numbers at all - so
        // whatever's stale lives inside the WKWebView instance itself,
        // outside anything the page's own JS can reach or reset. Only
        // rotating the device or fully relaunching the app - both genuine
        // geometry changes - fixed it by hand, which is also why a plain
        // `webView.frame = <the frame it already has>` (an earlier attempt
        // at this) did nothing: reassigning an unchanged value is a no-op
        // to WebKit.
        //
        // A follow-up round of live testing ruled the frame-wiggle approach
        // out too: even genuinely changing the webView's frame size (with a
        // real render pass in between, not just reassigning the same
        // value) had zero effect after waiting several seconds - while an
        // actual device rotation, tested right after, fixed it instantly.
        // That's a meaningful distinction: rotation and a frame change
        // aren't the same event to WebKit. Rotation specifically posts
        // UIDevice.orientationDidChangeNotification, which is what this
        // targets instead - forcing that same notification without an
        // actual physical rotation.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.nudgeWebViewLayout()
        }
    }

    // UIDevice doesn't expose a public method to trigger a fake orientation
    // change directly, but setting its "orientation" property via KVC - a
    // long-standing, widely used technique for exactly this, not a private
    // API call - posts the same notification a genuine rotation does.
    // Detouring through a different orientation first (rather than setting
    // .portrait directly) matters, since every "same value" attempt so far
    // (frame reassignment, this) has turned out to be a no-op to WebKit -
    // only an actual *change* triggers anything.
    private func nudgeWebViewLayout() {
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        UIDevice.current.setValue(UIDeviceOrientation.landscapeLeft.rawValue, forKey: "orientation")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            UIDevice.current.setValue(UIDeviceOrientation.portrait.rawValue, forKey: "orientation")
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // Forwards the APNs device token (or registration failure) to
    // @capacitor/push-notifications, which is listening for these
    // notifications. Required boilerplate per Capacitor's push-notifications
    // plugin setup docs - without this, PushNotifications.register() never
    // fires its 'registration' event on iOS.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
