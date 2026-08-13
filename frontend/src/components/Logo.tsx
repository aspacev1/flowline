import type { SVGProps } from "react";

/**
 * Товарный знак Planora.
 *
 * Значок и надпись разведены по двум компонентам, а не собраны в один с
 * необязательным текстом: значку одному находится место там, где имени не
 * поместится — вкладка браузера, фавикон, — и в этих местах он не тащит за
 * собой проп, который всегда стоял бы в одно и то же значение.
 */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" {...props}>
      <path
        fill="#2952f5"
        d="M14 6h28a16 16 0 0 1 16 16v2a10 10 0 0 1-10 10H34q-12 0-12 10v4a8 8 0 0 1-8 8h2a10 10 0 0 1-10-10V14a8 8 0 0 1 8-8Z"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`logo${className ? ` ${className}` : ""}`}>
      <LogoMark className="logo__mark" width={28} height={28} />
      <span className="logo__word">Planora</span>
    </span>
  );
}
