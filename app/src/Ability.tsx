import { useState, type CSSProperties } from "react";

/** Current or potential ability (1–200) with a bar; negative potentials are ranges. Hidden until clicked. */
export function Ability({ value }: { value: number }) {
  const [revealed, setRevealed] = useState(false);
  const range = value < 0;
  const style = !range && revealed
    ? ({ "--fill": `${Math.min(100, value / 2)}%` } as CSSProperties)
    : undefined;

  return (
    <button
      type="button"
      className={`ability ability-reveal ${revealed ? "is-revealed" : "is-hidden"}${range ? " range" : ""}`}
      style={style}
      aria-label={revealed ? "CA/PA değerini gizle" : "CA/PA değerini göster"}
      aria-pressed={revealed}
      title={revealed ? "Değeri gizlemek için tıkla" : "Değeri görmek için tıkla"}
      onClick={(event) => {
        event.stopPropagation();
        setRevealed((shown) => !shown);
      }}
    >
      {revealed ? value : "★★★★★"}
    </button>
  );
}
