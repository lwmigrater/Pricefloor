import React from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import styles from "./RichTextEditor.module.css";

/**
 * RichTextEditor Component
 *
 * IMPORTANT: This component requires react-quill package.
 * Install with: npm install react-quill
 *
 * You also need to import the CSS:
 * import "react-quill/dist/quill.snow.css";
 *
 * Example usage:
 * ```tsx
 * import { RichTextEditor } from "@/feature/bite/components/templates/RichTextEditor/RichTextEditor";
 * import "react-quill/dist/quill.snow.css";
 *
 * const [content, setContent] = useState("");
 *
 * <RichTextEditor
 *   value={content}
 *   onChange={(value) => setContent(value)}
 *   label="Description"
 *   placeholder="Enter description..."
 * />
 * ```
 */

export interface RichTextEditorProps {
  bounds?: string;
  defaultValue?: any;
  formats?: string[];
  id?: string;
  modules?: {
    toolbar?: any;
    clipboard?: any;
  };
  onBlur?: (previousRange: any, source: string, editor: any) => void;
  onChange?: (content: string, delta: any, source: string, editor: any) => void;
  onChangeSelection?: (range: any, source: string, editor: any) => void;
  onFocus?: (range: any, source: string, editor: any) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyPress?: (event: KeyboardEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  placeholder?: string;
  preserveWhitespace?: boolean;
  value?: string;
  label?: string;
  labelHidden?: boolean;
  disabled?: boolean;
  error?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  label,
  labelHidden = false,
  error,
  placeholder,
  value,
  onChange,
  disabled,
  modules,
  ...props
}) => {
  const defaultModules = {
    toolbar: [
      ["bold", "italic", "underline", "blockquote"],
      [{ list: "ordered" }, { list: "bullet" }],
      [{ indent: "-1" }, { indent: "+1" }],
      ["link"],
      ["clean"],
    ],
  };

  return (
    <div className={styles.container}>
      {label && !labelHidden && (
        <label className={styles.label}>
          {label}
          {error && (
            <span className={styles.error}>
              {error}
            </span>
          )}
        </label>
      )}
      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules || defaultModules}
        placeholder={placeholder}
        readOnly={disabled}
        className={error ? styles.editorError : ""}
        {...props}
      />
    </div>
  );
};
