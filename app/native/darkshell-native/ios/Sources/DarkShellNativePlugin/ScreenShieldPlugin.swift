import Capacitor
import UIKit

/// What iOS allows instead of Android's FLAG_SECURE (WindowShield.java): the
/// wallet is covered while it is not in front (so the app switcher's snapshot
/// shows nothing) and while the screen is being recorded, mirrored or
/// AirPlayed. iOS gives apps no way to block a screenshot itself.
@objc(ScreenShieldPlugin)
public class ScreenShieldPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenShieldPlugin"
    public let jsName = "ScreenShield"
    public let pluginMethods: [CAPPluginMethod] = []

    private var cover: UIView?
    private var inactive = false
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.inactive = true
            self?.update()
        })
        observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.inactive = false
            self?.update()
        })
        observers.append(nc.addObserver(forName: UIScreen.capturedDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.update()
        })
        DispatchQueue.main.async { [weak self] in self?.update() }
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    private func update() {
        let captured = bridge?.viewController?.view.window?.screen.isCaptured ?? UIScreen.main.isCaptured
        if inactive || captured { show() } else { hide() }
    }

    private func show() {
        guard cover == nil, let window = bridge?.viewController?.view.window else { return }
        let v = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterialDark))
        v.frame = window.bounds
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(v)
        cover = v
    }

    private func hide() {
        cover?.removeFromSuperview()
        cover = nil
    }
}
