import { createElement, type ReactNode } from "react";
import type { StyleDesc } from "@gpuix/react";

export interface FloatingProps {
  /** Mount floating content; closing resets the retained placement side. */
  readonly open: boolean;
  /** In-flow anchor; its bounds determine placement, independently of the trigger. */
  readonly reference: ReactNode;
  /** Arbitrary content; shrinkable children must manage their own scrolling. */
  readonly children: ReactNode;
  /** Desired width in logical pixels, narrowed to available space. Default: 340. */
  readonly width?: number;
  /** Height cap in logical pixels, further limited by available space. Default: 180. */
  readonly maxHeight?: number;
  /** Space between the reference and popup, in logical pixels. Default: 8. */
  readonly gap?: number;
  /** Clearance inside the usable window boundary, in logical pixels. Default: 12. */
  readonly collisionPadding?: number;
  /** Opening preference; retained while content fits on the chosen side. Default: bottom. */
  readonly side?: "top" | "bottom";
  /** Horizontal alignment before boundary correction. Default: end. */
  readonly align?: "start" | "center" | "end";
  /** Reserved window edges in logical pixels, before collision padding. Each defaults to 0. */
  readonly boundaryInsets?: {
    readonly top?: number;
    readonly right?: number;
    readonly bottom?: number;
    readonly left?: number;
  };
  /** Surface appearance; layout, clipping and pointer occlusion remain owned here. */
  readonly style?: StyleDesc;
  /** Called when the open reference becomes hidden; caller decides whether to close. */
  readonly onReferenceHidden?: () => void;
  /** Mouse down outside the popup, including on the reference; does not discard state. */
  readonly onClickOutside?: () => void;
}

export function Floating({
  open,
  reference,
  children,
  style,
  onReferenceHidden,
  onClickOutside,
  ...positioning
}: FloatingProps) {
  // GPUIX EVENT_PROPS is closed: use its existing onChange transport for visibility.
  return createElement(
    "floating",
    { ...positioning, onChange: onReferenceHidden },
    // Wrappers guarantee exactly one native child per slot, even for fragments.
    <div key="reference">{reference}</div>,
    open ? (
      <div
        key="content"
        onMouseDownOutside={onClickOutside}
        style={{
          // Deferred layers sit above the blurred window; an opaque default hides the page.
          backgroundColor: "#303030",
          ...style,
          display: "flex",
          flexDirection: "column",
          width: "100%",
          minHeight: 0,
          maxHeight: "100%",
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        {children}
      </div>
    ) : null,
  );
}
