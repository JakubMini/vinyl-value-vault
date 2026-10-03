/**
 * A small menu behind a button, for the collection's toolbar and selection bar. The arrow keys,
 * Home and End move through the items; Escape closes it and puts focus back on the button; Tab
 * or a click anywhere else closes it.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

interface MenuProps {
  /** What the button shows. */
  trigger: ReactNode;
  /** The menu's name, and the button's too when it shows only an icon. */
  label: string;
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
  /** The edge of the button the menu lines up with. */
  align?: "start" | "end";
  /** Open above the button, for a bar at the bottom of the screen. */
  up?: boolean;
  children: (close: () => void) => ReactNode;
}

export function Menu({ trigger, label, iconOnly = false, className = "button", disabled, align = "end", up = false, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const startAt = useRef<"first" | "last">("first");

  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const list = items();
    (startAt.current === "last" ? list[list.length - 1] : list[0])?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!panel.current?.contains(e.target as Node)) return;
    const list = items();
    const at = list.indexOf(e.target as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
  }

  return (
    <div className="cmenu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => {
          startAt.current = "first";
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          e.preventDefault();
          startAt.current = e.key === "ArrowUp" ? "last" : "first";
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open ? (
        // Focusable itself, so a click on a heading inside keeps focus in the menu.
        <div id={id} ref={panel} role="menu" aria-label={label} tabIndex={-1} className={`cmenu-panel cmenu-${align}${up ? " cmenu-up" : ""}`}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ onSelect, disabled, title, children }: { onSelect: () => void; disabled?: boolean; title?: string; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} className="cmenu-item" disabled={disabled} title={title} onClick={onSelect}>
      {children}
    </button>
  );
}

/** An item that is ticked or not, and stays open when changed, so several can be changed in a row. */
export function MenuCheckbox({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} tabIndex={-1} className="cmenu-item" onClick={() => onChange(!checked)}>
      <span className="cmenu-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}

export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <div id={id} className="cmenu-heading">
        {label}
      </div>
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="cmenu-sep" />;
}
