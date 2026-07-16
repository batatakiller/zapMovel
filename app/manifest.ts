import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZapMóvel",
    short_name: "ZapMóvel",
    description: "WhatsApp via Evolution API",
    start_url: "/",
    display: "standalone",
    background_color: "#0b141a",
    theme_color: "#008069",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
