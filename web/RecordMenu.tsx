/**
 * The record page's "⋯" button: a short list of actions kept out of sight until wanted.
 *
 * It follows the menu button pattern. A click, Enter, Space or Down opens it on the first action
 * (Up on the last); the arrow keys, Home and End move between actions; Escape, Tab or a click
 * outside closes it, and focus goes back to the button.
 */
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Drawn in the critical colour: it destroys something. */
  danger?: boolean;
}

export function ActionsMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<"first" | "last">("first");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  const enabled = () => items.current.filter((el): el is HTMLButtonElement => el !== null && !el.disabled);

  useEffect(() => {
    if (!open) return;
    const list = enabled();
    (start === "last" ? list[list.length - 1] : list[0])?.focus();

    function onPointerDown(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, start]);

  function openAt(where: "first" | "last") {
    setStart(where);
    setOpen(true);
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    openAt(e.key === "ArrowUp" ? "last" : "first");
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = enabled();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    switch (e.key) {
      case "ArrowDown":
        next = list[at < 0 || at === list.length - 1 ? 0 : at + 1];
        break;
      case "ArrowUp":
        next = list[at <= 0 ? list.length - 1 : at - 1];
        break;
      case "Home":
        next = list[0];
        break;
      case "End":
        next = list[list.length - 1];
        break;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    next?.focus();
  }

  function choose(action: MenuAction) {
    setOpen(false);
    trigger.current?.focus();
    action.onSelect();
  }

  return (
    <div className="rec-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="rec-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? setOpen(false) : openAt("first"))}
        onKeyDown={onTriggerKey}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div id={id} role="menu" aria-label={label} className="rec-menu-panel" onKeyDown={onMenuKey}>
          {actions.map((action, i) => (
            <button
              key={action.key}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={action.danger ? "rec-menu-item rec-menu-danger" : "rec-menu-item"}
              disabled={action.disabled}
              onClick={() => choose(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A ref for the control that opened something, such as a form; when that thing closes, focus
 * goes back to the control instead of being lost.
 */
export function useReturnFocus<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open) ref.current?.focus();
    was.current = open;
  }, [open]);
  return ref;
}
