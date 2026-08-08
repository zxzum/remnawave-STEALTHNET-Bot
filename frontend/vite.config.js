import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
const iconVersion = "?v=rounded";
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            selfDestroying: true,
            injectRegister: false,
            includeAssets: [
                "favicon.png",
                "favicon-16.png",
                "favicon-32.png",
                "apple-touch-icon.png",
            ],
            manifest: {
                name: "Лазейка VPN",
                short_name: "Лазейка VPN",
                description: "Лазейка ВПН — личный кабинет и админка VPN",
                lang: "ru",
                start_url: "/cabinet",
                scope: "/",
                display: "standalone",
                orientation: "portrait",
                background_color: "#0f172a",
                theme_color: "#0f172a",
                categories: ["productivity", "utilities"],
                icons: [
                    { src: `/icon-192.png${iconVersion}`, sizes: "192x192", type: "image/png", purpose: "any" },
                    { src: `/icon-512.png${iconVersion}`, sizes: "512x512", type: "image/png", purpose: "any" },
                    { src: `/icon-512-maskable.png${iconVersion}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
                ],
                shortcuts: [
                    {
                        name: "Кабинет",
                        short_name: "Кабинет",
                        description: "Личный кабинет: тарифы, подписки, подключения",
                        url: "/cabinet",
                        icons: [{ src: `/icon-192.png${iconVersion}`, sizes: "192x192" }],
                    },
                    {
                        name: "Админка",
                        short_name: "Админ",
                        description: "Управление клиентами и тарифами",
                        url: "/admin",
                        icons: [{ src: `/icon-192.png${iconVersion}`, sizes: "192x192" }],
                    },
                ],
            },
            devOptions: {
                enabled: false,
            },
        }),
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/leaflet") || id.includes("node_modules/react-leaflet") || id.includes("node_modules/@react-leaflet")) return "leaflet";
                    if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "recharts";
                    if (id.includes("node_modules/react-force-graph")) return "force-graph";
                    if (id.includes("node_modules/framer-motion")) return "framer";
                },
            },
        },
    },
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": { target: "http://localhost:5001", changeOrigin: true },
        },
    },
});
