"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── Spotlight que sigue al cursor ─────────────────────────────────────────── */

export function Spotlight({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
      el.dataset.active = "true";
    };
    const leave = () => {
      el.dataset.active = "false";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={ref} className={`ui-spot ${className}`} data-active="false">
      {children}
    </div>
  );
}

/* ── Tilt de parálax ──────────────────────────────────────────────────────── */

export function Tilt({
  children,
  max = 7,
  className = "",
  style,
}: {
  children: ReactNode;
  max?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = wrap.current;
    const i = inner.current;
    if (!w || !i || reduced() || !window.matchMedia("(pointer: fine)").matches)
      return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = w.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        i.style.setProperty("--ry", `${px * max * 2}deg`);
        i.style.setProperty("--rx", `${-py * max * 2}deg`);
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      i.style.setProperty("--ry", "0deg");
      i.style.setProperty("--rx", "0deg");
    };
    w.addEventListener("pointermove", move);
    w.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      w.removeEventListener("pointermove", move);
      w.removeEventListener("pointerleave", leave);
    };
  }, [max]);

  return (
    <div ref={wrap} className={`ui-tilt ${className}`} style={style}>
      <div ref={inner} className="ui-tilt-inner">
        {children}
      </div>
    </div>
  );
}

/* ── Botón magnético ──────────────────────────────────────────────────────── */

export function Magnetic({
  children,
  strength = 0.32,
  className = "",
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || !window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = "translate(0, 0)";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);

  return (
    <span
      ref={ref}
      className={`inline-block transition-transform duration-300 ${className}`}
      style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
    >
      {children}
    </span>
  );
}

/* ── Contador que sube al entrar en viewport ──────────────────────────────── */

export function CountUp({
  to,
  suffix = "",
  duration = 1400,
  className = "",
}: {
  to: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (reduced()) {
      const id = window.setTimeout(() => setVal(to), 0);
      return () => clearTimeout(id);
    }
    let raf = 0;
    let cancelled = false;
    let safety = 0;

    const animate = () => {
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / duration);
        setVal(Math.round(to * (1 - Math.pow(1 - t, 3))));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      // Si rAF va throttled (pestaña en segundo plano), garantiza el valor final.
      safety = window.setTimeout(() => {
        if (!cancelled) setVal(to);
      }, duration + 250);
    };

    const el = ref.current;
    const visible =
      el && el.getBoundingClientRect().top < window.innerHeight * 0.9;

    let io: IntersectionObserver | undefined;
    let timer = 0;
    if (visible) {
      timer = window.setTimeout(animate, 250);
    } else if (el) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            animate();
          }
        },
        { threshold: 0.3 },
      );
      io.observe(el);
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(safety);
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {val.toLocaleString("es-CL")}
      {suffix}
    </span>
  );
}

/* ── Titular revelado palabra por palabra ─────────────────────────────────── */

export function Words({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(" ");
  return (
    <span className={`ui-words ${className}`}>
      {parts.map((w, i) => (
        <span key={`${w}-${i}`} style={{ ["--i" as string]: i }}>
          {w}
          {i < parts.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
