#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>

// GPUI owns this window and its delegate. Only configure public AppKit properties;
// do not replace its class/delegate or run a second application event loop.
static NSWindow *panel;
static NSRunningApplication *previousApp;
static EventHotKeyRef hotKey;
static EventHandlerRef hotKeyHandler;
#define RE_PANEL_ROUTE_QUIT 1
static int pendingRoute = 0;
static id quitMonitor;
static BOOL pinned = YES;
static NSStatusItem *statusItem;
static id statusTarget;

@interface PocketActions : NSObject
- (void)show:(id)sender;
- (void)quit:(id)sender;
@end

@implementation PocketActions
- (void)show:(id)sender { extern void re_panel_show(void); re_panel_show(); }
- (void)quit:(id)sender { pendingRoute = RE_PANEL_ROUTE_QUIT; }

@end

void re_panel_hide(void) {
  BOOL restore = NSApp.active;
  [panel orderOut:nil];
  if (restore && previousApp && !previousApp.terminated) {
    [previousApp activateWithOptions:0];
  }
}

void re_panel_show(void) {
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (front.processIdentifier != NSProcessInfo.processInfo.processIdentifier) previousApp = front;
  // Retain the user's dragged position. Only move if the screen disappeared.
  BOOL onScreen = NO;
  for (NSScreen *screen in NSScreen.screens) {
    if (NSIntersectsRect(panel.frame, screen.visibleFrame)) onScreen = YES;
  }
  if (!onScreen) [panel center];
  [NSApp activateIgnoringOtherApps:YES];
  [panel makeKeyAndOrderFront:nil];
}

static void toggle(void) {
  if (panel.visible && panel.keyWindow) re_panel_hide();
  else re_panel_show();
}

static OSStatus handleHotKey(EventHandlerCallRef next, EventRef event, void *context) {
  toggle();
  return noErr;
}

void re_panel_pin(bool value) {
  pinned = value;
  panel.level = pinned ? NSFloatingWindowLevel : NSNormalWindowLevel;
}

int re_panel_init(void) {
  for (NSWindow *window in NSApp.windows) {
    if ([window.title isEqualToString:@"re Pocket"]) { panel = window; break; }
  }
  if (!panel) return -1;
  previousApp = NSWorkspace.sharedWorkspace.frontmostApplication;
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorFullScreenAuxiliary;
  panel.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  panel.titleVisibility = NSWindowTitleHidden;
  panel.titlebarAppearsTransparent = YES;
  // Native blur beneath a dark translucent tint.
  panel.backgroundColor = [NSColor colorWithRed:0.18 green:0.18 blue:0.18 alpha:1];
  // Leave the titlebar as a drag surface; all close actions live in the UI.
  for (NSNumber *button in @[@(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton)]) {
    [panel standardWindowButton:button.unsignedIntegerValue].hidden = YES;
  }
  re_panel_pin(true);
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  quitMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
    if ((event.modifierFlags & NSEventModifierFlagCommand) && event.keyCode == kVK_ANSI_Q) {
      pendingRoute = RE_PANEL_ROUTE_QUIT;
      return nil;
    }
    return event;
  }];
  EventTypeSpec type = { kEventClassKeyboard, kEventHotKeyPressed };
  OSStatus status = InstallEventHandler(GetEventDispatcherTarget(), handleHotKey, 1, &type, NULL, &hotKeyHandler);
  if (status == noErr) {
    EventHotKeyID identifier = { 'rePK', 1 };
    status = RegisterEventHotKey(kVK_ANSI_R, controlKey | optionKey | cmdKey, identifier,
      GetEventDispatcherTarget(), 0, &hotKey);
  }
  statusTarget = [PocketActions new];
  statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
  statusItem.button.title = @"re";
  statusItem.button.toolTip = @"re Pocket";
  NSMenu *menu = [NSMenu new];
  NSMenuItem *show = [menu addItemWithTitle:@"Show re Pocket" action:@selector(show:) keyEquivalent:@""];
  show.target = statusTarget;
  [menu addItem:NSMenuItem.separatorItem];
  NSMenuItem *quit = [menu addItemWithTitle:@"Quit re Pocket" action:@selector(quit:) keyEquivalent:@""];
  quit.target = statusTarget;
  statusItem.menu = menu;
  re_panel_show();
  return (int)status;
}

void re_panel_dispose(void) {
  if (quitMonitor) [NSEvent removeMonitor:quitMonitor];
  if (statusItem) [NSStatusBar.systemStatusBar removeStatusItem:statusItem];
  if (hotKey) UnregisterEventHotKey(hotKey);
  if (hotKeyHandler) RemoveEventHandler(hotKeyHandler);
}

int re_panel_take_route(void) {
  int route = pendingRoute;
  pendingRoute = 0;
  return route;
}

// GPUIX 0.7.0's embedded tick can wait indefinitely for AppKit work once the
// window is hidden (upstream #39). Drain ready events instead, keeping Bun free
// to receive Raycast requests and finish filesystem operations. GPUI's display
// link and drawing still run through their existing CoreFoundation sources.
void re_panel_pump(void) {
  @autoreleasepool {
    for (int i = 0; i < 64; i++) {
      NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny
        untilDate:NSDate.distantPast inMode:NSDefaultRunLoopMode dequeue:YES];
      if (!event) break;
      [NSApp sendEvent:event];
    }
    for (int i = 0; i < 8; i++) {
      if (CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true) != kCFRunLoopRunHandledSource) break;
    }
    [NSApp updateWindows];
  }
}
