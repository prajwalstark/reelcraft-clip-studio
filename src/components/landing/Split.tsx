import { Fragment, type ElementType, type ReactNode } from "react";

/**
 * SSR-safe text splitter. Renders each character in its own span (grouped by word so lines
 * never break mid-word). The full string stays available to assistive tech via aria-label.
 */
export function SplitChars({
  text,
  className,
  charClassName = "",
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  charClassName?: string;
  as?: ElementType;
}) {
  const words = text.split(" ");
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, wi) => (
        <Fragment key={wi}>
          <span aria-hidden className="inline-block whitespace-nowrap">
            {Array.from(w).map((ch, ci) => (
              <span key={ci} className={`split-char ${charClassName}`}>
                {ch}
              </span>
            ))}
          </span>
          {wi < words.length - 1 && <span aria-hidden> </span>}
        </Fragment>
      ))}
    </Tag>
  );
}

/** Splits into words, each wrapped in an overflow mask for slide-up reveals. */
export function SplitWords({
  text,
  className,
  wordClassName = "",
}: {
  text: string;
  className?: string;
  wordClassName?: string;
}) {
  return (
    <span className={className} aria-label={text}>
      {text.split(" ").map((w, i, arr) => (
        <Fragment key={i}>
          <span
            aria-hidden
            className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom"
          >
            <span className={`split-word inline-block will-change-transform ${wordClassName}`}>
              {w}
            </span>
          </span>
          {i < arr.length - 1 && <span aria-hidden> </span>}
        </Fragment>
      ))}
    </span>
  );
}

export function Line({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`line-mask ${className}`}>
      <span className="split-line block will-change-transform">{children}</span>
    </span>
  );
}
