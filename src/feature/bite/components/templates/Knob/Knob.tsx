import React from "react";
import styles from "./Knob.module.css";

export interface KnobProps {
  ariaLabel: string;
  selected: boolean;
  onClick: () => void;
}

export const Knob: React.FC<KnobProps> = ({ ariaLabel, selected, onClick }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={selected}
      className={styles.knob}
      data-selected={selected}
      onClick={onClick}
    >
      <span className={styles.knobIndicator} />
    </button>
  );
};
