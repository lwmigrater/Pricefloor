declare module "*.css";

// Polaris Web Components TypeScript Definitions
declare namespace JSX {
  interface IntrinsicElements {
    // Layout Components
    "s-page": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      heading?: string;
    };
    "s-section": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      heading?: string;
      padding?: string;
    };
    "s-stack": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      gap?: string;
      "block-align"?: string;
      "inline-align"?: string;
    };
    "s-box": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      padding?: string;
      background?: string;
      "border-radius"?: string;
    };
    "s-grid": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      columns?: string;
      gap?: string;
    };
    "s-divider": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-card": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    // Actions Components
    "s-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      variant?: "primary" | "secondary" | "tertiary" | "plain" | "monochromePlain";
      size?: "small" | "medium" | "large";
      loading?: boolean;
      disabled?: boolean;
      type?: "button" | "submit" | "reset";
      url?: string;
    };
    "s-button-group": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      variant?: "segmented" | "default";
      gap?: string;
      noWrap?: boolean;
    };
    "s-link": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      href?: string;
      target?: "_blank" | "_self" | "_parent" | "_top";
    };
    "s-clickable": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    // Form Components
    "s-text-field": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      label?: string;
      value?: string;
      placeholder?: string;
      type?: string;
      error?: string;
      disabled?: boolean;
      autocomplete?: string;
      name?: string;
      details?: string;
    };
    "s-checkbox": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      label?: string;
      checked?: boolean;
      disabled?: boolean;
      name?: string;
    };
    "s-select": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      label?: string;
      value?: string;
      disabled?: boolean;
      name?: string;
    };
    "s-switch": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      label?: string;
      checked?: boolean;
      disabled?: boolean;
    };
    "s-text-area": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      label?: string;
      value?: string;
      placeholder?: string;
      disabled?: boolean;
    };
    "s-choice-list": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      title?: string;
      name?: string;
    };

    // Typography Components
    "s-text": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      variant?: string;
      tone?: string;
      as?: string;
    };
    "s-heading": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    };
    "s-paragraph": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    // Feedback Components
    "s-badge": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      tone?: "success" | "info" | "warning" | "critical" | "attention";
      size?: "small" | "medium" | "large";
    };
    "s-banner": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      tone?: "success" | "info" | "warning" | "critical";
    };
    "s-spinner": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      size?: "small" | "medium" | "large";
    };
    "s-tooltip": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      content?: string;
    };

    // Media Components
    "s-icon": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      source?: string;
      tone?: string;
    };
    "s-image": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      source?: string;
      alt?: string;
    };
    "s-avatar": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      source?: string;
      name?: string;
      size?: "small" | "medium" | "large";
    };
    "s-chip": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    // Navigation Components
    "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      open?: boolean;
      "command-for"?: string;
    };

    // Overlay Components
    "s-modal": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      open?: boolean;
      title?: string;
    };
    "s-popover": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      open?: boolean;
    };

    // List Components
    "s-unordered-list": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-ordered-list": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-list-item": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
  }
}
