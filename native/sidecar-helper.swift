// =============================================================================
// SIDECAR HELPER
// A tiny CLI the Native engine shells out to. Connect/disconnect via the private
// SidecarCore framework; mirror/main state and control via public CoreGraphics.
// -----------------------------------------------------------------------------
// Commands (JSON on stdout; errors on stderr + non-zero exit):
//   list                 -> {"devices":["Name", ...]}
//   connect <name>       -> {"ok":true}
//   disconnect <name>    -> {"ok":true}
//   status               -> {"present":bool,"main":bool,"mirrored":bool}
//   extend               -> {"ok":true}   (un-mirror the Sidecar display)
//   mirror               -> {"ok":true}   (mirror the Sidecar display onto main)
// -----------------------------------------------------------------------------
// WARN: `extend`/`mirror` only ever reconfigure the Sidecar display, always
//   keeping the current main display as the mirror master. The main display is
//   never reassigned, and no display is disconnected.
// NOTE: SidecarCore is a private framework, loaded at runtime via dlopen so the
//   binary links nothing private. Selectors may change across macOS releases.
// =============================================================================

import AppKit
import CoreGraphics
import Foundation

// -----------------------------------------------------------
// OUTPUT
// -----------------------------------------------------------

func emit(_ json: String) {
    print(json)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func boolJSON(_ value: Bool) -> String { value ? "true" : "false" }

// -----------------------------------------------------------
// SIDECARCORE (private, runtime-dispatched)
// -----------------------------------------------------------

func sidecarManager() -> NSObject {
    guard dlopen("/System/Library/PrivateFrameworks/SidecarCore.framework/SidecarCore", RTLD_LAZY) != nil else {
        fail("Could not load SidecarCore.framework")
    }
    guard let cls = NSClassFromString("SidecarDisplayManager") as? NSObject.Type,
          let manager = cls.perform(NSSelectorFromString("sharedManager"))?.takeUnretainedValue() as? NSObject
    else {
        fail("SidecarDisplayManager unavailable (macOS may have changed the private API)")
    }
    return manager
}

func sidecarDevices(_ manager: NSObject) -> [NSObject] {
    (manager.perform(NSSelectorFromString("devices"))?.takeUnretainedValue() as? [NSObject]) ?? []
}

func deviceName(_ device: NSObject) -> String {
    (device.perform(NSSelectorFromString("name"))?.takeUnretainedValue() as? String) ?? ""
}

func findDevice(named target: String) -> (NSObject, NSObject) {
    let manager = sidecarManager()
    for device in sidecarDevices(manager) where deviceName(device) == target {
        return (manager, device)
    }
    fail("No Sidecar device named \"\(target)\"")
}

/// Runs a `...completion:` selector and waits for its NSError? callback.
func runWithCompletion(_ selector: String, _ manager: NSObject, _ device: NSObject) {
    let sel = NSSelectorFromString(selector)
    guard manager.responds(to: sel) else { fail("Selector \(selector) unavailable") }

    let semaphore = DispatchSemaphore(value: 0)
    var failure: NSError?
    let completion: @convention(block) (NSError?) -> Void = { error in
        failure = error
        semaphore.signal()
    }
    _ = manager.perform(sel, with: device, with: completion)

    if semaphore.wait(timeout: .now() + 20) == .timedOut {
        fail("Timed out running \(selector)")
    }
    if let failure = failure {
        fail("\(selector) failed: \(failure.localizedDescription)")
    }
}

// -----------------------------------------------------------
// COREGRAPHICS (public)
// -----------------------------------------------------------

// Apple's AirPlay/Sidecar display vendor number: the ASCII bytes "aapl".
let AIRPLAY_VENDOR: UInt32 = 0x6161_706C

/// CGDirectDisplayIDs whose NSScreen name marks them as Sidecar/AirPlay.
///
/// NOTE: NSScreen omits displays that are in a mirror set, so this finds the
///   Sidecar display only while it is extended. The vendor check below is what
///   still finds it once it has been folded into a mirror set.
func namedSidecarDisplayIDs() -> Set<CGDirectDisplayID> {
    var ids = Set<CGDirectDisplayID>()
    for screen in NSScreen.screens {
        let name = screen.localizedName
        guard name.localizedCaseInsensitiveContains("sidecar") || name.localizedCaseInsensitiveContains("airplay")
        else { continue }
        if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32 {
            ids.insert(CGDirectDisplayID(number))
        }
    }
    return ids
}

/// The CGDirectDisplayID of the online Sidecar display, if one is present.
///
/// NOTE: Uses the CoreGraphics online list (which, unlike NSScreen, includes
///   mirrored displays) so the Sidecar display is found whether it is extended
///   or mirrored. A display qualifies if it carries the AirPlay vendor signature
///   or matches a Sidecar-named NSScreen.
func sidecarDisplayID() -> CGDirectDisplayID? {
    let named = namedSidecarDisplayIDs()
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    guard CGGetOnlineDisplayList(16, &ids, &count) == .success else { return nil }
    for id in ids.prefix(Int(count)) where CGDisplayIsBuiltin(id) == 0 {
        if CGDisplayVendorNumber(id) == AIRPLAY_VENDOR || named.contains(id) {
            return id
        }
    }
    return nil
}

func setMirror(of display: CGDirectDisplayID, master: CGDirectDisplayID) {
    var config: CGDisplayConfigRef?
    guard CGBeginDisplayConfiguration(&config) == .success, let config else {
        fail("Could not begin a display configuration")
    }
    let result = CGConfigureDisplayMirrorOfDisplay(config, display, master)
    guard result == .success else {
        CGCancelDisplayConfiguration(config)
        fail("Could not configure mirroring (error \(result.rawValue))")
    }
    guard CGCompleteDisplayConfiguration(config, .permanently) == .success else {
        fail("Could not apply the display configuration")
    }
}

// -----------------------------------------------------------
// COMMANDS
// -----------------------------------------------------------

let args = CommandLine.arguments

switch args.count >= 2 ? args[1] : "" {
case "list":
    let names = sidecarDevices(sidecarManager()).map(deviceName).filter { !$0.isEmpty }
    let joined = names.map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" }.joined(separator: ",")
    emit("{\"devices\":[\(joined)]}")

case "connect":
    guard args.count >= 3 else { fail("usage: connect <name>") }
    let (manager, device) = findDevice(named: args[2])
    runWithCompletion("connectToDevice:completion:", manager, device)
    emit("{\"ok\":true}")

case "disconnect":
    guard args.count >= 3 else { fail("usage: disconnect <name>") }
    let (manager, device) = findDevice(named: args[2])
    runWithCompletion("disconnectFromDevice:completion:", manager, device)
    emit("{\"ok\":true}")

case "status":
    if let id = sidecarDisplayID() {
        let main = CGDisplayIsMain(id) != 0
        let mirrored = CGDisplayIsInMirrorSet(id) != 0
        emit("{\"present\":true,\"main\":\(boolJSON(main)),\"mirrored\":\(boolJSON(mirrored))}")
    } else {
        emit("{\"present\":false,\"main\":false,\"mirrored\":false}")
    }

case "extend":
    guard let id = sidecarDisplayID() else { fail("No Sidecar display is present") }
    setMirror(of: id, master: kCGNullDirectDisplay)
    emit("{\"ok\":true}")

case "mirror":
    guard let id = sidecarDisplayID() else { fail("No Sidecar display is present") }
    let main = CGMainDisplayID()
    if main == id { fail("The Sidecar display is the main display; refusing to mirror onto it") }
    setMirror(of: id, master: main)
    emit("{\"ok\":true}")

default:
    fail("usage: sidecar-helper [list|connect <name>|disconnect <name>|status|extend|mirror]")
}
