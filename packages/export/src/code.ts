/**
 * How a library's components are written in code: a `<library>.code.json` file next to the `.lib.pen`
 * (nib's bundled design systems ship one). The React exporter writes instances of mapped components as
 * those components, and colors that come from the library's variables as its CSS variables.
 */
export interface CodeMap {
  /** The library it describes, e.g. "shadcn/ui". */
  library: string;
  /** How a project gets these components (shown in the export's header comment). */
  setup?: string;
  /** Variables that are CSS custom properties in the library's code (and Tailwind colors): primary, border. */
  tokens: string[];
  /** Variables whose values the app's own styles already set (the library's font): left out of the code. */
  inherited?: string[];
  components: Record<string, ComponentCode>;
}

/**
 * One component as JSX. `template` holds placeholders filled from the instance:
 * - `{class}` the instance's own classes (size, position in its parent) as ` className="…"`; `{class:a b}` adds `a b`.
 * - `{text:key}` the text of the part `key` (an override key: "button-label", "field-label/label-text").
 * - `{attr:key}` the same, for an attribute value; `{slug:key}` it as an id (`email-address`).
 * - `{icon:key}` the part's icon as a lucide-react component.
 * - `{children:key}` the part's children written as code; `{children:.}` the instance's own.
 * - `{node:key}` the part itself written as code.
 * - `{layout:key}` the part's own layout (direction, gap, alignment) as ` className="…"`, for a part whose
 *   children the instance replaced.
 * - `{if:key}…{/if}` only when the part is shown.
 */
export interface ComponentCode {
  template: string;
  /** Names the template uses, and where they come from: { Button: "@/components/ui/button" }. */
  imports: Record<string, string>;
}
