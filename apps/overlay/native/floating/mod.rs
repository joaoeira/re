//! A reference and arbitrary floating content, laid out in the same native frame.
//! The reference participates in normal flow; the content is drawn deferred.
use super::{CustomElement, CustomElementFactory, CustomRenderContext};
use gpui::{
    point, prelude::*, px, size, AnyElement, App, AvailableSpace, Bounds, Element, ElementId,
    GlobalElementId, InspectorElementId, LayoutId, Pixels, Style, Window,
};
use std::{cell::Cell, rc::Rc};
mod geometry;
use geometry::{Align, Insets, Options, Rect, Side};

pub struct FloatingFactory;
impl CustomElementFactory for FloatingFactory {
    fn element_type(&self) -> &str {
        "floating"
    }
    fn create(&self, _: u64) -> Box<dyn CustomElement> {
        Box::new(Floating::default())
    }
}

#[derive(Default)]
struct PlacementState {
    side: Cell<Option<Side>>,
    hidden_notified: Cell<bool>,
}

/// Retains decoded props and placement state across React renders.
#[derive(Default)]
struct Floating {
    options: Options,
    state: Rc<PlacementState>,
}
impl CustomElement for Floating {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _: &mut Window,
        _: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> AnyElement {
        let callback = if ctx.events.contains("change") {
            ctx.event_callback.clone()
        } else {
            None
        };
        let mut children = ctx.children.into_iter();
        let reference = children.next().expect("Floating requires a reference");
        let content = children.next();
        if content.is_none() {
            self.state.side.set(None);
            self.state.hidden_notified.set(false);
        }
        ReferenceElement {
            reference,
            content,
            options: self.options,
            state: self.state.clone(),
            id: ctx.id,
            callback,
        }
        .into_any_element()
    }
    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        let defaults = Options::default();
        let number = |fallback| {
            value
                .as_f64()
                .map(|n| n.max(0.0) as f32)
                .unwrap_or(fallback)
        };
        match key {
            "width" => self.options.width = number(defaults.width),
            "maxHeight" => self.options.max_height = number(defaults.max_height),
            "gap" => self.options.gap = number(defaults.gap),
            "collisionPadding" => {
                self.options.collision_padding = number(defaults.collision_padding)
            }
            "boundaryInsets" => {
                let inset = |key: &str| {
                    value
                        .get(key)
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0)
                        .max(0.0) as f32
                };
                self.options.insets = Insets {
                    top: inset("top"),
                    right: inset("right"),
                    bottom: inset("bottom"),
                    left: inset("left"),
                };
            }
            "side" => {
                self.options.side = if value.as_str() == Some("top") {
                    Side::Top
                } else {
                    Side::Bottom
                }
            }
            "align" => {
                self.options.align = match value.as_str() {
                    Some("start") => Align::Start,
                    Some("center") => Align::Center,
                    _ => Align::End,
                }
            }
            _ => {}
        }
    }
    fn supported_props(&self) -> &'static [&'static str] {
        &[
            "width",
            "maxHeight",
            "gap",
            "collisionPadding",
            "boundaryInsets",
            "side",
            "align",
        ]
    }
    fn supported_events(&self) -> &'static [&'static str] {
        &["change"]
    }
    fn destroy(&mut self) {}
}

/// Lays out the reference in flow and schedules visible floating content.
struct ReferenceElement {
    reference: AnyElement,
    content: Option<AnyElement>,
    options: Options,
    state: Rc<PlacementState>,
    id: u64,
    callback: Option<crate::renderer::EventCallback>,
}
impl Element for ReferenceElement {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.reference.request_layout(window, cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.reference.prepaint(window, cx);
        let boundary = self.options.boundary(rect(Bounds::new(
            point(px(0.0), px(0.0)),
            window.viewport_size(),
        )));
        // Escape the parent's clip only while the reference is still visible.
        if bounds
            .intersect(&window.content_mask().bounds)
            .intersect(&Bounds::new(
                point(px(boundary.x), px(boundary.y)),
                size(px(boundary.width), px(boundary.height)),
            ))
            .is_empty()
        {
            if self.content.is_some() && !self.state.hidden_notified.replace(true) {
                crate::renderer::emit_event_full(&self.callback, self.id, "change", |_| {});
            }
            return;
        }
        self.state.hidden_notified.set(false);
        if let Some(content) = self.content.take() {
            let mut popup = Popup {
                content,
                reference: rect(bounds),
                boundary,
                options: self.options,
                state: self.state.clone(),
                origin: point(px(0.0), px(0.0)),
            }
            .into_any_element();
            popup.layout_as_root(
                size(AvailableSpace::MinContent, AvailableSpace::MinContent),
                window,
                cx,
            );
            window.defer_draw(popup, point(px(0.0), px(0.0)), 1, None);
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.reference.paint(window, cx);
    }
}
impl IntoElement for ReferenceElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

fn rect(b: Bounds<Pixels>) -> Rect {
    Rect {
        x: b.origin.x.into(),
        y: b.origin.y.into(),
        width: b.size.width.into(),
        height: b.size.height.into(),
    }
}

/// Defers painting above the page; requests child layout once to preserve editor identity.
struct Popup {
    content: AnyElement,
    reference: Rect,
    boundary: Rect,
    options: Options,
    state: Rc<PlacementState>,
    origin: gpui::Point<Pixels>,
}
impl Element for Popup {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let o = self.options;
        let boundary = self.boundary;
        let width = o.width.min(boundary.width);
        let child = self.content.request_layout(window, cx);
        // First pass measures unconstrained height at the final wrapping width.
        let measure = window.request_layout(
            Style {
                size: size(px(width).into(), gpui::Length::Auto),
                ..Style::default()
            },
            [child],
            cx,
        );
        window.compute_layout(
            measure,
            size(
                AvailableSpace::Definite(px(width)),
                AvailableSpace::MaxContent,
            ),
            cx,
        );
        let desired_height = f32::from(window.layout_bounds(measure).size.height);
        let placed = geometry::place(
            self.reference,
            boundary,
            o,
            self.state.side.get(),
            desired_height,
        );
        self.state.side.set(Some(placed.side));
        self.origin = point(px(placed.bounds.x), px(placed.bounds.y));
        // Second pass allocates actual space; content decides how to use it.
        // Pinned taffy reparents child to this node, leaving measure with a stale
        // child list. Never query measure again. Recheck this assumption on upgrades
        // if taffy begins enforcing single parenthood.
        let layout = window.request_layout(
            Style {
                size: size(px(width).into(), px(placed.bounds.height).into()),
                ..Style::default()
            },
            [child],
            cx,
        );
        (layout, ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        // This empty root stays at zero; only its content uses the origin resolved after measurement.
        self.content.prepaint_at(self.origin, window, cx);
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.content.paint(window, cx);
    }
}
impl IntoElement for Popup {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
