// PDF 각 쪽을 PNG 로 렌더한다 (macOS PDFKit).
// 사용: swift build/render-pages.swift <input.pdf> <outDir> [dpi=110] [first] [last]
// 출력: <outDir>/p-001.png, p-002.png, ...
import Foundation
import PDFKit
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: render-pages.swift <input.pdf> <outDir> [dpi] [first] [last]\n".data(using: .utf8)!)
  exit(2)
}
let input = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
let dpi = args.count > 3 ? (Double(args[3]) ?? 110) : 110
guard let doc = PDFDocument(url: input) else {
  FileHandle.standardError.write("cannot open \(input.path)\n".data(using: .utf8)!)
  exit(1)
}
let first = args.count > 4 ? max(1, Int(args[4]) ?? 1) : 1
let last = args.count > 5 ? min(doc.pageCount, Int(args[5]) ?? doc.pageCount) : doc.pageCount
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let scale = dpi / 72.0
var written = 0
for i in (first - 1)..<last {
  guard let page = doc.page(at: i) else { continue }
  let box = page.bounds(for: .mediaBox)
  let w = Int((box.width * scale).rounded())
  let h = Int((box.height * scale).rounded())
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  ctx.translateBy(x: -box.origin.x, y: -box.origin.y)
  page.draw(with: .mediaBox, to: ctx)
  guard let img = ctx.makeImage() else { continue }
  let rep = NSBitmapImageRep(cgImage: img)
  guard let png = rep.representation(using: .png, properties: [:]) else { continue }
  let name = String(format: "p-%03d.png", i + 1)
  try png.write(to: outDir.appendingPathComponent(name))
  written += 1
}
print("rendered \(written) page(s) -> \(outDir.path)")
