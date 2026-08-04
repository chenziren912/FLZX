"use client";

import { marked } from "marked";
import { useDeferredValue, useEffect, useState } from "react";

type MarkdownPreviewProps = {
  source: string;
  className?: string;
  emptyText?: string;
};

const ALLOWED_IFRAME_HOSTS = new Set([
  "player.bilibili.com",
  "player.vimeo.com",
  "www.youtube.com",
  "www.youtube-nocookie.com",
]);

let sanitizerPromise: Promise<(rawHtml: string) => string> | null = null;

function isAllowedIframeSource(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:" || !ALLOWED_IFRAME_HOSTS.has(url.hostname)) {
      return false;
    }
    if (url.hostname === "player.bilibili.com") {
      return url.pathname === "/player.html";
    }
    if (
      url.hostname === "www.youtube.com" ||
      url.hostname === "www.youtube-nocookie.com"
    ) {
      return url.pathname.startsWith("/embed/");
    }
    return url.pathname.startsWith("/video/");
  } catch {
    return false;
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
          const source = iframe.getAttribute("src") ?? "";
          if (!isAllowedIframeSource(source)) {
            iframe.remove();
            return;
          }
          iframe.setAttribute("loading", "lazy");
          iframe.setAttribute("referrerpolicy", "no-referrer");
          iframe.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-presentation",
          );
        });
        return template.innerHTML;
      };
    });
  }
  return sanitizerPromise;
}

export default function MarkdownPreview({
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
