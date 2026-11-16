import UIKit
import WebKit

final class MainViewController: UIViewController, WKNavigationDelegate, UITextFieldDelegate {
    private let key = "decklan.url"
    private let bg = UIColor(red: 0.055, green: 0.059, blue: 0.078, alpha: 1)
    private let accent = UIColor(red: 0.427, green: 0.290, blue: 1.0, alpha: 1)

    private var webView: WKWebView!
    private let connectView = UIView()
    private let field = UITextField()
    private let message = UILabel()
    private var pendingFirstLoad = true

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var canBecomeFirstResponder: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bg

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = bg
        webView.scrollView.backgroundColor = bg
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never // la page gère les zones sûres (viewport-fit=cover)
        webView.isHidden = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        buildConnectView()

        if let saved = UserDefaults.standard.string(forKey: key), !saved.isEmpty {
            field.text = saved
            open(saved)
        } else {
            showConnect(nil)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    // Secouer l'iPhone : retour à l'écran de connexion (changer de PC).
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { showConnect(nil) }
    }

    // MARK: écran de connexion

    private func buildConnectView() {
        connectView.backgroundColor = bg
        connectView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(connectView)
        NSLayoutConstraint.activate([
            connectView.topAnchor.constraint(equalTo: view.topAnchor),
            connectView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            connectView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            connectView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        let title = UILabel()
        title.text = "DeckLan"
        title.textColor = .white
        title.font = .systemFont(ofSize: 34, weight: .bold)
        title.textAlignment = .center

        let sub = UILabel()
        sub.text = "Sur le PC : DeckLan, onglet Connexion. Scanne le QR « Application DeckLan » avec l'appareil photo, ou copie le lien et colle-le ici."
        sub.textColor = UIColor(white: 0.7, alpha: 1)
        sub.font = .systemFont(ofSize: 15)
        sub.numberOfLines = 0
        sub.textAlignment = .center

        field.textColor = .white
        field.backgroundColor = UIColor(white: 0.14, alpha: 1)
        field.layer.cornerRadius = 12
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor(white: 0.25, alpha: 1).cgColor
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardType = .URL
        field.returnKeyType = .go
        field.clearButtonMode = .whileEditing
        field.delegate = self
        field.attributedPlaceholder = NSAttributedString(
            string: "http://192.168.1.20:8765/?t=…",
            attributes: [.foregroundColor: UIColor(white: 0.45, alpha: 1)])
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 10))
        field.leftViewMode = .always
        field.heightAnchor.constraint(equalToConstant: 50).isActive = true

        let paste = makeButton("Coller le lien copié", primary: false, action: #selector(pasteTapped))
        let go = makeButton("Se connecter", primary: true, action: #selector(goTapped))

        message.textColor = UIColor(red: 1, green: 0.45, blue: 0.45, alpha: 1)
        message.font = .systemFont(ofSize: 14)
        message.numberOfLines = 0
        message.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [title, sub, field, paste, go, message])
        stack.axis = .vertical
        stack.spacing = 14
        stack.setCustomSpacing(8, after: title)
        stack.setCustomSpacing(22, after: sub)
        stack.translatesAutoresizingMaskIntoConstraints = false
        connectView.addSubview(stack)

        let width = stack.widthAnchor.constraint(equalToConstant: 420)
        width.priority = .defaultHigh
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: connectView.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: connectView.centerYAnchor, constant: -20),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: connectView.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: connectView.trailingAnchor, constant: -24),
            width,
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        connectView.addGestureRecognizer(tap)
    }

    private func makeButton(_ text: String, primary: Bool, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(text, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        b.backgroundColor = primary ? accent : UIColor(white: 0.16, alpha: 1)
        b.layer.cornerRadius = 12
        b.heightAnchor.constraint(equalToConstant: 50).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    @objc private func dismissKeyboard() { view.endEditing(true) }

    @objc private func pasteTapped() {
        guard let t = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else {
            message.text = "Le presse-papiers est vide."
            return
        }
        if let u = URL(string: t), u.scheme == "decklan" { handleLink(u); return }
        field.text = t
        open(t)
    }

    @objc private func goTapped() {
        view.endEditing(true)
        open(field.text ?? "")
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        goTapped()
        return true
    }

    private func showConnect(_ error: String?) {
        message.text = error
        webView.isHidden = true
        webView.stopLoading()
        connectView.isHidden = false
        view.bringSubviewToFront(connectView)
    }

    // MARK: ouverture du deck

    func handleLink(_ url: URL) {
        if url.scheme == "decklan" {
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
            if let u = comps?.queryItems?.first(where: { $0.name == "u" })?.value, !u.isEmpty {
                field.text = u
                open(u)
            }
        } else {
            field.text = url.absoluteString
            open(url.absoluteString)
        }
    }

    private func open(_ raw: String) {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { showConnect("Entre l'adresse affichée par DeckLan sur le PC."); return }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "http://" + s }
        guard let url = URL(string: s), url.host != nil else {
            showConnect("Adresse invalide.")
            return
        }
        message.text = nil
        UserDefaults.standard.set(s, forKey: key)
        pendingFirstLoad = true
        connectView.isHidden = true
        webView.isHidden = false
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10))
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pendingFirstLoad = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showConnect("Impossible de joindre le PC. Vérifie le Wi-Fi, l'adresse et que DeckLan tourne. (Secoue l'iPhone pour revenir ici.)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if pendingFirstLoad { showConnect("Connexion interrompue.") }
    }

    // Certificat HTTPS auto-signé accepté uniquement pour une adresse du réseau local.
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        if space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = space.serverTrust, isLocalHost(space.host) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    private func isLocalHost(_ host: String) -> Bool {
        let h = host.lowercased()
        if h == "localhost" || h.hasSuffix(".local") || !h.contains(".") { return true }
        let p = h.split(separator: ".").compactMap { Int($0) }
        guard p.count == 4 else { return false }
        if p[0] == 10 { return true }
        if p[0] == 192 && p[1] == 168 { return true }
        if p[0] == 172 && (16...31).contains(p[1]) { return true }
        if p[0] == 169 && p[1] == 254 { return true }
        return false
    }
}
