import ExpoModulesCore
import UIKit

final class MichelAppleLiquidGlassView: ExpoView {
  private let glassView = UIVisualEffectView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .clear
    isOpaque = false

    glassView.translatesAutoresizingMaskIntoConstraints = false
    glassView.isUserInteractionEnabled = false
    glassView.clipsToBounds = true
    glassView.layer.cornerCurve = .continuous
    addSubview(glassView)

    NSLayoutConstraint.activate([
      glassView.leadingAnchor.constraint(equalTo: leadingAnchor),
      glassView.trailingAnchor.constraint(equalTo: trailingAnchor),
      glassView.topAnchor.constraint(equalTo: topAnchor),
      glassView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    if #available(iOS 26.0, *) {
      let effect = UIGlassEffect(style: .regular)
      effect.isInteractive = true
      glassView.effect = effect
    } else {
      glassView.effect = UIBlurEffect(style: .systemMaterial)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    glassView.layer.cornerRadius = bounds.height / 2
  }
}
