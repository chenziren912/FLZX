"use client";

import { marked } from "marked";
import { useEffect, useState } from "react";

type MarkdownPreviewProps = {
  source: string;
  className?: string;
  emptyText?: string;
};

export default function MarkdownPreview({
  source,
  className = "",
  emptyText = "Markdown 内容会在这里实时预览。",
}: MarkdownPreviewProps) {
  const [html, setHtml] = useState("");
  const [renderedSource, setRenderedSource] = useState("");
  const rootClassName = ["markdown-body", className].filter(Boolean).join(" ");

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) {
      return () => {
        cancelled = true;
      };
    }

    async function render() {
      try {
        const rawHtml = await marked.parse(source, {
          breaks: true,
          gfm: true,
        });
        const { default: createDOMPurify } = await import("dompurify");
        const safeHtml = createDOMPurify(window).sanitize(rawHtml);
        if (!cancelled) {
          setHtml(safeHtml);
          setRenderedSource(source);
        }
      } catch {
        if (!cancelled) {
          setHtml("");
          setRenderedSource(source);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (!source.trim()) {
    return (
      <div className={rootClassName}>
        <p className="markdown-empty">{emptyText}</p>
      </div>
    );
  }

  const renderedHtml = renderedSource === source ? html : "";

  return (
    <div
      className={rootClassName}
      dangerouslySetInnerHTML={{
        __html: renderedHtml || '<p class="markdown-empty">正在生成预览…</p>',
      }}
    />
  );
}
