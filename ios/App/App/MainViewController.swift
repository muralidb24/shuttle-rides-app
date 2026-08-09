import UIKit
import Capacitor

// WKWebView occasionally finishes its very first layout pass with its
// internal viewport bookkeeping (window.innerWidth/innerHeight) reporting a
// smaller size than the device's actual screen, even though the DOM itself
// (document.documentElement, #root) is correctly laid out to the full
// screen size. This was confirmed live via Safari Web Inspector: on an
// affected launch, window.innerWidth/innerHeight read noticeably smaller
// than document.documentElement.getBoundingClientRect() and screen.width/
// height, which are all in agreement with each other. Content positioned
// near the bottom/edges of the page ends up outside that shrunken
// viewport, making it unreachable - matching exactly what was reported
// (the "+ Request a ride" button extending past the visible screen).
//
// Rotating the device or fully relaunching the app both force WebKit to
// redo this bookkeeping from scratch, which is why those "fixed" it - but
// neither is something we can ask users to do every time. Forcing the
// webView's own frame back to the view's bounds on every layout pass, plus
// nudging WebKit with an explicit resize event once the screen has
// appeared, reproduces that same resync automatically.
class MainViewController: CAPBridgeViewController {
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        webView?.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        webView?.frame = view.bounds
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('resize'))", completionHandler: nil)
    }
}
