// QR 판독 (macOS Vision). 인쇄 감리 r1 의 tmp/print-qa/qrscan.swift 를 빌드 검사용으로 옮겼다.
// usage: swift build/qrscan.swift <dpi> <png>...
// prints: file \t version \t ecLevel \t widthMM \t heightMM \t x_mm \t y_mm(top) \t payload
import Foundation
import Vision
import AppKit
import CoreImage

let args = CommandLine.arguments
let dpi = Double(args[1]) ?? 300
let pxPerMM = dpi / 25.4
for path in args.dropFirst(2) {
  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("\(path)\tERR_LOAD"); continue
  }
  let W = Double(cg.width), H = Double(cg.height)
  let req = VNDetectBarcodesRequest()
  req.symbologies = [.qr]
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  do { try handler.perform([req]) } catch { print("\(path)\tERR \(error)"); continue }
  let obs = (req.results ?? []).sorted { a, b in
    if abs(a.boundingBox.minY - b.boundingBox.minY) > 0.02 { return a.boundingBox.minY > b.boundingBox.minY }
    return a.boundingBox.minX < b.boundingBox.minX
  }
  if obs.isEmpty { print("\((path as NSString).lastPathComponent)\tNONE") }
  for o in obs {
    let bb = o.boundingBox
    let wmm = bb.width * W / pxPerMM
    let hmm = bb.height * H / pxPerMM
    let xmm = bb.minX * W / pxPerMM
    let ymm = (1 - bb.maxY) * H / pxPerMM
    var ver = -1
    var ec = "?"
    if let d = o.barcodeDescriptor as? CIQRCodeDescriptor {
      ver = d.symbolVersion
      switch d.errorCorrectionLevel { case .levelL: ec = "L"; case .levelM: ec = "M"; case .levelQ: ec = "Q"; case .levelH: ec = "H"; @unknown default: ec = "?" }
    }
    let payload = o.payloadStringValue ?? "<nil>"
    print(String(format: "%@\tv%d\t%@\t%.1f\t%.1f\t%.1f\t%.1f\t%@", (path as NSString).lastPathComponent, ver, ec, wmm, hmm, xmm, ymm, payload))
  }
}
