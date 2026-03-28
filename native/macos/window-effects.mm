#import <Cocoa/Cocoa.h>

static NSString *const kElectrobunVibrancyViewIdentifier =
	@"ElectrobunVibrancyView";
static NSString *const kElectrobunNativeDragViewIdentifier =
	@"ElectrobunNativeDragView";

@interface ElectrobunNativeDragView : NSView
@property (nonatomic, strong) NSMutableArray<NSValue *> *exclusionZones;
@end

@implementation ElectrobunNativeDragView

- (instancetype)initWithFrame:(NSRect)frame {
	self = [super initWithFrame:frame];
	if (self) {
		_exclusionZones = [NSMutableArray array];
	}
	return self;
}

- (BOOL)isOpaque {
	return NO;
}

- (void)drawRect:(NSRect)dirtyRect {
	(void)dirtyRect;
}

// Override hitTest to pass through clicks on buttons (exclusion zones)
- (NSView *)hitTest:(NSPoint)point {
	NSPoint localPoint = [self convertPoint:point fromView:[self superview]];

	// CRITICAL: Check if point is within our bounds first.
	// Without this, we capture clicks outside our header region since
	// we're at the top of the z-order and would intercept ALL clicks.
	if (!NSPointInRect(localPoint, self.bounds)) {
		return nil; // Outside our frame - pass through to views below
	}

	// Check exclusion zones (buttons in header)
	for (NSValue *zoneValue in self.exclusionZones) {
		NSRect zone = [zoneValue rectValue];
		if (NSPointInRect(localPoint, zone)) {
			return nil; // Pass through to WebView for button clicks
		}
	}
	return self; // Capture for drag (only within our header region)
}

- (void)mouseDown:(NSEvent *)event {
	NSWindow *window = [self window];
	if (window != nil && event != nil) {
		[window performWindowDragWithEvent:event];
	}
}

- (void)scrollWheel:(NSEvent *)event {
	NSView *contentView = [[self window] contentView];
	if (contentView == nil) {
		return;
	}

	// Find the WebView sibling and forward scroll events to it
	for (NSView *sibling in [contentView subviews]) {
		if (sibling != self &&
			![sibling isKindOfClass:[NSVisualEffectView class]]) {
			[sibling scrollWheel:event];
			return;
		}
	}
}

- (void)setExclusionZonesFromArray:(NSArray<NSValue *> *)zones {
	[self.exclusionZones removeAllObjects];
	[self.exclusionZones addObjectsFromArray:zones];
}

@end

static NSVisualEffectView *findVibrancyView(NSView *contentView) {
	for (NSView *subview in [contentView subviews]) {
		if ([subview isKindOfClass:[NSVisualEffectView class]] &&
			[[subview identifier]
				isEqualToString:kElectrobunVibrancyViewIdentifier]) {
			return (NSVisualEffectView *)subview;
		}
	}

	return nil;
}

static ElectrobunNativeDragView *findNativeDragView(NSView *contentView) {
	for (NSView *subview in [contentView subviews]) {
		if ([subview isKindOfClass:[ElectrobunNativeDragView class]] &&
			[[subview identifier]
				isEqualToString:kElectrobunNativeDragViewIdentifier]) {
			return (ElectrobunNativeDragView *)subview;
		}
	}

	return nil;
}

extern "C" bool enableWindowVibrancy(void *windowPtr) {
	if (windowPtr == nullptr) {
		return false;
	}

	__block BOOL success = NO;
	dispatch_sync(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)windowPtr;
		if (![window isKindOfClass:[NSWindow class]]) {
			return;
		}

		[window setOpaque:NO];
		[window setBackgroundColor:[NSColor clearColor]];
		[window setTitlebarAppearsTransparent:YES];
		[window setHasShadow:YES];

		NSView *contentView = [window contentView];
		if (contentView == nil) {
			return;
		}

		NSVisualEffectView *effectView = findVibrancyView(contentView);

		if (effectView == nil) {
			effectView = [[NSVisualEffectView alloc]
				initWithFrame:[contentView bounds]];
			[effectView setIdentifier:kElectrobunVibrancyViewIdentifier];
			[effectView
				setAutoresizingMask:(NSViewWidthSizable | NSViewHeightSizable)];
		}

		if (@available(macOS 10.14, *)) {
			[effectView setMaterial:NSVisualEffectMaterialUnderWindowBackground];
		} else {
			[effectView setMaterial:NSVisualEffectMaterialSidebar];
		}
		[effectView setBlendingMode:NSVisualEffectBlendingModeBehindWindow];
		[effectView setState:NSVisualEffectStateActive];

		if ([effectView superview] == nil) {
			NSView *relativeView = [[contentView subviews] firstObject];
			if (relativeView != nil) {
				[contentView addSubview:effectView
							 positioned:NSWindowBelow
							 relativeTo:relativeView];
			} else {
				[contentView addSubview:effectView];
			}
		}

		// Fullscreen observers — switch blending mode to avoid red backing
		// artifact. behindWindow blending has nothing to sample in fullscreen
		// (window occupies its own Space), so we switch to withinWindow.
		[[NSNotificationCenter defaultCenter]
			addObserverForName:NSWindowWillEnterFullScreenNotification
						object:window
						 queue:[NSOperationQueue mainQueue]
					usingBlock:^(NSNotification *note) {
			(void)note;
			[effectView
				setBlendingMode:NSVisualEffectBlendingModeWithinWindow];
			[effectView
				setMaterial:NSVisualEffectMaterialWindowBackground];
			[window setBackgroundColor:[NSColor colorWithRed:0.118
													   green:0.118
														blue:0.137
													   alpha:1.0]];
			// Hide toolbar — it was only needed for traffic light positioning
			// and its strip overlaps the header content in fullscreen
			[[window toolbar] setVisible:NO];
		}];

		[[NSNotificationCenter defaultCenter]
			addObserverForName:NSWindowDidExitFullScreenNotification
						object:window
						 queue:[NSOperationQueue mainQueue]
					usingBlock:^(NSNotification *note) {
			(void)note;
			if (@available(macOS 10.14, *)) {
				[effectView setMaterial:
					NSVisualEffectMaterialUnderWindowBackground];
			} else {
				[effectView setMaterial:NSVisualEffectMaterialSidebar];
			}
			[effectView
				setBlendingMode:NSVisualEffectBlendingModeBehindWindow];
			[window setBackgroundColor:[NSColor clearColor]];
			[[window toolbar] setVisible:YES];
		}];

		[window invalidateShadow];
		success = YES;
	});

	return success;
}

extern "C" bool ensureWindowShadow(void *windowPtr) {
	if (windowPtr == nullptr) {
		return false;
	}

	__block BOOL success = NO;
	dispatch_sync(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)windowPtr;
		if (![window isKindOfClass:[NSWindow class]]) {
			return;
		}

		[window setHasShadow:YES];
		[window invalidateShadow];
		success = YES;
	});

	return success;
}

extern "C" bool extendTitlebarWithToolbar(void *windowPtr) {
	if (windowPtr == nullptr) {
		return false;
	}

	__block BOOL success = NO;
	dispatch_sync(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)windowPtr;
		if (![window isKindOfClass:[NSWindow class]]) {
			return;
		}

		// Create invisible toolbar to extend titlebar area
		NSToolbar *toolbar =
			[[NSToolbar alloc] initWithIdentifier:@"ExtendedTitlebar"];
		[toolbar setShowsBaselineSeparator:NO];
		[window setToolbar:toolbar];

		// Use unified style for seamless appearance
		if (@available(macOS 11.0, *)) {
			[window setToolbarStyle:NSWindowToolbarStyleUnified];
		}

		success = YES;
	});

	return success;
}

extern "C" bool setWindowTrafficLightsPosition(void *windowPtr, double x,
											   double yFromTop) {
	if (windowPtr == nullptr) {
		return false;
	}

	__block BOOL success = NO;
	dispatch_sync(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)windowPtr;
		if (![window isKindOfClass:[NSWindow class]]) {
			return;
		}

		NSButton *closeButton =
			[window standardWindowButton:NSWindowCloseButton];
		NSButton *minimizeButton =
			[window standardWindowButton:NSWindowMiniaturizeButton];
		NSButton *zoomButton = [window standardWindowButton:NSWindowZoomButton];

		if (closeButton == nil || minimizeButton == nil || zoomButton == nil) {
			return;
		}

		NSView *buttonContainer = [closeButton superview];
		if (buttonContainer == nil) {
			return;
		}

		CGFloat spacing = NSMinX(minimizeButton.frame) - NSMinX(closeButton.frame);
		if (spacing <= 0) {
			spacing = closeButton.frame.size.width + 6.0;
		}

		BOOL flipped = [buttonContainer isFlipped];
		CGFloat targetY = yFromTop;
		if (!flipped) {
			targetY = buttonContainer.frame.size.height - yFromTop -
					  closeButton.frame.size.height;
		}
		targetY = MAX(0.0, targetY);

		CGFloat currentX = x;
		NSArray<NSButton *> *buttons = @[ closeButton, minimizeButton, zoomButton ];
		for (NSButton *button in buttons) {
			[button setFrameOrigin:NSMakePoint(currentX, targetY)];
			currentX += spacing;
		}

		[buttonContainer setNeedsLayout:YES];
		[buttonContainer layoutSubtreeIfNeeded];
		[window invalidateShadow];
		success = YES;
	});

	return success;
}

extern "C" bool setNativeWindowDragRegion(void *windowPtr, double x,
										  double height) {
	if (windowPtr == nullptr) {
		return false;
	}

	__block BOOL success = NO;
	dispatch_sync(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)windowPtr;
		if (![window isKindOfClass:[NSWindow class]]) {
			return;
		}

		NSView *contentView = [window contentView];
		if (contentView == nil) {
			return;
		}

		CGFloat dragX = MAX(0.0, x);
		CGFloat dragHeight = MAX(0.0, height);
		CGFloat dragWidth = MAX(0.0, contentView.bounds.size.width - dragX);
		if (dragHeight <= 0.0 || dragWidth <= 0.0) {
			return;
		}

		BOOL flipped = [contentView isFlipped];
		CGFloat dragY = flipped ? 0.0 : contentView.bounds.size.height - dragHeight;
		dragY = MAX(0.0, dragY);

		ElectrobunNativeDragView *dragView = findNativeDragView(contentView);
		if (dragView == nil) {
			dragView = [[ElectrobunNativeDragView alloc] initWithFrame:NSZeroRect];
			[dragView setIdentifier:kElectrobunNativeDragViewIdentifier];
		}

		[dragView setFrame:NSMakeRect(dragX, dragY, dragWidth, dragHeight)];
		[dragView setAutoresizingMask:NSViewWidthSizable];

		if ([dragView superview] == nil) {
			[contentView addSubview:dragView
						 positioned:NSWindowAbove
						 relativeTo:nil];
		}

		success = YES;
	});

	return success;
}

extern "C" bool setDragExclusionZones(void *windowPtr, double *zones,
									  int zoneCount) {
	if (windowPtr == nullptr || zones == nullptr) {
		return false;
	}

	__block BOOL success = NO;
	dispatch_sync(dispatch_get_main_queue(), ^{
		NSWindow *window = (__bridge NSWindow *)windowPtr;
		if (![window isKindOfClass:[NSWindow class]]) {
			return;
		}

		NSView *contentView = [window contentView];
		if (contentView == nil) {
			return;
		}

		ElectrobunNativeDragView *dragView = findNativeDragView(contentView);
		if (dragView == nil) {
			return;
		}

		NSMutableArray<NSValue *> *zoneArray = [NSMutableArray array];
		for (int i = 0; i < zoneCount; i++) {
			double x = zones[i * 4];
			double y = zones[i * 4 + 1];
			double w = zones[i * 4 + 2];
			double h = zones[i * 4 + 3];
			NSRect rect = NSMakeRect(x, y, w, h);
			[zoneArray addObject:[NSValue valueWithRect:rect]];
		}

		[dragView setExclusionZonesFromArray:zoneArray];
		success = YES;
	});

	return success;
}
