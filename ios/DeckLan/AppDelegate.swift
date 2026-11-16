import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        let vc = MainViewController()
        w.rootViewController = vc
        w.makeKeyAndVisible()
        window = w
        application.isIdleTimerDisabled = true // écran toujours allumé
        if let url = launchOptions?[.url] as? URL { vc.handleLink(url) }
        return true
    }

    // Lien decklan://pair?u=<adresse> (QR « Application DeckLan » du PC, scanné avec l'appareil photo)
    func application(_ app: UIApplication, open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        (window?.rootViewController as? MainViewController)?.handleLink(url)
        return true
    }
}
