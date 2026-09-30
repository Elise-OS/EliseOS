require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MichelAppleLiquidGlass'
  s.version        = package['version']
  s.summary        = 'Native Liquid Glass view for the Élise iOS interface.'
  s.description    = 'Provides an iOS Liquid Glass background view to the Élise mobile app through Expo Modules.'
  s.homepage       = 'https://github.com/Elise-OS/EliseOS'
  s.source         = { :git => 'https://github.com/Elise-OS/EliseOS.git' }
  s.license        = { :type => 'MIT' }
  s.author         = 'Michel'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
