import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      <body className={geistSans.variable + " " + geistMono.variable}>
        {children}
      </body>
    </html>
  );
}
