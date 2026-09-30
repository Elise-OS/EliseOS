import ExpoModulesCore

public final class MichelAppleLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MichelAppleLiquidGlass")

    View(MichelAppleLiquidGlassView.self) {}
  }
}
