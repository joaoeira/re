#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>

// Match GPUI's centered line-box baseline using the same CoreText font metrics.
double re_text_baseline(const char *family, double size, double lineHeight) {
  NSString *name = [NSString stringWithUTF8String:family];
  NSFont *font = [NSFont fontWithName:name size:size];
  if (!font) font = [[NSFontManager sharedFontManager] fontWithFamily:name traits:0 weight:5 size:size];
  if (!font) font = [NSFont fontWithName:@"Helvetica" size:size];
  return (lineHeight - font.ascender + font.descender) / 2 + font.ascender;
}

// GPUI owns this window and its delegate. Only configure public AppKit properties;
// do not replace its class/delegate or run a second application event loop.
static NSWindow *panel;
static NSRunningApplication *previousApp;
static EventHotKeyRef hotKey;
static EventHandlerRef hotKeyHandler;
#define RE_PANEL_ROUTE_QUIT 1
#define RE_PANEL_ROUTE_REVIEW 2
#define RE_PANEL_ROUTE_CREATE 3
#define RE_PANEL_ROUTE_REFRESH 4
#define RE_PANEL_ROUTE_PREFERENCES 5
static int pendingRoute = 0;
static id quitMonitor;
static BOOL pinned = YES;
static NSStatusItem *statusItem;
static id statusTarget;

@interface OverlayActions : NSObject
- (void)route:(NSMenuItem *)sender;
@end

@implementation OverlayActions
- (void)route:(NSMenuItem *)sender { pendingRoute = (int)sender.tag; }

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
    if ([window.title isEqualToString:@"re Overlay"]) { panel = window; break; }
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
    EventHotKeyID identifier = { 'reOL', 1 };
    status = RegisterEventHotKey(kVK_ANSI_R, controlKey | optionKey | cmdKey, identifier,
      GetEventDispatcherTarget(), 0, &hotKey);
  }
  statusTarget = [OverlayActions new];
  statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
  NSImage *icon = [NSImage imageWithSystemSymbolName:@"square.3.layers.3d" accessibilityDescription:@"re Overlay"];
  icon.template = YES;
  statusItem.button.image = icon;
  statusItem.button.imagePosition = NSImageLeft;
  statusItem.button.toolTip = @"Loading review status";
  re_panel_show();
  return (int)status;
}

// JSON is copied synchronously; Bun owns the input buffer. Menu actions only
// enqueue routes, so no JS callback is invoked inside AppKit menu tracking.
void re_panel_set_status(const char *json) {
  NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *model = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (!model) return;
  statusItem.button.title = model[@"title"];
  statusItem.button.toolTip = model[@"tooltip"];
  NSMenu *menu = [NSMenu new];
  menu.autoenablesItems = NO;
  for (NSDictionary *row in model[@"items"]) {
    if ([row[@"separator"] boolValue]) {
      [menu addItem:NSMenuItem.separatorItem];
      continue;
    }
    NSInteger route = [row[@"route"] integerValue];
    NSMenuItem *item = [menu addItemWithTitle:row[@"title"] action:route ? @selector(route:) : NULL keyEquivalent:@""];
    item.enabled = route != 0;
    item.tag = route;
    item.target = statusTarget;
    if (row[@"icon"]) item.image = [NSImage imageWithSystemSymbolName:row[@"icon"] accessibilityDescription:nil];
  }
  statusItem.menu = menu;
}

// Returned UTF-8 storage remains alive until the next folder selection.
const char *re_panel_choose_workspace(void) {
  static NSString *selectedPath;
  NSOpenPanel *picker = [NSOpenPanel openPanel];
  picker.canChooseFiles = NO;
  picker.canChooseDirectories = YES;
  picker.allowsMultipleSelection = NO;
  picker.message = @"Choose the folder containing your re Markdown decks.";
  picker.prompt = @"Use Workspace";
  picker.level = NSFloatingWindowLevel + 1;
  [NSApp activateIgnoringOtherApps:YES];
  if ([picker runModal] != NSModalResponseOK) return NULL;
  selectedPath = picker.URL.path;
  return selectedPath.UTF8String;
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
