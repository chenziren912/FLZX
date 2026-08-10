import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "西安铁一中 - 校园娱乐墙",
  description: "西安铁一中的学生娱乐交流墙，畅所欲言，分享点滴。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
