//! Placement policy only. Coordinates are logical window pixels.
#[derive(Clone, Copy, Default, PartialEq)]
pub enum Side {
    Top,
    #[default]
    Bottom,
}

#[derive(Clone, Copy, Default)]
pub enum Align {
    Start,
    Center,
    #[default]
    End,
}

#[derive(Clone, Copy)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, Default)]
pub struct Insets {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

#[derive(Clone, Copy)]
pub struct Options {
    pub width: f32,
    pub max_height: f32,
    pub gap: f32,
    pub collision_padding: f32,
    pub insets: Insets,
    pub side: Side,
    pub align: Align,
}
impl Options {
    pub fn boundary(&self, viewport: Rect) -> Rect {
        Rect {
            x: viewport.x + self.collision_padding + self.insets.left,
            y: viewport.y + self.collision_padding + self.insets.top,
            width: (viewport.width
                - 2.0 * self.collision_padding
                - self.insets.left
                - self.insets.right)
                .max(0.0),
            height: (viewport.height
                - 2.0 * self.collision_padding
                - self.insets.top
                - self.insets.bottom)
                .max(0.0),
        }
    }
}

impl Default for Options {
    fn default() -> Self {
        Self {
            width: 340.0,
            max_height: 180.0,
            gap: 8.0,
            collision_padding: 12.0,
            insets: Insets::default(),
            side: Side::default(),
            align: Align::default(),
        }
    }
}
impl Side {
    fn opposite(self) -> Self {
        match self {
            Self::Top => Self::Bottom,
            Self::Bottom => Self::Top,
        }
    }
}

pub struct Placement {
    pub side: Side,
    pub bounds: Rect,
}

pub fn place(
    reference: Rect,
    boundary: Rect,
    options: Options,
    previous: Option<Side>,
    desired_height: f32,
) -> Placement {
    let Options {
        width,
        max_height,
        side: preferred,
        align,
        gap,
        ..
    } = options;
    let width = width.min(boundary.width);
    let height = desired_height.min(max_height);
    let above = (reference.y - gap - boundary.y).max(0.0);
    let below = (boundary.y + boundary.height - reference.y - reference.height - gap).max(0.0);
    let space = |side| if side == Side::Top { above } else { below };
    let side = if let Some(side) = previous.filter(|&side| space(side) >= height) {
        side
    } else if space(preferred) >= height {
        preferred
    } else if space(preferred.opposite()) >= height {
        preferred.opposite()
    } else if above > below {
        Side::Top
    } else {
        Side::Bottom
    };
    let height = height.min(space(side));
    let x = match align {
        Align::Start => reference.x,
        Align::Center => reference.x + (reference.width - width) / 2.0,
        Align::End => reference.x + reference.width - width,
    }
    .clamp(
        boundary.x,
        (boundary.x + boundary.width - width).max(boundary.x),
    );
    let y = match side {
        Side::Top => reference.y - gap - height,
        Side::Bottom => reference.y + reference.height + gap,
    };
    Placement {
        side,
        bounds: Rect {
            x,
            y,
            width,
            height,
        },
    }
}
