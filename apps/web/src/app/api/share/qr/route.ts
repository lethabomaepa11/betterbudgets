import { NextRequest } from "next/server";
import QRCode from "qrcode";

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("data");
  if (!value || value.length > 1800) {
    return new Response("A QR payload is required and must be under 1800 characters.", {
      status: 400,
    });
  }

  const svg = await QRCode.toString(value, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
