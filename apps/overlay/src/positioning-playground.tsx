import { useEffect, useState, type RefObject } from "react";
import { useWindowSize, type EventPayload } from "@gpuix/react";
import { Floating } from "./floating/floating";
import { Shell } from "./screens/shell";
import { Action } from "./ui/action";
import { colors, column, editorTheme, layout, row, type } from "./theme";

export interface PositioningPlaygroundProps {
  readonly onBack: () => void;
  readonly keyboard: RefObject<(event: EventPayload) => void>;
}

/** An isolated fixture: no deck, study, generation, or persistence dependencies. */
export function PositioningPlayground({ onBack, keyboard }: PositioningPlaygroundProps) {
  const window = useWindowSize();
  const toolbarHeight = window.width < 360 ? 184 : window.width < 640 ? 144 : 104;
  const [position, setPosition] = useState<"top" | "middle" | "bottom">("top");
  const [narrow, setNarrow] = useState(false);
  const [right, setRight] = useState(false);
  const [actions, setActions] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [chosenAction, setChosenAction] = useState("");
  const hasDraft = text !== saved;
  const width = Math.max(120, Math.min(narrow ? 220 : 440, window.width - layout.rail - 48));
  const sceneHeight = Math.max(0, window.height - toolbarHeight - layout.footer);
  const cardHeight = width < 340 ? 150 : 110;
  const spacer =
    position === "top"
      ? 12
      : position === "bottom"
        ? Math.max(12, sceneHeight - cardHeight - 12)
        : Math.max(12, (sceneHeight - cardHeight) / 2);

  function save() {
    setSaved(text);
    setOpen(false);
  }
  useEffect(() => {
    keyboard.current = (event) => {
      if (event.key === "escape") {
        if (open) {
          setText(saved);
          setOpen(false);
        } else onBack();
      }
      if (!open && event.key === "c" && !event.modifiers?.cmd) setOpen(true);
    };
    return () => {
      keyboard.current = () => {};
    };
  }, [keyboard, open, saved, onBack]);

  return (
    <Shell
      onBack={onBack}
      onActions={() => setOpen(false)}
      notice={null}
      footer={{
        context: "Positioning playground",
        commands: [{ label: "Back", keys: "Esc", onClick: onBack }],
      }}
    >
      <div style={{ ...column, height: toolbarHeight, flexShrink: 0, padding: 16, gap: 10 }}>
        <text style={{ ...type.heading, color: colors.text }}>Floating content</text>
        <div style={{ ...row, gap: 8, flexWrap: "wrap" }}>
          {(["top", "middle", "bottom"] as const).map((p) => (
            <Action key={p} label={p} primary={position === p} onClick={() => setPosition(p)} />
          ))}
          <Action label={narrow ? "Wide card" : "Narrow card"} onClick={() => setNarrow(!narrow)} />
          <Action label={right ? "Move left" : "Move right"} onClick={() => setRight(!right)} />
          <Action
            label={actions ? "Textarea" : "Actions"}
            onClick={() => {
              setActions(!actions);
              setOpen(true);
            }}
          />
        </div>
      </div>
      <div
        testId="positioning-scroll"
        style={{ ...column, flexGrow: 1, minHeight: 0, overflowY: "scroll", overflowX: "hidden" }}
      >
        <div style={{ height: spacer, flexShrink: 0 }} />
        <div
          style={{
            ...row,
            justifyContent: right ? "flex-end" : "flex-start",
            paddingLeft: right ? 0 : 12,
            paddingRight: right ? 4 : 12,
            flexShrink: 0,
          }}
        >
          <Floating
            open={open}
            width={340}
            maxHeight={180}
            collisionPadding={12}
            gap={8}
            boundaryInsets={{ top: toolbarHeight, bottom: layout.footer, left: layout.rail }}
            onReferenceHidden={() => setOpen(false)}
            onClickOutside={() => setOpen(false)}
            style={{
              borderRadius: 7,
              borderWidth: 1,
              borderColor: colors.surfaceBorder,
              backgroundColor: colors.surface,
              padding: 8,
            }}
            reference={
              <div
                testId="positioning-card"
                style={{
                  ...column,
                  width,
                  height: cardHeight,
                  padding: 16,
                  gap: 8,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 6,
                  backgroundColor: colors.field,
                }}
              >
                <div style={{ ...row, justifyContent: "space-between", gap: 8 }}>
                  <text style={{ ...type.label, color: colors.muted }}>A simple reference</text>
                  <div
                    testId="comment-trigger"
                    tabIndex={0}
                    onClick={() => setOpen(true)}
                    style={{
                      width: 24,
                      height: 24,
                      ...row,
                      justifyContent: "center",
                      cursor: "pointer",
                      borderRadius: 4,
                      backgroundColor: open ? colors.highlight : colors.field,
                    }}
                  >
                    <svg
                      source={`<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M2 4h12v8H8l-4 3v-3H2z" fill="${saved ? colors.text : "none"}" stroke="${colors.text}" stroke-width="1.2"/>${hasDraft ? `<circle cx="15" cy="3" r="2.5" fill="${colors.text}" stroke="${colors.field}"/>` : ""}</svg>`}
                      style={{ width: 18, height: 18 }}
                    />
                  </div>
                </div>
                <text style={{ ...type.note, color: colors.text }}>
                  Keep this card readable while editing.
                </text>
                <text style={{ ...type.label, color: colors.muted }}>
                  Click the glyph or press C. Resize the window and scroll.
                </text>
              </div>
            }
          >
            {actions ? (
              <>
                <text
                  style={{ ...type.label, color: colors.muted, flexShrink: 0, paddingBottom: 8 }}
                >
                  Arbitrary content — native actions
                </text>
                <div style={{ ...column, minHeight: 0, overflowY: "scroll" }}>
                  {[
                    "Pin",
                    "Duplicate",
                    "Move",
                    "Archive",
                    "Inspect",
                    "Export",
                    "Share",
                    "Remove",
                  ].map((label) => (
                    <div
                      key={label}
                      onClick={() => {
                        setChosenAction(label);
                        setOpen(false);
                      }}
                      style={{
                        height: 32,
                        flexShrink: 0,
                        padding: 8,
                        cursor: "pointer",
                        hover: { backgroundColor: colors.highlight },
                      }}
                    >
                      <text style={{ ...type.body, color: colors.text }}>{label}</text>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <textarea
                  testId="comment-editor"
                  autoFocus
                  value={text}
                  onChange={(event) => setText(event.value ?? "")}
                  onSubmit={save}
                  minRows={1}
                  maxRows={8}
                  placeholder="Add a comment…"
                  theme={editorTheme}
                  style={{
                    ...type.input,
                    minHeight: 0,
                    flexShrink: 1,
                    color: colors.text,
                    backgroundColor: colors.surface,
                  }}
                />
                <div
                  style={{
                    ...row,
                    justifyContent: "space-between",
                    height: 28,
                    flexShrink: 0,
                    paddingTop: 6,
                  }}
                >
                  <text style={{ ...type.caption, color: colors.muted }}>Shift ↵ newline</text>
                  <Action label="Save" keys="↵" onClick={save} testId="comment-save" />
                </div>
              </>
            )}
          </Floating>
        </div>
        <div style={{ height: 420, flexShrink: 0, padding: 16 }}>
          <text style={{ ...type.label, color: colors.muted }}>
            {chosenAction
              ? `Action: ${chosenAction}`
              : "Scroll space — the popup does not move this content."}
          </text>
        </div>
      </div>
    </Shell>
  );
}
