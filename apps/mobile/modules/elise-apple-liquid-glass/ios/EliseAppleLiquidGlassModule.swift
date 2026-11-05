import ExpoModulesCore

public final class EliseAppleLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EliseAppleLiquidGlass")

    View(EliseAppleLiquidGlassView.self) {}
  }
}
