"use client";

import { useState } from "react";

/**
 * Free-text input for packaging unit names (carton, sachet, strip, ...) with prefix-matched
 * autocomplete — suggestions start narrowing from the first letter typed. Stays free text on
 * purpose (pharmacy packaging vocabulary is too varied to lock into a fixed dropdown); this just
 * makes typing a name that's been used before faster.
 */
export default function UnitNameInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const typed = value.trim().toLowerCase();
  const matches =
    typed.length > 0
      ? suggestions.filter((s) => s.toLowerCase().startsWith(typed) && s.toLowerCase() !== typed).slice(0, 8)
      : [];

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full min-w-[8rem] rounded border border-zinc-200 bg-white text-sm shadow-lg">
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-teal-50"
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
