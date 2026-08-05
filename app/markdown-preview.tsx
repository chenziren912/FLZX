"use client";

import { marked } from "marked";
import { memo, useDeferredValue, useEffect, useState } from "react";

type MarkdownPreviewProps = {
  source: string;
  className?: string;
  emptyText?: string;
};

const ALLOWED_IFRAME_HOSTS = new Set([
  "player.bilibili.com",
  "player.vimeo.com",
  "m.youtube.com",
  "youtube.com",
  "www.youtube.com",
  "www.youtube-nocookie.com",
]);

const YOUTUBE_IFRAME_HOSTS = new Set([
  "m.youtube.com",
  "youtube.com",
  "www.youtube.com",
  "www.youtube-nocookie.com",
]);

let sanitizerPromise: Promise<(rawHtml: string) => string> | null = null;

function resolveIframeSource(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : "https://" + trimmed;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function iframeDecision(value: string) {
  const url = resolveIframeSource(value);
  if (!url) {
    return { url: null, message: "此 iframe 缺少有效的 HTTPS 地址。" };
  }
  if (url.protocol !== "https:") {
    return { url: null, message: "为保护安全，仅支持 HTTPS iframe。" };
  }
  if (!ALLOWED_IFRAME_HOSTS.has(url.hostname)) {
    return {
      url: null,
      message: "此来源暂不在安全嵌入名单中，仅支持 Bilibili、YouTube 和 Vimeo。",
    };
  }
  if (url.hostname === "player.bilibili.com") {
    return url.pathname === "/player.html"
      ? { url, message: "" }
      : { url: null, message: "Bilibili iframe 必须使用 player.html 播放地址。" };
  }
  if (YOUTUBE_IFRAME_HOSTS.has(url.hostname)) {
    return url.pathname.startsWith("/embed/")
      ? { url, message: "" }
      : { url: null, message: "YouTube iframe 必须使用 /embed/ 视频地址。" };
  }
  return url.pathname.startsWith("/video/")
    ? { url, message: "" }
    : { url: null, message: "Vimeo iframe 必须使用 /video/ 播放地址。" };
}

function iframeWarning(message: string) {
  const warning = document.createElement("div");
  warning.className = "markdown-embed-warning";
  warning.setAttribute("role", "note");
  warning.textContent = "安全提示：" + message;
  return warning;
}

function configureIframe(iframe: HTMLIFrameElement) {
  const decision = iframeDecision(iframe.getAttribute("src") ?? "");
  if (!decision.url) {
    iframe.replaceWith(iframeWarning(decision.message));
    return;
  }
  iframe.setAttribute("src", decision.url.href);
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
  );
  iframe.setAttribute("allowfullscreen", "");
  if (YOUTUBE_IFRAME_HOSTS.has(decision.url.hostname)) {
    // YouTube requires a real referrer/origin and does not reliably initialize
    // inside a sandboxed document (it can surface player error 153).
    iframe.removeAttribute("sandbox");
  } else {
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
  }
}

function getSanitizer() {
  if (!sanitizerPromise) {
    sanitizerPromise = import("dompurify").then(({ default: createDOMPurify }) => {
      const purifier = createDOMPurify(window);
      return (rawHtml: string) => {
        const safeHtml = purifier.sanitize(rawHtml, {
          ADD_TAGS: ["iframe"],
          ADD_ATTR: [
            "allow",
            "allowfullscreen",
            "height",
            "loading",
            "referrerpolicy",
            "sandbox",
            "title",
            "width",
          ],
          FORBID_TAGS: ["base", "embed", "form", "meta", "object", "script", "style"],
        });
        const template = document.createElement("template");
        template.innerHTML = String(safeHtml);
        template.content.querySelectorAll("iframe").forEach((iframe) => {
          configureIframe(iframe);
        });
        return template.innerHTML;
      };
    });
  }
  return sanitizerPromise;
}

function MarkdownPreview({
  source,
  className = "",
  emptyText = "Markdown 内容会在这里实时预览。",
}: MarkdownPreviewProps) {
  const [html, setHtml] = useState("");
  const previewSource = useDeferredValue(source);
  const rootClassName = ["markdown-body", className].filter(Boolean).join(" ");

  useEffect(() => {
    let cancelled = false;
    if (!previewSource.trim()) {
      return () => {
        cancelled = true;
      };
    }

    async function render() {
      try {
        const rawHtml = await marked.parse(previewSource, {
          breaks: true,
          gfm: true,
        });
        const safeHtml = await (await getSanitizer())(String(rawHtml));
        if (!cancelled) {
          setHtml(safeHtml);
        }
      } catch {
        if (!cancelled) {
          setHtml("");
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [previewSource]);

  if (!source.trim()) {
    return (
      <div className={rootClassName}>
        <p className="markdown-empty">{emptyText}</p>
      </div>
    );
  }

  const renderedHtml = previewSource.trim() ? html : "";

  return (
    <div
      className={rootClassName}
      dangerouslySetInnerHTML={{
        __html: renderedHtml || '<p class="markdown-empty">正在生成预览…</p>',
      }}
    />
  );
}

// The wall polls for new posts periodically. Keep an unchanged preview, and
// especially its YouTube iframe, mounted while that parent refreshes.
export default memo(MarkdownPreview);
